import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createOAuthState,
  decryptToken,
  encryptToken,
  getAuthorizationUrl,
  verifyOAuthState,
} from "../lib/meta/oauth";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv(
    "ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
});

describe("OAuth state and token encryption", () => {
  it("round-trips encrypted tokens", () => {
    const encrypted = encryptToken("long-lived-token");
    expect(encrypted).not.toBe("long-lived-token");
    expect(decryptToken(encrypted)).toBe("long-lived-token");
  });

  it("signs and verifies Instagram OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(state)?.workspaceId).toBe("workspace_123");
  });

  it("rejects tampered OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });
});

describe("Instagram authorization URL", () => {
  // api.instagram.com/oauth/authorize no longer serves the Business Login
  // dialog — sending users there breaks Connect Instagram entirely, and the
  // failure only shows up in a browser, never in a build.
  it("points the consent dialog at www.instagram.com", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "app-id");
    const url = new URL(
      getAuthorizationUrl("https://example.com/api/instagram/callback", "state")
    );

    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
  });

  it("sends the redirect_uri the callback rebuilds for token exchange", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "app-id");
    const redirectUri = "https://example.com/api/instagram/callback";
    const url = new URL(getAuthorizationUrl(redirectUri, "state"));

    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });
});
