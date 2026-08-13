# API contracts (rad-dash)

This document tracks **HTTP API shape** for `app/api/**` routes: methods, auth expectations, request/response fields, and error codes.

When you add or change a route handler, update this file in the same PR so reviewers can see the contract at a glance.

## Conventions

- Routes are under `app/api/` (Next.js App Router).
- Prefer Zod validation for request bodies; document optional vs required fields here.

## Routes

### Projects (`/api/projects`)

- **GET** `/api/projects` — Auth required. Returns `{ projects: Project[] }` (`id`, `name`, `description`, timestamps).
- **POST** `/api/projects` — Body `{ name: string, description?: string | null }`. **Triage only.** 201 returns created project.
- **GET** `/api/projects/[id]` — Auth required. Returns project + `ticketCount`.
- **PATCH** `/api/projects/[id]` — Body `{ name?: string, description?: string | null }`. **Triage only.**
- **DELETE** `/api/projects/[id]` — **Triage only.** Returns **409** `PROJECT_HAS_TICKETS` if any ticket references the project.

### Tags (`/api/tags`)

- **GET** `/api/tags?q=` — Auth required. Optional search; returns up to 20 tags `{ id, name }`.

### Tickets (`/api/tickets`)

- **GET** — Query `projectId` (optional, cuid) filters tickets to that project; composes with `archived=true`. Responses include `project`, `tags`, `storyPoints` where applicable.
- **POST** — Creates ticket for the session user. Body: `type` (`BUG` | `FEATURE_REQUEST` | `FEEDBACK`), `title`, `description`, optional `screenshot`, `videoUrl`, `pageUrl`, optional `projectId` (omit, `null`, or empty string for no project; otherwise must exist). Optional `assigneeId` (nullable): assignee must be eligible (`ADMIN`/`MEMBER` role). Optional `priority` and `storyPoints` (0–99 or null): **triage only** (403 for non-triage if either field is present). Optional `sprintId` (triage only): requires a `projectId` that belongs to that sprint. Assignee notification email fires when assigning someone other than the creator.
- **PATCH** `/api/tickets/[id]` — Triage may set `projectId`, `storyPoints` (0–99 or null), `tagNames` (array replaces tag set when present).
- **POST** `/api/tickets/bulk` — Additional actions: `setProject`, `setStoryPoints`, `setTags` (`replace` | `add` | `remove` + `tagNames`). **Triage only** for those actions.

### Ticket comments (`/api/tickets/[id]/comments`)

- **POST** — Body `body` (string, max 4000) and optional attachment arrays (`attachmentKeys`, `attachmentUrls`, etc., up to 10 each). Either a non-empty trimmed `body` or at least one attachment is required.
