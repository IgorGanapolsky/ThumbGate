---
name: infoq-architect-honesty-not-clone
description: >
  InfoQ's September 2026 architects newsletter is FORMAT, not a ThumbGate
  product. Steal code-as-truth, a typed host, the existing lease, and
  time-in-queue. Never register for InfoQ or QCon, install Vortex, or add
  Temporal. Slash: /infoq-architect-honesty-not-clone.
---

# InfoQ architect honesty — compare, do not clone

## Goal

Check a done claim and a queue against four ideas from the September 2026
InfoQ Software Architects' Newsletter.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Register for InfoQ certification or QCon | `npx thumbgate infoq-architect-honesty --json` |
| Install Vortex or quote sixty gigabits as ours | Typed host: bash, javascript, typescript, csharp, python, sql |
| Add Temporal, Step Functions, or Inngest | Session lease and `scripts/durability/step.js` |
| Treat queue depth as freshness | Age of the oldest `enqueuedAt`. Missing stamps stay review |

## Procedures

```bash
npx thumbgate infoq-architect-honesty --json --map-only
npx thumbgate infoq-architect-honesty --json --claim='shipped it
Code as truth: scripts/session-lease.js
Provenance: session-lease'
npx thumbgate infoq-architect-honesty --json --queue=queue.json --max-age-ms=3600000
npm run test:infoq-architect-honesty
```

A done claim names `Code as truth: <path>` and `Provenance: <id>`. The path has to exist.
