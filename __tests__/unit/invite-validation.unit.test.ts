import { describe, expect, it } from "vitest";
import { classifyInviteEmailError } from "@/lib/invite-service";
import {
  acceptInviteSchema,
  bulkInvitesSchema,
  createInviteSchema,
  parseBulkInviteEmails,
} from "@/lib/validations/invite";

describe("createInviteSchema", () => {
  it("accepts valid email and roleId", () => {
    const r = createInviteSchema.safeParse({ email: "a@b.co", roleId: "role1" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const r = createInviteSchema.safeParse({ email: "not-an-email", roleId: "role1" });
    expect(r.success).toBe(false);
  });
});

describe("bulkInvitesSchema", () => {
  it("accepts emails and roleId", () => {
    const r = bulkInvitesSchema.safeParse({
      emails: ["a@b.co", "c@d.co"],
      roleId: "role1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty emails array", () => {
    const r = bulkInvitesSchema.safeParse({ emails: [], roleId: "role1" });
    expect(r.success).toBe(false);
  });
});

describe("classifyInviteEmailError", () => {
  it("classifies connection errors", () => {
    expect(classifyInviteEmailError(new Error("connect ECONNREFUSED 127.0.0.1:1025"))).toBe(
      "SMTP_CONNECTION"
    );
  });

  it("classifies Resend-related errors", () => {
    expect(classifyInviteEmailError(new Error("Failed to send email: domain not verified"))).toBe(
      "RESEND_CONFIG"
    );
  });
});

describe("parseBulkInviteEmails", () => {
  it("dedupes and lowercases valid emails", () => {
    const { valid, invalid } = parseBulkInviteEmails(["A@B.CO", "a@b.co", "x@y.co"]);
    expect(valid).toEqual(["a@b.co", "x@y.co"]);
    expect(invalid).toEqual([]);
  });

  it("collects invalid tokens", () => {
    const { valid, invalid } = parseBulkInviteEmails(["ok@ok.co", "not-an-email"]);
    expect(valid).toEqual(["ok@ok.co"]);
    expect(invalid).toContain("not-an-email");
  });
});

describe("acceptInviteSchema", () => {
  it("accepts matching passwords with strong password", () => {
    const r = acceptInviteSchema.safeParse({
      token: "tok",
      name: "Ada Lovelace",
      password: "Secret1x",
      confirmPassword: "Secret1x",
    });
    expect(r.success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const r = acceptInviteSchema.safeParse({
      token: "tok",
      name: "Ada",
      password: "Secret1x",
      confirmPassword: "Other1x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects weak password", () => {
    const r = acceptInviteSchema.safeParse({
      token: "tok",
      name: "Ada",
      password: "weak",
      confirmPassword: "weak",
    });
    expect(r.success).toBe(false);
  });
});
