import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSignedRequest } from "../lib/meta/signed-request";

const SECRET = "instagram-app-secret";

function sign(payload: object, secret = SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${signature}.${encodedPayload}`;
}

beforeEach(() => {
  vi.stubEnv("INSTAGRAM_APP_SECRET", SECRET);
  vi.stubEnv("FACEBOOK_APP_SECRET", "a-different-facebook-secret");
});

describe("Meta signed requests", () => {
  it("returns the payload of a correctly signed request", () => {
    expect(parseSignedRequest(sign({ user_id: "17841400000000000" }))).toEqual({
      user_id: "17841400000000000",
    });
  });

  it("accepts a request signed with the Facebook app secret", () => {
    const signed = sign({ user_id: "123" }, "a-different-facebook-secret");
    expect(parseSignedRequest(signed)?.user_id).toBe("123");
  });

  it("rejects a request signed with an unknown secret", () => {
    expect(parseSignedRequest(sign({ user_id: "123" }, "wrong"))).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [signature] = sign({ user_id: "123" }).split(".");
    const forged = Buffer.from(JSON.stringify({ user_id: "999" })).toString(
      "base64url"
    );
    expect(parseSignedRequest(`${signature}.${forged}`)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseSignedRequest(null)).toBeNull();
    expect(parseSignedRequest("not-a-signed-request")).toBeNull();
  });
});
