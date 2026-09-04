---
name: package-manager-honesty-doctor
description: >
  Audit lockfile/packageManager/CI install parity and fail-closed package-manager
  switches. Steal from InfoQ pnpm 12 (Rust rewrite) — do NOT migrate ThumbGate
  off npm. Prefer --ignore-scripts honesty. Slash: /package-manager-honesty-doctor.
---

# Package-Manager Honesty Doctor

## When
pnpm 12, InfoQ pnpm Rust, migrate to pnpm/yarn/bun, dual lockfiles, CI npm ci vs pnpm, ignore-scripts.

## Do
```bash
npx thumbgate package-manager-honesty-doctor --json
npx thumbgate package-manager-honesty-doctor --propose-switch=pnpm --json
```

## Never
- Add pnpm-lock.yaml beside package-lock.json
- Rewrite CI to pnpm casually on this public npm package
- Treat npm lifecycle scripts as safe by default
