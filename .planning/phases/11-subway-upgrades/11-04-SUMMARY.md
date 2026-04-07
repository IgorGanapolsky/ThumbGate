---
phase: 11-subway-upgrades
plan: "04"
subsystem: subway-upgrades
tags: [self-healing, gh-actions, workflows, subway, ThumbGate]
dependency_graph:
  requires: [ThumbGate/.github/workflows/self-healing-monitor.yml, ThumbGate/.github/workflows/self-healing-auto-fix.yml]
  provides: [Subway/.github/workflows/self-healing-monitor.yml, Subway/.github/workflows/self-healing-auto-fix.yml]
  affects: [Subway CI health monitoring]
tech_stack:
  added: []
  patterns: [scheduled-health-check, auto-remediation-pr, github-actions-workflow]
key_files:
  created: [Subway/.github/workflows/self-healing-monitor.yml, Subway/.github/workflows/self-healing-auto-fix.yml, scripts/prove-subway-upgrades.js, proof/subway-upgrades/subway-upgrades-report.json]
  modified: [Subway/package.json]
decisions:
  - "Subway self-healing workflows reference same scripts as ThumbGate: self-healing-check.js + self-heal.js"
  - "test:governance in Subway package.json uses NODE_OPTIONS=--experimental-vm-modules for LanceDB dynamic import support"
  - "prove-subway-upgrades.js uses NODE_OPTIONS env var when invoking Subway Jest to bypass --experimental-vm-modules requirement"
  - "SUBW-05 proof check captures Jest output from both stdout and stderr (err.stdout + err.stderr pattern)"
metrics:
  duration: 5min
  completed: 2026-03-04
  tasks: 2
  files: 4
---

# Phase 11 Plan 04: Self-Healing Workflows + Proof Gate Summary

Ported ThumbGate self-healing GH Action workflows to Subway, added test:governance script, and created the full Phase 11 proof gate.

## What Was Built

1. **`Subway/.github/workflows/self-healing-monitor.yml`** — Scheduled health monitor:
   - Runs every 6 hours via cron
   - Runs self-healing-check.js + uploads artifact
   - Creates/updates GitHub issue on unhealthy status
   - Closes stale issue when healthy
   - Triggers auto-heal job if unhealthy

2. **`Subway/.github/workflows/self-healing-auto-fix.yml`** — Scheduled auto-fix:
   - Runs every 12 hours
   - Runs self-heal.js
   - Opens remediation PR if changes generated

3. **`Subway/package.json`** — Added scripts:
   - `test:governance`: `NODE_OPTIONS=--experimental-vm-modules jest --config jest.governance.config.js`
   - `self-heal:check`: `node scripts/self-healing-check.js`
   - `self-heal:run`: `node scripts/self-heal.js --reason=manual`

4. **`scripts/prove-subway-upgrades.js`** — 5-check proof gate (SUBW-01..05)

5. **`proof/subway-upgrades/subway-upgrades-report.json`** + `.md` — All 5 requirements passing

## Deviations from Plan

None — executed exactly as specified.

## Self-Check: PASSED

- Subway self-healing-monitor.yml: EXISTS, references self-healing-check.js + self-heal.js
- Subway self-healing-auto-fix.yml: EXISTS, references self-heal.js
- Subway test:governance script: EXISTS with NODE_OPTIONS=--experimental-vm-modules
- prove-subway-upgrades.js: EXISTS (5/5 SUBW requirements passing)
- proof/subway-upgrades/subway-upgrades-report.json: EXISTS
- proof/subway-upgrades/subway-upgrades-report.md: EXISTS
- All Phase 11 Subway Jest tests: 25 passed, 0 failures (vector-store + dpo + thompson)
