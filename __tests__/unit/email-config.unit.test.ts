import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeEmailConfig,
  resolveRecipient,
  maskEmail,
  isNonProd,
  isDevSmtpEnv,
} from "@/lib/email";

describe("computeEmailConfig", () => {
  it("uses smtp transport when SMTP_HOST is set", () => {
    const config = computeEmailConfig({ SMTP_HOST: "localhost" });
    expect(config.transport).toBe("smtp");
    expect(config.smtpHostSet).toBe(true);
  });

  it("uses smtp transport when no valid Resend key is set", () => {
    const config = computeEmailConfig({});
    expect(config.transport).toBe("smtp");
    expect(config.resendKeySet).toBe(false);
    expect(config.resendKeyValid).toBe(false);
  });

  it("uses smtp transport when RESEND_API_KEY is a placeholder", () => {
    const config = computeEmailConfig({ RESEND_API_KEY: "re_YOUR_KEY_HERE" });
    expect(config.transport).toBe("smtp");
    expect(config.resendKeySet).toBe(true);
    expect(config.resendKeyValid).toBe(false);
  });

  it("uses resend transport when a real RESEND_API_KEY is set (no SMTP_HOST)", () => {
    const config = computeEmailConfig({ RESEND_API_KEY: "re_abc123" });
    expect(config.transport).toBe("resend");
    expect(config.resendKeySet).toBe(true);
    expect(config.resendKeyValid).toBe(true);
  });

  it("prefers smtp transport when both SMTP_HOST and a valid Resend key are set", () => {
    const config = computeEmailConfig({ SMTP_HOST: "localhost", RESEND_API_KEY: "re_abc123" });
    expect(config.transport).toBe("smtp");
  });

  it("reports emailFromSet as true when EMAIL_FROM is set", () => {
    const config = computeEmailConfig({ EMAIL_FROM: "noreply@example.com" });
    expect(config.emailFromSet).toBe(true);
  });

  it("reports emailFromSet as false when EMAIL_FROM is not set", () => {
    const config = computeEmailConfig({});
    expect(config.emailFromSet).toBe(false);
  });

  it("reports emailFromSet as false when EMAIL_FROM is an empty string", () => {
    const config = computeEmailConfig({ EMAIL_FROM: "" });
    expect(config.emailFromSet).toBe(false);
  });
});

describe("isDevSmtpEnv", () => {
  it("returns true without Resend key", () => {
    expect(isDevSmtpEnv({})).toBe(true);
  });

  it("returns false with valid Resend key and no SMTP", () => {
    expect(isDevSmtpEnv({ RESEND_API_KEY: "re_realkey" })).toBe(false);
  });

  it("returns true with placeholder Resend key", () => {
    expect(isDevSmtpEnv({ RESEND_API_KEY: "re_YOUR_KEY" })).toBe(true);
  });

  it("returns true when SMTP_HOST is set even with valid Resend", () => {
    expect(isDevSmtpEnv({ SMTP_HOST: "localhost", RESEND_API_KEY: "re_realkey" })).toBe(true);
  });
});

describe("maskEmail()", () => {
  it("masks the local part leaving only the first character", () => {
    expect(maskEmail("psalter@cpbuild.com")).toBe("p***@cpbuild.com");
  });

  it("returns *** for very short local parts", () => {
    expect(maskEmail("a@b.com")).toBe("***");
  });

  it("returns *** when no @ symbol present", () => {
    expect(maskEmail("notanemail")).toBe("***");
  });
});

describe("isNonProd()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when NODE_ENV is development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isNonProd()).toBe(true);
  });

  it("returns false when NODE_ENV is production and APP_ENV is not dev", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    expect(isNonProd()).toBe(false);
  });

  it("returns true when NODE_ENV is production but APP_ENV is dev", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "dev");
    expect(isNonProd()).toBe(true);
  });
});

describe("resolveRecipient()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns original address when DEV_EMAIL_OVERRIDE is not set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_EMAIL_OVERRIDE", "");
    expect(resolveRecipient("user@example.com")).toBe("user@example.com");
  });

  it("redirects to override address in non-prod when DEV_EMAIL_OVERRIDE is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_EMAIL_OVERRIDE", "dev@cpbuild.com");
    expect(resolveRecipient("user@example.com")).toBe("dev@cpbuild.com");
  });

  it("does NOT redirect in production even when DEV_EMAIL_OVERRIDE is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("DEV_EMAIL_OVERRIDE", "dev@cpbuild.com");
    expect(resolveRecipient("user@example.com")).toBe("user@example.com");
  });

  it("redirects in Railway dev (NODE_ENV=production, APP_ENV=dev)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "dev");
    vi.stubEnv("DEV_EMAIL_OVERRIDE", "dev@cpbuild.com");
    expect(resolveRecipient("user@example.com")).toBe("dev@cpbuild.com");
  });
});
