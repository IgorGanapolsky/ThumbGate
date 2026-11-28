---
"thumbgate": minor
---

Opt-in auto-approvals from thumbs-up: `npx thumbgate auto-approve on` makes a tool call you gave a thumbs-up skip Claude Code's permission prompt next time (`permissionDecision: "allow"`). It only upgrades calls every ThumbGate check already let through, so hard blocks still win; a later thumbs-down on the same pattern revokes it; chained shell commands, `sudo`, `rm`, force-push, `git reset --hard`, `node -e` and `Write` are never auto-approved. `npx thumbgate auto-approve status` lists what you have taught it.
