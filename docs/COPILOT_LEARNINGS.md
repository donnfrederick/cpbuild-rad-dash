# Copilot Learnings Log

This file is a living record of two types of entries:

1. **Copilot catches** — patterns GitHub Copilot caught in code review that the agent or developer did not catch before pushing
2. **Session retrospectives** — agent process failures identified during a session — tagged `session retrospective` in the heading

Both types drive the same goals:

- **Pre-push self-check** — Agents read this before writing new code in the relevant categories
- **Rule distillation** — Periodically reviewed and distilled into `.cursor/rules/` so patterns become proactive, not reactive

**Agents: when you resolve a Copilot comment or identify a process failure, add a row here before closing the PR.**

---

## How to Add an Entry

```markdown
### YYYY-MM-DD | PR #N | category/subcategory

**What Copilot caught:** One sentence describing the bug/risk.
**Root cause:** Why the agent missed it — what assumption was wrong.
**Fix applied:** What was changed.
**Rule to add / reinforce:** The principle that would have prevented this.
```

---

<!-- Entries below (### YYYY-MM-DD ...) are counted by .github/workflows/distill-learnings.yml -->
