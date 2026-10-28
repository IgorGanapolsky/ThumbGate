---
name: broadcast-swarm-sow
description: >
  One prompt is broadcast to Herdr, Gemini, and Antigravity. This doctor
  turns that prompt into three statements of work, lets one seat read the
  repo, and gives the write lease to the unique weighted winner. The judge
  seat does not write. Never install a harness, call a judge API, or spend
  on a second model.
  Slash: /broadcast-swarm-sow.
---

# Broadcast swarm statements of work

## Problem

One prompt is broadcast to every seat in Herdr and in Gemini/Antigravity. Each seat re-reads the repo and races the same files. Nobody is required to judge which patch wins.

## Technical Plan

A local doctor hashes the normalized prompt and derives three statement ids: broadcast, experts, and judge. Seats use the roles `fast_proposer`, `deep_architect`, `adversarial_verifier`, and `llm_judge` on the harnesses `herdr`, `gemini`, and `antigravity`. Only `fast_proposer` may scout or read the whole tree, and only while no capsule exists. Every other read is the capsule. `judge.score` ranks non-judge seats with fixed weights: correctness 40, token efficiency 25, speed 20, minimalism 15. `write.lease` allows only the unique highest integer total. A tie denies. The judge seat cannot write. The doctor does not open a network.

## Alternatives Rejected

Calling an external judge. Spawning a paid model per seat. Letting every seat write. Installing Herdr or another harness from the doctor. Starting or prompting an idle pane on a leased checkout. Quoting an unmeasured token-savings percent. Adding a hosted route.

## Enumerated Files

- `scripts/broadcast-swarm-sow.js`
- `.agents/skills/broadcast-swarm-sow/SKILL.md`
- `tests/broadcast-swarm-sow.test.js`
- `.changeset/broadcast-swarm-sow.md`
- `bin/cli.js`
- `package.json`
- `tests/public-core-boundary.test.js` (ceiling 638 to 639; measured pack is 639 files)

## Goal

Every broadcast seat computes the same three statement ids. One seat publishes the capsule. One winner writes.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install a harness or curl an installer | `npx thumbgate broadcast-swarm-sow --json` |
| Call a judge API or spend on a second model | Weights stay 40 / 25 / 20 / 15 |
| Let every seat write | `write.lease` names the unique winner |
| Scout again after a capsule exists | Later reads use `readScope: capsule` |
| Let the judge seat write | `llm_judge` scores and stops |

## Procedures

```bash
npx thumbgate broadcast-swarm-sow --json --map-only
npx thumbgate broadcast-swarm-sow --json --policy=policy.json --action=action.json
npm run test:broadcast-swarm-sow
```

`policy.prompt` is required. The prompt is lower-cased, whitespace is collapsed, and the first 16 hex characters of its sha256 are the shared hash. Statement ids are `SOW-` plus 8 uppercase hex characters from sha256 of `broadcast:<hash>`, `experts:<hash>`, and `judge:<hash>`.

Points: `sow.open`, `seat.claim`, `capsule.publish`, `context.read`, `judge.score`, `write.lease`. An install, a fetch, a spend, or `allWrite` denies before the point check. A policy or action present as null, false, or 0 fails closed. `sow.open` with an empty seat list is ready. `judge.score` and `write.lease` need each role once and an integer score from 0 to 100 for every non-judge seat.

The reward-function script is a different surface. This doctor does not call it and does not add a route.
