import { timingSafeEqual } from "crypto";

/**
 * Checks the `Authorization: Bearer <CRON_SECRET>` header Vercel Cron sends.
 *
 * Fails closed: if CRON_SECRET is not set, every request is rejected. There is
 * deliberately no fallback to another secret.
 */
export function isAuthorizedCronRequest(authHeader: string | null): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !authHeader) return false;

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader);
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
