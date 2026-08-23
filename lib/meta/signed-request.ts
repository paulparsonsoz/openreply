import { createHmac, timingSafeEqual } from "crypto";

export interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
}

/**
 * Meta signs deauthorize and data deletion callbacks as
 * `<base64url signature>.<base64url payload>`, HMAC-SHA256 over the encoded
 * payload string. Returns null for anything that fails verification so callers
 * never act on an unsigned body.
 *
 * Both app secrets are accepted for the same reason verifyWebhookSignature
 * accepts either: an Instagram-Login app signs with the Instagram app secret
 * and a Facebook-Login app with the Facebook one, and both belong to the same
 * app.
 */
export function parseSignedRequest(
  signedRequest: string | null
): SignedRequestPayload | null {
  if (!signedRequest) return null;

  const [encodedSignature, encodedPayload] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload) return null;

  const secrets = [
    process.env.INSTAGRAM_APP_SECRET,
    process.env.FACEBOOK_APP_SECRET,
  ].filter((s): s is string => Boolean(s));

  if (secrets.length === 0) {
    throw new Error(
      "INSTAGRAM_APP_SECRET or FACEBOOK_APP_SECRET is required to verify signed requests"
    );
  }

  const signature = Buffer.from(encodedSignature, "base64url");
  const signatureMatches = secrets.some((secret) => {
    const expected = createHmac("sha256", secret)
      .update(encodedPayload)
      .digest();
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(expected, signature);
  });

  if (!signatureMatches) return null;

  try {
    return JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as SignedRequestPayload;
  } catch {
    return null;
  }
}
