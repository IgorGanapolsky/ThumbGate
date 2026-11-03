---
name: thumbgate-dashboard
description: Open the local HTTP dashboard for the current project in your web browser. Use for "open dashboard", "thumbgate-dashboard", "show my gates in the browser", "project dashboard", or "open the local ThumbGate UI".
allowed-tools: Bash(npx thumbgate dashboard:*)
---

# ThumbGate Dashboard

Open the local HTTP dashboard for the current project so you can inspect lessons, checks, gate stats, and tokens saved in the browser.

This command wraps existing ThumbGate capability — **no new logic**. It runs the existing project-scoped dashboard opener.

## Steps

1. Open the project-scoped dashboard:
   ```bash
   npx thumbgate dashboard --open
   ```
   Equivalent standalone shortcut after a global install:
   ```bash
   thumbgate-dashboard
   ```
2. Confirm the browser lands on the local dashboard for this repo (lessons, checks, gate stats, tokens saved).
3. If the command fails, run `npx thumbgate doctor` — a missing install is usually fixed by `npx thumbgate init`.

## Example

```
/thumbgate-dashboard
```
