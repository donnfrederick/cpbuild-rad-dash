import { z } from "zod";

export const createInviteSchema = z.object({
  email: z.string().email("Invalid email"),
  roleId: z.string().min(1, "Role is required"),
});

const MAX_BULK_INVITES = 50;

const singleEmail = z.string().email("Invalid email");

export const teamAssignmentSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  teamRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const bulkInvitesSchema = z.object({
  emails: z
    .array(z.string().min(1))
    .min(1, "Add at least one email")
    .max(MAX_BULK_INVITES, `At most ${MAX_BULK_INVITES} emails per request`),
  roleId: z.string().min(1, "Role is required"),
  teamAssignments: z.array(teamAssignmentSchema).optional(),
  /** When true the accepted user receives the access:all_teams special permission. */
  grantAllTeams: z.boolean().optional(),
});

/** Normalize and dedupe; invalid entries are dropped (caller can compare length). */
export function parseBulkInviteEmails(raw: string[]): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const s of raw) {
    const t = s.trim().toLowerCase();
    if (t.length === 0) continue;
    const ok = singleEmail.safeParse(t);
    if (!ok.success) {
      if (!invalid.includes(s.trim())) invalid.push(s.trim());
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    valid.push(t);
  }
  return { valid, invalid };
}

export const acceptInviteSchema = z
  .object({
    token: z.string().min(1, "Invite token is required"),
    name: z.string().min(2, "Name must be at least 2 characters"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
