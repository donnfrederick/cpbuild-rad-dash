# Standalone ticketing app from Feedback inbox

> **Mirror of the Cursor plan** — keep in sync with  
> `.cursor/plans/standalone_ticketing_app_0fc6e29f.plan.md` when the plan changes.

---

# Standalone ticketing app from Feedback inbox

## Project location (exact)

All implementation for this plan lives in:

**`/Users/rendeelouiselloren/Documents/rendee/projects/rad-dash-prototype`**

It sits next to Command Center (`.../command-center-reboot`). There is no separate Git remote requirement yet—add `origin` on GitHub when you are ready; `git init` and work locally in this folder first if needed.

**Open this repo in Cursor** (File → Open Folder → `rad-dash-prototype`) so the agent runs in the correct workspace—not inside `command-center-reboot`.

## Agent prompt (copy into a new chat)

Paste this after attaching or pasting this plan file:

```text
Workspace: /Users/rendeelouiselloren/Documents/rendee/projects/rad-dash-prototype

Implement the attached plan “Standalone ticketing app from Feedback inbox.”

First: fix dependencies — remove broken node_modules (and package-lock.json if needed), use Node >= 20.19 or Node 22, run a clean npm install until Prisma installs cleanly (npx prisma -v works). The postinstall script runs prisma generate; ensure prisma/schema.prisma exists before relying on postinstall, or temporarily disable postinstall.

Then continue from the plan phases: Prisma ticket models → auth → /api/tickets → UI/i18n → tests → .env.example + README.

Command Center reference repo (read-only): ../command-center-reboot — components/feedback, app/api/feedback, lib/feedback-*.ts.
```

## Context

Command Center’s “Feedback inbox” is a full ticket-like subsystem:

- **UI:** `app/[locale]/(dashboard)/feedback/page.tsx`, `components/feedback/FeedbackInbox.tsx`, `FeedbackDetailView.tsx`, `FeedbackCommentThread.tsx`, `FeedbackModal.tsx` (and related pages under `feedback/[id]/`).
- **API:** `app/api/feedback/route.ts` and nested routes under `app/api/feedback/` (list, CRUD, comments, attachments, upload-recording, tour).
- **Authz:** `lib/feedback-access.ts` + `PERMISSIONS.SPECIAL_ACCESS_FEEDBACK_INBOX` (`feedback:inbox`).
- **Data:** Prisma models `FeedbackReport`, `FeedbackComment`, `FeedbackMention`, plus `Notification` rows for feedback events and optional `FeedbackTour` (admin “watch tour” on resolved items).
- **Cross-env merge (omit in v1):** `lib/feedback-prod-client.ts`, `lib/feedback-prod-proxy.ts`, `app/api/internal/feedback/*`, `GET /api/feedback/prod-assignees` — these exist so **dev** can merge **prod** feedback in one inbox. A greenfield ticketing app with one DB per environment does not need this.

You chose **standalone Supabase + NextAuth users** (no shared identity with Command Center) — the plan follows that.

## Recommended naming for scalability

Rename concepts in the new app from “feedback” to **tickets** (DB tables, routes, i18n namespace, permissions). Keeps Command Center unchanged and avoids baking “feedback” into a future PM product.

- Example permission: `tickets:triage` (maps to today’s `feedback:inbox`).
- Example API prefix: `/api/tickets` (same handler shapes as current `/api/feedback` where it helps porting).

Optional **schema hook for later PM**: add nullable `projectId` (or `workspaceId`) on the ticket model from day one, unused in UI until you build projects — or skip until the second milestone; both are valid; skipping reduces migration noise for v1.

## Phase 1 — Repo bootstrap (mirror stack)

1. **Initialize the app in** `/Users/rendeelouiselloren/Documents/rendee/projects/rad-dash-prototype` using the same major choices as Command Center: Next.js App Router, **Prisma 7** + PostgreSQL, **NextAuth v5** (JWT), **next-intl** (`/en`, `/es`), Tailwind + design tokens (copy the token approach from Command Center `app/globals.css` / `LAYOUT_RULES.md` as needed — do not depend on Command Center at runtime).
2. **Tooling parity:** ESLint, Vitest, MSW for integration tests, GitHub Actions pattern aligned with Command Center `deploy.yml` (adapt service name / Railway project).
3. **Minimal auth surface:** `User`, `Role`, session strategy consistent with Command Center `lib/auth.ts` / `lib/dev-session.ts` patterns only as much as you need (e.g. `DEV_BYPASS_AUTH` for local dev if you want parity).

## Phase 2 — Data model (slim Prisma)

Port a **subset** of Command Center `prisma/schema.prisma` relevant to tickets:

| Command Center | New app (suggested) |
|----------------|---------------------|
| `FeedbackReport` | `Ticket` (same fields: type, title, description, screenshot, videoUrl, pageUrl, status, priority, source, adminNote, shortId, assignee, submitter) |
| `FeedbackComment` | `TicketComment` |
| `FeedbackMention` | `TicketMention` |
| `Notification` (feedback types only) | `Notification` with only ticket-related `NotificationType` values, or defer email and keep in-app notifications only for v1 |
| `FeedbackTour` | **Defer** unless you need resolution tours on day one |
| `MediaAttachment` usage for comments | Port the same attachment pattern as `lib/feedback-comment-attachments.ts` + storage keys under a ticket-specific prefix |

