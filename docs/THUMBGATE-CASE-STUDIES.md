# ThumbGate case studies

Five narratives from real work on this codebase. Every technical claim is verifiable against
`origin/main` or the commands recorded inline. Written as
Situation → Problem → Action → Technical decisions → Result → What we learned.

---

## 1. The hard technical problem — a guardrail you could walk past by typing `sudo`

**Situation.** ThumbGate sits in the PreToolUse path of every agent on every paired machine.
Its declarative gates are regexes in `config/gates/default.json`. Four of them —
`git-reset-hard`, `git-clean-force`, `force-push`, `rm-rf-home-or-root` — are documented in the
engine as effectively irreversible and exempt from every discount and downgrade path.

**Problem.** All four were defeated by a one-token prefix. On shipped 1.29.1:

```
rm -rf ~        -> deny
sudo rm -rf ~   -> NO GATE MATCHED
sudo rm -rf /   -> NO GATE MATCHED
```

The root cause was the command-position anchor `(?:^|[;&|]\s*)`. It recognises a command at
the very start of a string or immediately after `;`, `&`, `|` — and nothing else. Not after a
newline. Not after `sudo`, `env FOO=1`, `/usr/bin/`, `command`, quoting, or a backslash. Git
compounded it from the other side: `git -C <dir> push --force` doesn't match `git\s+push`
either.

**Action.** Stopped hand-picking examples and built a grid: 14 gated commands × 9 ways of
re-spelling them, run against both the old and new build. That turned "is it closed?" from a
judgement into a number. **62 evasion holes on 1.29.1.**

**Technical decisions.**

1. *Canonicalize, don't complicate the regexes.* Rewriting 61 gate patterns to handle every
   prefix would be 61 chances to get it wrong. Instead, normalize the command — strip
   separators, env assignments, wrapper binaries, quoting, directory prefixes, git global
   options — and match against the canonical form.
2. *Match original **or** canonical, never canonical alone.* This makes the change strictly
   additive: a command that already matched cannot stop matching. No existing verdict changes.
3. *Fix it centrally, not per-helper.* First attempt patched the pattern path only. Review
   found `"npm" publish` still slipping through, because ~15 helpers independently read
   `toolInput.command` and run their own analysis. Patching each is how the sixteenth gets
   missed. Final design: evaluate normally, and **only if nothing matched**, re-evaluate
   against the canonical command. Every helper is covered without touching any of them.
4. *Widen when unresolvable.* `$VAR`, globs, unexpandable `cd` targets → treat as broad rather
   than guessing a path. Guessing produces a confident wrong answer, which is worse than
   admitting ignorance.

**Result.** 62 holes → 0, verified against the published tarball, not just the source. Shipped
in 1.29.2 and confirmed on the mini: `sudo rm -rf ~` flipped from allow to deny. The grid is
now `tests/gate-evasion-matrix.test.js` in CI, plus a 6-hourly job running it against whatever
version is currently on npm.

**What we learned.** For a guardrail, *the set of things you didn't think of* is the product.
A test suite that checks the happy path proves nothing about evasion; only an adversarial grid
does. And a known residual is worth recording as a failing-if-fixed test — `$(which git)`
still evades, because static canonicalization cannot resolve a subshell without executing it.
Naming that beats pretending closure.

---

## 2. The ambiguous problem — a bug report where most of the bugs weren't real

**Situation.** A sibling agent on another machine filed a seven-defect report against
ThumbGate with a statistics table and confident root-cause analysis: warn-by-default not
controlling enforcement, zero graduated response, entropy computed and ignored, semantic
matching firing on nonsense, blast radius from the wrong source, a catch-all pattern,
non-deterministic verdicts.

**Problem.** No spec said what correct behaviour was. The report was internally plausible and
written with authority. Accepting it wholesale meant rewriting the enforcement core; rejecting
it meant ignoring a colleague's field report. There was no requirements document to arbitrate.

**Action.** Treated each defect as a hypothesis and went looking for the disconfirming
evidence rather than the confirming kind.

**Technical decisions.**

