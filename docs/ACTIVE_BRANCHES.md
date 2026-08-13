# Active Branches

This file coordinates active development branches across the team. Every agent must read this before starting work to check for file ownership conflicts.

## Rules

- **Add your row before starting work** — do not skip this even for small changes
- **Remove your row when your PR merges** — same session as the merge receipt
- Stale rows (merged PRs) cause false conflict warnings — keep this file accurate

## Current Active Branches

| Branch | Owner | Status | Files Owned | Notes |
|--------|-------|--------|-------------|-------|
| fix/field-tracker-webhook-transaction | Phil | in progress | app/api/webhooks/field-tracker/route.ts, __tests__/integration/webhooks-field-tracker.integration.test.ts | Fix Field Tracker → Rad-Dash webhook 500 from Prisma interactive transaction on Railway |

## Status Values

| Status | Meaning |
|--------|---------|
| `in progress` | Actively being developed |
| `pushed, awaiting local verify` | Branch pushed, PR not yet opened — owner verifying locally |
| `pr open` | PR is open, in review |
| `pr merged` | PR merged — row should be deleted this session |

## Archive

*Branches that have merged are deleted from the table above immediately. No archive needed — Git history is the record.*
