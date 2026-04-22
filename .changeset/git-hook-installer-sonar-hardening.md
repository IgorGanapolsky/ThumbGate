---
"thumbgate": patch
---

fix(installer): harden git-hook-installer.js against SonarCloud quality-gate findings

- Tighten hook file permissions from `0o755` to `0o700`. Git runs hooks as the
  same user that invoked the git command, so group/other execute bits served
  no purpose and only widened the attack surface (SonarCloud S2612).
- Replace `require.main === module` with an explicit `isCliEntrypoint()` helper
  comparing `require.main.filename` against `__filename`. The strict-equality
  idiom tripped SonarCloud S3403 ("this check will always be false") under its
  TypeScript flow analyzer; the filename-based check has no such ambiguity and
  also makes the CLI-detection path unit-testable.
- Document why `spawnSync('git', …)` is safe with a NOSONAR annotation
  (S4036 hotspot review). The installer must honor the developer's PATH
  because git ships from a dozen different locations (brew, apt, scoop,
  Xcode, Git-for-Windows); args is always an array, so no shell interpolation
  risk; and the command literal is hard-coded, not user-supplied.

Adds regression tests covering the new owner-only permission bits and the
new `isCliEntrypoint` helper.
