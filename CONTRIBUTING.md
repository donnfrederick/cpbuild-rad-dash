# Contributing to RadDash

Welcome to the RadDash repo. This guide gets you from zero to a working branch in about 5 minutes.

---

## 1. Access

You need to be a member of the `cp-build-dev-ops` GitHub org. If you're not yet, ask Phil.

## 2. Clone

```bash
git clone https://github.com/cp-build-dev-ops/rad-dash.git
cd rad-dash
```

> **Note:** The stack is being decided by the team. If there is no app code yet when you clone, that's expected — see Step 5.

## 3. Open in Cursor

Open the `rad-dash` folder in Cursor. The agent rules in `.cursor/rules/` load automatically. Your Cursor agent will know the full workflow and can guide you through anything in this doc.

## 4. Check for Conflicts Before Starting

Before you create a branch, check what other team members are actively working on:

```bash
cat docs/ACTIVE_BRANCHES.md
```

If another developer owns files you need to touch, coordinate with them first. Don't skip this step.

## 5. If There's No App Code Yet (Scaffold Phase)

The team is deciding the stack. Do not create a scaffold independently — confirm with Phil first:
- What stack are we using?
- Is there a `feat/initial-scaffold` branch already in progress?

Once confirmed, create your branch (see Step 6) and build from there.

## 6. Create a Branch

Always branch from `dev`:

```bash
git fetch origin
git checkout -b feat/your-feature-name origin/dev
```

Branch naming:
- `feat/` — new features
- `fix/` — bug fixes
- `chore/` — maintenance, config, docs
- `hannah/` — design/UI (Hannah only)

## 7. Register Your Branch

**Required before writing any code.** Add a row to `docs/ACTIVE_BRANCHES.md`:

```markdown
| feat/your-feature-name | Your Name | in progress | /path/to/files/you/own | Brief note |
```

This prevents two people accidentally editing the same files.

## 8. Write Code + Tests

Every code change needs a corresponding test. See `.cursor/rules/testing.mdc` for what's required.

Your Cursor agent will remind you if you're missing tests.

## 9. Quality Gate — Must Pass Before PR

```bash
npm run build       # no TypeScript errors
npm run lint        # 0 errors (warnings OK)
npm run test:unit   # all unit tests green
```

If any of these fail, fix it before opening a PR. CI will block the PR otherwise.

## 10. Open a PR

```bash
git push origin feat/your-feature-name
```

Then in Cursor, tell your agent "ready to open the PR" and it will handle it. Or manually:

```bash
gh pr create --base dev --title "feat: your feature" --body "..."
```

**Always target `dev`. Never `main`.**

Copilot will automatically review your PR. Your agent will help you address any comments.

## 11. After Your PR Merges

- Phil handles the deploy to dev and notifies the team to verify
- Remove your row from `docs/ACTIVE_BRANCHES.md`
- Phil will promote to prod after verification

---

## Roles

| Who | What they do | Can merge PRs? | Can deploy? |
|-----|-------------|----------------|------------|
| Phil | Product, backend, deployments | Yes | Yes |
| RAD dev team | Feature development | No | No |
| Hannah | Design / UI | No | No |

---

## Key Files to Know

| File | What it is |
|------|-----------|
| `docs/ACTIVE_BRANCHES.md` | Live coordination — who owns what files |
| `docs/PENDING_REMINDERS.md` | Outstanding items across sessions |
| `docs/agent-context/project-overview.md` | Full project context for AI agents |
| `.cursor/rules/git-pr-workflow.mdc` | Complete PR and branching rules |
| `.cursor/rules/testing.mdc` | Testing requirements |
| `.cursor/rules/project-scope.mdc` | What RadDash is and is not |

---

## Questions?

- **Workflow / process questions** → your Cursor agent has the full rules loaded
- **Product / priority questions** → Phil
- **Design questions** → Hannah
- **Command Center integration questions** → Phil (he owns that integration surface)
