import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCronRequest } from "../lib/ops/cron-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAuthorizedCronRequest", () => {
  it("accepts the exact bearer token", () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_123");
    expect(isAuthorizedCronRequest("Bearer cron_secret_123")).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_123");
    expect(isAuthorizedCronRequest("Bearer cron_secret_999")).toBe(false);
  });

  it("rejects a token of a different length", () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_123");
    expect(isAuthorizedCronRequest("Bearer short")).toBe(false);
  });

  it("rejects a missing header", () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_123");
    expect(isAuthorizedCronRequest(null)).toBe(false);
  });

  it("rejects everything when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorizedCronRequest("Bearer ")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer undefined")).toBe(false);
  });

  it("does not fall back to NEXTAUTH_SECRET", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "nextauth_secret");
    expect(isAuthorizedCronRequest("Bearer nextauth_secret")).toBe(false);
  });
});
