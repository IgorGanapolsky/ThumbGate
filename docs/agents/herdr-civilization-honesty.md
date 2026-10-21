# Herdr AI Civilization Governance Honesty (FORMAT Steal)

Source: [*I Run an AI Civilization in Herdr*](https://www.youtube.com/watch?v=AL-PQuB2wy0).

## 5 Multi-Agent Software-Factory Pillars Stolen into `scripts/prove-herdr-adapter.js`

1. **Decouple Agent Identity from Ephemeral Sessions (`buildAgentSeat`, `occupySeatSession`, `buildRigPod`)**
   - Permanent addressable seats (`builder@workshop`, `orchestrator@rig`, `qa@workshop`) hold role, skills, model policy, `culture.md` norms, and accumulated `tribalWisdom`.
   - When a new ephemeral session occupies a seat, it inherits prior lessons and writes newly verified lessons back on exit.

2. **Traversable 3-Altitude Work Graph (`buildThreeAltitudeGraph`, `advanceWorkflowHarness`)**
   - Encodes `Project` (high-level intent) $\rightarrow$ `Mission` (milestone/release with merge boundary) $\rightarrow$ `Slice` (street-level execution with `specFile`, `sequence: ['spec', 'build', 'test']`, and `proofFile`).
   - `advanceWorkflowHarness()` feeds the next runnable step to the orchestrator without loading the entire sequence into context and blocks Mission merges until every Slice records a `proofFile`.

3. **Upward-Graph "Refocus" Injections & Altitude-Bridged Approvals (`buildRefocusInjection`, `evaluateAltitudeBridgedApproval`)**
   - Traverses `Slice -> Mission -> Project` upward to inject a periodic/post-compaction alignment prompt and detects scope creep ("doghouse $\rightarrow$ moon base") or recursive verification loops.
   - Blocks any orchestrator rule-exception or scope approval that omits either street-level `Slice` context or top-level `Project` intent.

4. **Epidemiological "Mind Virus" Contact Tracing & Purge (`traceAndPurgeMindVirus`)**
   - Contact-traces hallucinated rules or toxic patterns across seat memories and shared docs (`AGENTS.md`, `CLAUDE.md`, `culture.md`), purges them, and emits a `PreToolUse` inoculation rule (`inoculate-<virusId>`) so the purged habit cannot re-enter the codebase.

5. **Agent Productivity Monitoring (APM) — Ceremony-to-Progress Ratio (`evaluateCeremonyToProgress`)**
   - Tracks `ceremonyEvents` (handoffs, queue chatter, repeated checks) against `completedSlices`.
   - Triggers `bureaucracy_loop_alert` when `ceremonyToProgressRatio > 4.0` or when `completedSlices === 0 && ceremonyEvents >= 5`, dispatching a context-aware `triage@<rig>` agent pre-loaded with the rig's domain state.

## CLI Usage

```bash
npx thumbgate herdr-civilization-honesty --json
npx thumbgate herdr-civilization-honesty --map-only --json
npm run prove:herdr
```