- *Read the consuming repo's own config first.* The "warn-by-default doesn't control
  enforcement" claim dissolved immediately: that repo's `.claude/settings.json` exports
  `THUMBGATE_STRICT_ENFORCEMENT=1` in every hook. It had opted into strict mode. The advisory
  banner it cited is unreachable in strict mode, and appears in zero persisted records.
- *Check the reported numbers against the source data.* "1,017 blocks, 0 warnings" omitted the
  dominant gate (6,699 blocks) and every warn-mode gate. Real totals: 8,892 blocked, 3,690
  warned. Graduated response existed; the table was filtered.
- *Reproduce before believing.* Defect 5 — blast radius from the working tree — reproduced
  exactly: `git add -- a.js b.js` in a repo with 2,089 dirty files reported 2,091 affected.
- *Follow the real signal past the report.* Defect 7 claimed non-deterministic verdicts and
  blamed a stochastic term. There is none; every `Math.random()` is ID generation. The true
  cause was defect 5 — the working tree changes as other agents write, so the same command is
  judged against different inputs. State-dependent, not random. That reframing made it fixable.

**Result.** Two of seven real. One (memory-guard matching) real but for a different reason than
claimed — not embedding proximity, but the JSON envelope's own key names polluting the match
haystack, so any guard containing two common words blocked everything. And the investigation
surfaced something worse than anything reported: the bypass in case study 1.

**What we learned.** An authoritative report with numbers is still a hypothesis. The most
valuable question was not "is this defect real?" but "what would have to be true for this to
be real?" — which is what exposed the strict-mode setting and the filtered table. Ambiguity
resolved faster by reading the *consumer's configuration* than by re-reading our own code.

---

## 3. The production failure — a firewall that was enforcing nothing

**Situation.** Mid-session, needing real gate statistics to validate a new monitor, ran a
routine command against the mac mini's ThumbGate state directory.

**Problem.** `~/.thumbgate/gate-stats.json` did not exist. Earlier the same session it had
contained 8,892 blocks and 3,690 warns. The directory had gone from ~50 files to 4. Lessons
database, feedback log, governance state, audit trail — gone. No `.bak` files. Time Machine
returned "Operation not permitted."

Digging further found something worse: `~/.thumbgate/bin/thumbgate-hook` was missing. That is
the binary every `.claude/settings.json` hook invokes. A missing binary makes the hook error,
and **an erroring PreToolUse hook fails open.** ThumbGate on that machine was not degraded —
it was enforcing nothing at all, and had been for an unknown period.

**Action.** Verified the failure before theorising: ran the hook exactly as `settings.json`
does and confirmed `no such file or directory`. Then restored the shim via
`thumbgate init` against the cached runtime, and re-verified by piping a known-dangerous
command through the real hook contract.

**Technical decisions.**

- *Prove the failure and the fix with the same command.* Not "the file is back" but
  `rm -rf ~` → `"permissionDecision":"deny"`, run from the repo where the failures were
  originally reported.
- *Do not guess at causation.* A tech-debt PR merged ~3 minutes before the file timestamps,
  but its changeset only describes repo files and no shipped code deletes the home directory.
  Recorded as correlation, explicitly not cause.
- *Fix the class, not the instance.* Two new controls: a backup of the irreplaceable state
  files, and a drift canary that detects a gate going **silent** — the signature of exactly
  this failure.

**Result.** Enforcement restored and verified. `rm -rf ~` deny, `git push --force` deny,
`ls -la` allow. The lost data is unrecoverable and always will be.

**What we learned.** This product's failure mode is silence. It sits in the tool path deciding
allow/deny, so a regression doesn't crash — it over-blocks (loud) or under-blocks (invisible).
Uptime monitoring would have shown green throughout. The only check that catches it asserts a
signal is *actually flowing*: does a known-dangerous command still get denied? That question
now runs every 6 hours against the published artifact.

---

## 4. The stakeholder conflict — monetization that sold off the safety floor

