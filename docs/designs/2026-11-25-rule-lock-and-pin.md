# Rule lock and pin (proposal, not built)

Status: PROPOSAL for the lead's reply. No code is written. Base commit: a9b7a1c2d (origin/main, 25 Nov 2026).
Idea source: Anthropic, "Turn artifacts into Mac and Windows apps" (24 Nov 2026): a permission covers only the exact
version of an app, so any update asks again, and code loaded from another site can change without a new request.
This is our reading of that idea; it implies no use or endorsement by Anthropic of anything of ours.

## Problem

A person approves ThumbGate's rules once. Later the rule files can change (a hand edit, a script, another package)
and the gates in force are no longer the ones the person approved, with no signal. Item 1 below says what exists today.

## What exists today (checked in code)

- Actions are fingerprinted, rules are not. `actionApprovalDigest` (scripts/gates-engine.js:743-749) hashes the tool
  name, tool input and project; an admin override is requested for that digest (:776-801), so an approval covers one
  exact action only.
- A gate can pin a program: `executable_hash` (scripts/gates-engine.js:2972-2975, `computeExecutableHash` :52-76)
  compares the sha256 of the command's binary and does not match on a different binary.
- The audit line carries `catalogHash`, a sha256 of the gate config (scripts/audit-trail.js:264,323, item Q). It is
  recorded, never compared, so a changed config is not flagged.
- Rule files are read with no hash check: `loadGatesConfig` (scripts/gates-engine.js:460-537) reads the default
  config or THUMBGATE_GATES_CONFIG, the auto-promoted gates file, `~/.config/thumbgate/extra-gates.json` or
  THUMBGATE_EXTRA_GATES, the shared-tree profile and THUMBGATE_HARNESS_CONFIG, all with `fs.readFileSync`.
- Nothing is loaded from a URL or another package: no fetch in that function. Hooks are pinned to a package version
  (scripts/auto-wire-hooks.js:50) and the background update installs `thumbgate@<version>`
  (scripts/runtime-auto-update.js:85-95); that is a version, not a content hash.

## Goals

- REQ-01: an opt-in lock records a fingerprint of each rule source; a changed source is flagged.
- REQ-02: the fingerprint is of the parsed gates (pattern, action, severity), not the file bytes, so whitespace and
  key order do not trigger it.
- REQ-03: a rule source loaded from outside the repo (URL or package, none exists today) needs a pinned sha256 in the
  lock, and a changed or missing hash is refused, never silently accepted.

## Smallest opt-in version

1. `thumbgate rules lock` writes `.thumbgate/rules.lock.json`: per source path, sha256 of
   `stableCanonicalStringify(gates)` (the helper at scripts/gates-engine.js:735) and the gate count.
2. In `loadGatesConfig`, when the lock file exists, compare each loaded source. Mode `flag` (default): print one
   stderr line and write an audit row with gate id `rule-lock-mismatch`. Mode `enforce`
   (THUMBGATE_RULE_LOCK=enforce): deny Bash, Write and Edit calls with a message naming the changed source until
   `thumbgate rules lock` is run again by a person in a terminal. Gates from a changed source are never dropped, so
   the check cannot weaken protection.
3. ThumbGate's own writer of the auto-promoted gates file updates that file's lock entry when it writes (learned
   gates change that file by design); only edits made outside it flag.
4. The lock path joins the protected globs, so an agent cannot rewrite it.
5. A future remote source (not built, none exists) must carry `sha256` in the lock; no hash or a different hash is a
   refusal to load.

## Alternatives

- Hash raw file bytes: simpler, but every reformat re-triggers an approval (matches on words, not action).
- Sign rules with a key: stronger against an attacker with write access, much more to run for a solo user.
- Do nothing until a remote loader exists: leaves hand-edit and script edits of rule files unnoticed today.

## Risks

- Learned gates rewrite the auto file all the time; step 3 is what keeps the lock quiet and must be tested.
- `enforce` can lock a person out of tool calls; the message must give the exact approve command, and `flag` is the
  default.
- Cost on the hot path: one sha256 over a few small JSON files per config load; measure before turning it on by default.

## Files changed (when built)

scripts/gates-engine.js (load-time compare), a new scripts/rule-lock.js (lock, compare, CLI), bin/cli.js (`rules lock`),
scripts/audit-trail.js (the mismatch row), config/gates/default.json (protected glob), tests/rule-lock.test.js.

## Test table (expected results)

| Case | Change | Expected |
| --- | --- | --- |
| Change | a gate pattern in the primary config edited after lock | flag: one stderr line and one `rule-lock-mismatch` audit row; enforce: Bash, Write, Edit denied naming the file; Read allowed |
| No change | same config reformatted (whitespace, key order) | no flag, no audit row |
| No change | config untouched | no flag |
| Learned gate | ThumbGate's own writer adds an auto-promoted gate | no flag; lock entry updated |
| Out-of-band edit | auto-promoted file edited by hand | flag |
| Remote change | pinned remote source returns different content | refused to load, flag row; gates already loaded stay |
| Remote, no pin | remote source in config with no sha256 in lock | refused to load |
| Lock tampering | an agent edits rules.lock.json | denied by the protected-path gate |
| Opt-out | no lock file | behaviour identical to today |

Check for each row: a node:test case that builds a temp config, runs `loadGatesConfig` and asserts the result and audit rows.