**Do not port** in v1: internal feedback bridge tables/routes, `FEEDBACK_BRIDGE_*` env vars, prod-merge logic, `environment` tagging on list rows.

## Phase 3 — API and server lib

1. Implement `GET/POST /api/tickets`, `GET/PATCH/DELETE /api/tickets/[id]`, comments routes, upload-recording (if you keep video), mirroring behavior documented in Command Center `docs/agent-context/api-endpoints.md` (Feedback section) **minus** `?environment=production` and internal proxy.
2. Port or rewrite helpers: list `where` clause (`lib/feedback-access.ts`), assignee allowlist (`lib/feedback-assignment.ts`), inbox filters (`lib/feedback-inbox-filters.ts`) — drop **environment** filter if single-DB.
3. Email notifications: port only what you need from the feedback flow (e.g. assign + mention) using the same Resend pattern as `lib/email.ts` if Command Center already has `sendFeedbackAssignedEmail` / mention templates — adjust copy and deep links to the **new** app’s origin.

## Phase 4 — UI and i18n

1. Port client components with renames; keep URL query pattern for deep-linking (`?open=`) if you liked the current UX (`FeedbackInbox.tsx`).
2. Add `messages/en.json` / `es.json` keys under a `tickets` namespace (copy structure from existing `feedback` keys).
3. Navigation: register a dashboard nav item analogous to how Feedback is linked today (find reference in layout/sidebar in Command Center).

## Phase 5 — Tests

1. Use `__tests__/integration/feedback.integration.test.ts` and `__tests__/unit/feedback-access.unit.test.ts` as **behavioral templates** for ticket list authz, triage PATCH rules, and mention visibility.
2. Keep the **Unifier-style fixture discipline** only if you ingest external payloads; for pure ticketing, standard Zod + empty-string cases still apply for optional fields.

## Phase 6 — Command Center relationship (no blocker for launch)

- **Short term:** Leave Command Center’s Feedback inbox as-is; users file app issues there, and **operational/project tickets** live in the new app.
- **Later (optional):** Link apps via SSO (same IdP), “Open in PM” deep links, or a small sync job — only after both apps have stable identities.

## Scalability principles (structural)

- **Feature module layout:** group by `tickets/` (components, `lib/tickets/*`, `app/api/tickets/*`) so adding `projects/` later does not sprawl across `app/` blindly.
- **API versioning:** keep v1 routes stable; add `/api/v2/...` or new resources (`/api/projects`) when PM entities arrive instead of overloading ticket fields.
- **DB:** separate Supabase instance per app (your choice) keeps blast radius small; use migrations in `prisma/migrations/` the same way Command Center does.

## What you explicitly skip in v1 (can add later)

- Dev/prod feedback merge and `app/api/internal/feedback` stack.
- `FeedbackTour` / tour player coupling unless product requires it.
- Any Unifier or Command Center–specific entities.

## Session status and resume (handoff)

**Already done (partial bootstrap):**

- `create-next-app` scaffold exists under `rad-dash-prototype` (default `app/`, Tailwind, `tsconfig`, etc.).
- `package.json` was expanded toward the target stack: Next 16, Prisma 7 + adapter-pg, NextAuth v5, next-intl, Vitest/MSW, scripts including `dev` on port **3003** with `--webpack`, `bootstrap:admin` placeholder, and `postinstall: prisma generate`.
- `package-lock.json` may exist from install attempts.

**Blocked / broken:**

- **`npm install` did not finish cleanly** (corrupted tarballs, `TAR_ENTRY_ERROR` on `@prisma/client`, incomplete `node_modules`, Prisma postinstall missing files). **Do not assume dependencies are usable** until a clean install succeeds.

**First steps for the next agent:**

1. Use **Node >= 20.19** or **Node 22** (aligns with Prisma 7 / toolchain engine ranges).
2. Delete **`node_modules`** and reinstall; if needed delete **`package-lock.json`** and run `npm install` again; or `npm cache clean --force` then reinstall.
3. Confirm **`npx prisma -v`** and **`npm run build`** (after minimal schema exists).
4. Until **`prisma/schema.prisma`** exists, either add the schema first or **temporarily remove** `"postinstall": "prisma generate"` from `package.json` so install is not blocked.

**Still not implemented (follow plan phases):**

| Area | Notes |
|------|--------|
| `prisma/schema.prisma`, `prisma.config.ts`, migrations | Required |
| `lib/db.ts`, auth, permissions, ticket-access helpers | Required |
| `/api/tickets/*`, comments, attachments prefix | No prod bridge |
| next-intl wiring, `app/[locale]/...`, `messages/*` | `tickets` namespace |
| UI port from Feedback components | Inbox, detail, modal, nav |
| Vitest configs + tests | From CC feedback tests |
| `.env.example`, README env/deploy section | Required for handoff |
| CI/Railway | Optional |

**Reference implementation paths (Command Center):** `components/feedback/*`, `app/api/feedback/*`, `lib/feedback-access.ts`, `lib/feedback-assignment.ts`, `lib/feedback-inbox-filters.ts`, `lib/feedback-comment-attachments.ts`, `__tests__/integration/feedback.integration.test.ts`, `__tests__/unit/feedback-access.unit.test.ts`.