**Situation.** ThumbGate is a paid product with a free tier. To create upgrade pressure, the
free tier caps how many blocks it will perform per day: `FREE_TIER_DAILY_BLOCKS = 2` in
`scripts/rate-limiter.js`, with `applyDailyBlockCap()` converting `deny → warn + upgrade CTA`
after the limit. The stated intent, in the code: *"the action proceeds but the user sees they
lost protection."*

Separately, a product decision recorded in the engine as *"Enforcement posture (CEO decision
2026-06-04): WARN + AUDIT by default"* made most gates advisory unless the operator opts into
`THUMBGATE_STRICT_ENFORCEMENT=1`.

**Problem.** Both decisions are defensible commercially and both trade away enforcement. Taken
together they created a state where a free-tier user past their daily cap would have
`rm -rf ~`, a force push, or `git reset --hard` **downgraded to a warning** — the product
silently declining to prevent an irreversible action, in order to sell an upgrade. The
business goal and the product's core promise were in direct conflict, in code, shipping.

**Action.** Did not relitigate the pricing decision. Instead separated the two things being
conflated: *how many* blocks a free user gets, and *which* actions can never be discounted.

**Technical decisions.**

1. *Define an unconditional floor.* `CATASTROPHIC_DECLARATIVE_GATE_IDS` — force-push,
   git-reset-hard, git-clean-force, rm-rf-home-or-root — exempt from the daily cap regardless
   of tier or strict-mode setting. The cap still applies to everything else, so the upgrade
   pressure survives intact.
2. *Make the floor survive the escape hatch too.* `THUMBGATE_HOTFIX_BYPASS=1` runs
   `runHardFloor()` first, so secret exfiltration, the security scanner and the four
   self-protection gates hold even during an operator bypass. The emergency lever cannot be
   used to disable the parts that matter most.
3. *Keep monetization visible where it is legitimate.* Blocks that are capped still show the
   upgrade CTA. The user is told what they lost.

**Result.** Free tier still converts. The four irreversible operations are no longer for sale.
Both stakeholders got what they actually needed, which was not what either originally asked
for.

**What we learned.** "Monetization vs. safety" is usually a false binary produced by treating
one policy dial as global. The resolution was a taxonomy, not a compromise: most gates are
negotiable, a named few are not. Worth noting the comment on that constant still reads
`3 gate blocks/day` while the value is `2` — a small documentation drift that shows how easily
a commercial dial gets adjusted without the surrounding reasoning being updated.

---

## 5. Built from scratch — an evasion matrix, because "we fixed it" wasn't checkable

**Situation.** Mid-way through fixing the bypass in case study 1, the honest status was "I
believe the class is closed." That claim had already been made twice and been wrong twice —
once from auditing 1 of 7 config files, once from reasoning about regex shape instead of
executing anything.

**Problem.** There was no artifact that could answer "is a guardrail evadable?" A passing test
suite meant the happy path worked. Nothing measured the thing that actually mattered: whether
a command the product claims to block can be re-spelled into passing.

**Action.** Built the check that was missing, from nothing: a property test over
*commands × ways of spelling them*, asserting the grid is empty.

**Technical decisions.**

1. *Property, not examples.* 14 gated commands × 9 transforms (sudo, env prefix, `&&`/`;`/
   newline chaining, absolute path, quoting, backslash, git global option). Adding a row when
   a command class becomes gated, or a column when a new spelling turns up, is the intended
   maintenance.
2. *Relative invariant, not absolute assertion.* "If the plain form is denied here, every
   re-spelling must also be denied." The first version asserted absolute denial, passed
   locally and failed in CI — because whether a command is gated at all depends on ambient
   state. The relative form is environment-independent.
3. *Sandbox everything.* State paths redirected, fresh fixture repo, `beforeEach` isolation.
   Learned the hard way twice: an unsandboxed version reported 9 phantom holes because
   `workflow-sentinel` had accumulated session risk between runs, and `ls -la` was correctly
   denied after 100 destructive corpus commands.
4. *Guard against vacuity.* If fewer than N corpus commands are denied even in plain form, the
   test fails rather than passing on an empty measurement. An empty grid must mean "nothing
   evaded", never "nothing was tested."
