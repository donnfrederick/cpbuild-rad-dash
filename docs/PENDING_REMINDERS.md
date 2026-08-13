# Pending Reminders

Items in this file are surfaced at the start of every agent session until dismissed.
To dismiss an item, tell the agent and it will mark it `[x]` or remove it.

---

## Initial Setup Items

- [ ] **Confirm tech stack** — team to decide and update README + stack-specific agent-context files
- [ ] **Railway deployment** — set up dev + prod environments once stack is confirmed
- [ ] **Auth setup** — configure team authentication (NextAuth or equivalent) once stack is confirmed
- [ ] **Command Center integration** — implement `POST /api/integration/tasks` endpoint in Command Center after rad-dash API is scaffolded
- [ ] **Add team members** — invite RAD dev team members to the cp-build-dev-ops GitHub org and the rad-dash repo
- [ ] **Shared Cursor rules strategy** — decide how to keep `.cursor/rules/` in sync between command-center-reboot and rad-dash (symlink? shared git subtree? manual copy?)
