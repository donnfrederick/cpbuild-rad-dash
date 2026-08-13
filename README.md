# RadDash — RAD Team Task Management

Internal task management system for the CP Build RAD (Rapid Application Development) team.

## What This Is

RadDash is the RAD team's central hub for:

- **Task management** — tasks created from CP Build Command Center feedback items or generated directly by the team
- **Branch workflow** — tasks map to Git branches; the system tracks branch → PR → deploy lifecycle
- **Code review coordination** — Copilot-assisted reviews, design handoffs, and approval workflows
- **Process control** — structured task states from backlog through deployment and verification

## Integration with Command Center

RadDash connects to **CP Build Command Center** via its API (no shared database). Feedback items submitted in Command Center can be promoted to RadDash tasks through a dedicated integration endpoint.

```
Command Center (feedback submitted)
  → POST /api/integration/tasks  [Command Center → RadDash]
  → Task created in RadDash
  → Branch assigned → PR workflow → Deploy
```

## Repository Structure

```
rad-dash/
├── docs/
│   ├── ACTIVE_BRANCHES.md      # Live branch coordination table
│   ├── PENDING_REMINDERS.md    # Session-to-session reminders
│   └── agent-context/          # Distilled context files for AI agents
├── .cursor/
│   └── rules/                  # Cursor agent rules (workflow, testing, git)
└── [app code TBD by team]
```

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — protected, CI required |
| `dev` | Integration — all PRs target here first |
| `feat/*` | Feature work (dev team) |
| `fix/*` | Bug fixes |
| `chore/*` | Maintenance / config |
| `hannah/*` | Design / UI work |

## Getting Started

> Stack TBD — the team is deciding. This README will be updated once the tech direction is confirmed.

## Workflow

See `.cursor/rules/git-pr-workflow.mdc` for the full branching and PR workflow.

## Team

- **Phil Amour** — Product / Backend / Deployment
- **RAD Dev Team** — Feature development
- **Hannah** — Design / UI

---

*Part of the CP Build internal tooling ecosystem.*
