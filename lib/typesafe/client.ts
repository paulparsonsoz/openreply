/**
 * Minimal TypeSafe System One client.
 *
 * TypeSafe returns typed judgments (Choice / Noul / Score) with calibrated
 * probabilities instead of generated text. OpenReply uses it for optional,
 * per-campaign comment understanding. Everything here is best-effort: callers
 * must treat a thrown error as "no judgment available" and fall back to the
 * deterministic keyword path, so an outage never stops DMs.
 *
 * API reference: https://docs.typesafe.ai/api
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
// The worker handles comments one at a time; a slow judgment must not stall
// the queue. Typical latency is ~1s.
const TIMEOUT_MS = Number(process.env.TYPESAFE_TIMEOUT_MS ?? 5000);
const RETRYABLE = new Set([429, 529]);
const MAX_ATTEMPTS = 2;

export type Description = string | Record<string, unknown> | unknown[];

export type TypeSafeQuestion =
  | { type: "noul"; instructions: Description; criteria?: { true?: Description; false?: Description } }
  | { type: "choice"; instructions: Description; criteria: Record<string, Description | null> }
  | { type: "score"; instructions: Description; criteria: Description[] };

export type TypeSafeAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export class TypeSafeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TypeSafeError";
  }
}

export function isTypeSafeConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export async function askTypeSafe(
  state: unknown,
  questions: Record<string, TypeSafeQuestion>
): Promise<Record<string, TypeSafeAnswer>> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new TypeSafeError("TYPESAFE_API_KEY is not set");

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new TypeSafeError(`TypeSafe ${res.status}: ${detail}`, res.status);
      }
      const body = (await res.json()) as { answers?: Record<string, TypeSafeAnswer> };
      if (!body.answers) throw new TypeSafeError("TypeSafe response had no answers");
      return body.answers;
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof TypeSafeError && error.status !== undefined && RETRYABLE.has(error.status);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new TypeSafeError(String(lastError));
}
