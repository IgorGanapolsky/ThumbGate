---
name: craft-playbook-gate
description: >
  Rachel Woods's autonomous-AI episode is a playbook format, not a ThumbGate
  product. Keep one atomic playbook in git, refuse zero-touch on the first
  cycle, and require a backup hash plus a named approval before a structural
  self-edit. Use when checking a playbook outline, a CRAFT cycle, a self-edit,
  a trigger word, or a local stack. Do NOT use to install dayglass or skill-up,
  store the playbook in a vendor chat UI, spawn a subagent, call Asana or
  ClickUp, reply on YouTube, or email the host.
---

# Craft playbook gate — own the playbook, rent the model

## Goal

Keep one deliverable's trigger, inputs, steps, output, and escalation in git.
The first cycle keeps a named human step. A later cycle can close that step
only after every CRAFT stage is done and each locked win is text inside a step.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install dayglass or skill-up | `node scripts/craft-playbook-gate.js` |
| Use Docker or OpenSandbox | Home `git` and a relative `.md` or `.json` path |
| Store the playbook in a vendor chat UI | Boolean stages, in order: clear, realistic, setup, feedback, rollout |
| Approve a self-edit by line count or percent | A backup sha256 of the previous playbook |
| Spawn a subagent or call Asana or ClickUp | Explicit `approved: true` and a named `approvedBy` for a structural edit |
| Claim zero-touch on cycle 1 | Trigger word `nitpicking`, not `feedback` |
| Reply on the YouTube episode or email the host | A stack is done only when every child has `verified: true` |

## Procedures

```bash
node scripts/craft-playbook-gate.js --map-only
node scripts/craft-playbook-gate.js
npm run craft:playbook
npm run test:craft-playbook-gate
```

`--help` and `--map-only` print and exit without reading stdin. Any other
command reads one JSON object from stdin. The command writes nothing. Exit 0
is accept. Exit 1 is a hold. A minor detail tweak may be applied later only
when the backup hash matches and `feedbackRef` names the review. Changing the
trigger, a step id, an escalation flag, or the escalation text stays held
until a person approves it. Moving the playbook out of git, or onto an
absolute path, is a hold even when the rest of the edit is minor.

Code as truth: scripts/craft-playbook-gate.js
Provenance: https://www.youtube.com/watch?v=CMkwClAm2TI
