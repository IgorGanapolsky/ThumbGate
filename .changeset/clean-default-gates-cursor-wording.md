---
"thumbgate": minor
---

A fresh install now starts with only the gates a new user would want. The corporate-email-isolation and off-brand-posting gates moved out of the default config into an opt-in profile (`config/gates/profiles/private-owner.json`, loaded through `THUMBGATE_EXTRA_GATES` or `~/.config/thumbgate/extra-gates.json`), and a hook call on a free install no longer prints license text unless `THUMBGATE_LICENSE_ADVISORY=1` is set. The README and the site now say what Cursor really does: shell commands are denied before they run through its `beforeShellExecution` hook, every other Cursor tool is advisory, and the hook allows the command if it errors.
