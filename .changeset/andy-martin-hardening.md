---
thumbgate: patch
---

Ship all runtime files in the npm bundle and self-protect ThumbGate's own governance files.

- Adds a pack-integrity test that fails if any runtime `require()` reachable from the shipped entrypoints is missing from the tarball — the class of bug that broke 1.27.19 (missing `feedback-sanitizer.js` crashed the prompt hook for every user).
- Adds `scripts/self-protection.js`: edits to ThumbGate's own kill-switch files (`.claude/settings.json`, hook scripts, `config/gates/**`) now WARN by default and hard-block under `THUMBGATE_STRICT_ENFORCEMENT=1`, with a `THUMBGATE_ALLOW_SELF_EDIT=1` escape hatch that preserves the repair path.

Prompted by Andy Martin's review.
