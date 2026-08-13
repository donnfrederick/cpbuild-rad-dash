# GitHub Actions (rad-dash)

Workflows mirror the **command-center-reboot** repo’s patterns: CI on PRs to `main` and `dev`, deploy on push to those branches, and PR automation on `dev`.

Configure the items below in the GitHub repo: **Settings** for this repository (or organization secrets if shared).

## Required secrets (typical)

| Secret | Used by |
|--------|---------|
| `RAILWAY_TOKEN` | Deploy |
| `RAILWAY_SERVICE_ID` | Deploy |
| `GEMINI_API_KEY` | Gemini PR analysis (optional; workflow skips if unset) |

## Optional secrets

| Secret | Used by |
|--------|---------|
| `RAILWAY_DEV_URL`, `RAILWAY_PROD_URL` | Deploy smoke checks |
| `TEAMS_WEBHOOK_URL` | Deploy notifier |
| `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` | Verify Dev (manual) |

## Repository variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_ANALYSIS_ENABLED` | Set to `false` to disable Gemini comments without removing the workflow |

## Branch protection

- Require status check **`lint-and-test`** (from workflow **CI**) before merging into `main` and `dev`, matching team policy.
- Add other required checks as needed (e.g. individual jobs if you split gates).

## Copilot code review ruleset

Create a **Repository ruleset** (Settings → Rules → Rulesets) that enables Copilot review on push for `main` and `dev`. See comments in [workflows/copilot-review.yml](workflows/copilot-review.yml) for how this complements the workflow that labels paths and requests reviewers.

## Maintainer handles

Several workflows reference `@cp-build-dev` for approvals and notifications. Update those YAML files if your default owner handle differs.