5. *Test the artifact, not just the source.* A second copy runs against the **published npm
   tarball** every 6 hours and opens a P0 issue naming the rollback command. Tests prove the
   source is right; only this proves what users receive is right — and that was false for
   months while the tests were green.

**Result.** Differential proof, on demand:

```
thumbgate@1.29.1 -> 34 evasion holes, exit 1
thumbgate@1.29.2 ->  0 evasion holes, exit 0
```

The "is it fixed?" question became a command anyone can run.

**What we learned.** The most valuable thing built during that work was not the fix — it was
the instrument that made the fix checkable. Before it, "the bypass class is closed" was an
opinion, and it was wrong twice. After it, the same sentence is a measurement with a number
attached. For any security control, build the adversarial measurement *before* claiming the
control works; the measurement outlives the specific bug and catches the next one.

---

## 6. The ranked RAG gate failed before retrieval improved

**Situation.** The production RAG checklist had grown to include parsing, chunking, embeddings,
hybrid retrieval, reranking, prompt assembly, and structured output. The existing evaluation
still used six cases and a binary substring anywhere in the retrieved context.

**Problem.** That check could report 100% recall without measuring whether the relevant item
was first, tenth, or buried behind noise. Replacing it with 24 cross-domain cases and genuine
distractors produced an honest first result: MRR@10 0.699 and nDCG@10 0.774, both below the
fixed release thresholds of 0.75 and 0.80.

**Action.** Kept the thresholds unchanged and improved retrieval:

1. Original and selectively expanded queries produce separate BM25 candidate lists.
2. Reciprocal Rank Fusion combines the lists without comparing incompatible score scales.
3. Exact paths, hashes, quoted strings, and issue identifiers bypass rewriting.
4. A bounded safety lexicon expands implied database, deployment, and payment risks.
5. Reranking remains bounded and is measured by MRR/nDCG rather than described as a
   "cross-encoder" without model evidence.

**Result.**

```
cases          24
Recall@1       0.708
Recall@5       0.958
Recall@10      1.000
Precision@5    0.200
MRR@10         0.819
nDCG@10        0.842
scope leaks    0
stale hits     0
```

**Evidence boundary.** This is a deterministic seeded release suite with real distractors,
not a claim about every live customer corpus. Production quality additionally needs judged
live queries and drift telemetry.

**What we learned.** A retrieval test that does not measure rank can reward a system for
finding the right evidence too late to matter. Thresholds should expose retrieval work, not
be relaxed until current code passes.

---

## 7. The ingestion evaluator found version split-brain

**Situation.** Document ingestion had acquired PDF, DOCX, and OCR adapters, stable chunks,
scope metadata, incremental versions, and checkpointed re-indexing. Those features existed
as separate tests, but there was no single measured rating over the full ingestion path.

**Problem.** The first end-to-end ingestion evaluation found that a superseded document was
marked stale in the catalog and re-index path while its persisted document JSON still said
`isCurrent: true`. A catalog reader and a direct document reader could therefore disagree.

**Action.** Added `scripts/eval-document-ingestion.js` with distinct scores for parsing, OCR,
deduplication, normalization, chunking, metadata, incremental updates, re-indexing, and
versioning. The evaluator exercises real PDF and DOCX extraction and a real Tesseract OCR
smoke. Version retirement now updates both the catalog summary and old document record, and
records `supersededByDocumentId` for forward lineage.

**Result.**

```
implementation readiness  100 / 100 (A)
evidence maturity          70 / 100 (C-)
overall                    91 / 100 (A-)
OCR smoke confidence       96.34%
```

All nine implementation dimensions passed. The overall score remains below A because the
evidence layer still lacks a labeled customer-document corpus and enough production volume
for drift baselines.

**Evidence boundary.** A real adapter smoke proves the code and installed binaries can parse
the fixture. It does not prove production OCR accuracy across languages, scan qualities, or
customer formats.

**What we learned.** A version flag is a distributed invariant. Testing the catalog alone
was insufficient; every persisted representation and reader must agree on current/stale
state.
