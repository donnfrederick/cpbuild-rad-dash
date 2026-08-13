# Project Overview — RadDash

> Last updated: 2026-04-09
> Stack: TBD (team deciding)

## What This Project Is

RadDash is the RAD team's internal task management and process control system. It integrates with CP Build Command Center to receive feedback items and convert them to tracked tasks.

## Key Concepts

### Tasks
A task represents a unit of work. It may originate from:
- A Command Center feedback item (via API integration)
- Direct creation by a team member

Every task has:
- A status (planning, in progress, in review, deployed, verified)
- An optional branch assignment
- An optional PR link
- An assignee

### Branch Workflow
Tasks drive branch creation. When a developer picks up a task, they create a branch named after the task ID or slug. RadDash tracks the branch → PR → deploy lifecycle for each task.

### Design Handoff
Tasks of type `design` flow through Hannah's design review process before development begins. RadDash tracks design approval state separately from dev progress.

## Integration with Command Center

Command Center pushes feedback items to RadDash via:

```
POST /api/integration/tasks
Authorization: Bearer <API_KEY>
Body: { feedbackId, title, description, priority, submittedBy, ... }
```

RadDash must deduplicate on `feedbackId` so the same feedback item cannot create two tasks.

## Architecture (TBD)

- **Tech stack**: TBD — team deciding
- **Database**: TBD (PostgreSQL recommended for consistency with Command Center)
- **Auth**: TBD (NextAuth v5 recommended — team-only, not public)
- **Deployment**: Railway (dev + prod)
- **Port** (local dev): TBD (3003 recommended)

## Team

| Person | Role | GitHub |
|--------|------|--------|
| Phil Amour | Admin / Product / Deploy | `philipamour` |
| RAD dev team | Feature development | TBD |
| Hannah | Design / UI | TBD |

## Context File Map

| File | Contents |
|------|---------|
| `project-overview.md` | This file |
| `architecture.md` | System architecture, stack details (TBD) |
| `database-schema.md` | Prisma schema, table descriptions (TBD) |
| `api-endpoints.md` | All API routes and Zod schemas (TBD) |
| `backend-patterns.md` | Auth, permissions, service layer patterns (TBD) |
| `frontend-patterns.md` | Component patterns, CSS tokens, i18n (TBD) |
| `key-services.md` | lib/ utilities and services (TBD) |
