---
name: skill-observation-gate
description: >
  Dan Kornas and alibaba/skill-up are a skill-eval format, not a ThumbGate
  product. Admit a failure as a regression case only after explicit approval,
  judge failure rules before success rules, and keep the original when a rerun
  drops a case or turns a pass into a non-pass. Use when checking a skill
  observation or comparing two local skill-eval reports. Do NOT use to install
  skill-up, start Docker or OpenSandbox, call an agent judge, join the
  newsletter, or reply on X.
---

# Skill observation gate — compare, do not clone

## Goal

Turn one approved skill failure into a case that can be rerun on this machine.
A later revision is kept only when every earlier case is still there and every
earlier pass still passes.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install alibaba/skill-up or run its installer | `node scripts/skill-observation-gate.js` |
| Use Docker or OpenSandbox | Runtime `local` or `none` |
| Run an agent judge, a script judge, or a user simulator | `rule_based` rules: `skill_contains`, `skill_not_contains`, `file_exists` |
| Join https://dankornas.substack.com | `approved: true`, `attribution: "explicit"`, and a named `approvedBy` |
| Reply on X to the source post | Failure rules before success rules; `keep_original` on a regression |
| Copy skill-up coverage badges or benchmark numbers | `notOurMeasurement: true` on the idea map |

## Procedures

```bash
node scripts/skill-observation-gate.js --map-only
node scripts/skill-observation-gate.js admit --out case.json
node scripts/skill-observation-gate.js judge --case case.json --workspace .
node scripts/skill-observation-gate.js compare baseline.json candidate.json
npm run test:skill-observation-gate
```

`admit` reads one JSON object from stdin. A refused observation writes no file.
`compare` exits 0 on accept and 1 on `keep_original`.

Code as truth: scripts/skill-observation-gate.js
Provenance: https://x.com/DanKornas/status/2113860880592966054
