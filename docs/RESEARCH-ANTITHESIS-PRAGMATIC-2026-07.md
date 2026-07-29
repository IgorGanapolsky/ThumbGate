# Antithesis pragmatic reliability research

Date: 2026-07-29
Pragmatic Engineer extract: `extract_5fa56b734c082e460c07e7192f5032f4`
Parallel deep-research run: `trun_d3be5e813aa9497090f3f965114ad194`
(completed)

## Decision

Adopt the portable testing disciplines behind Antithesis: properties over
scripts, deterministic seeds, explicit fault schedules, replay receipts,
reachability checks, and deliberately broken negative controls. Do not claim
that ThumbGate now has Antithesis's deterministic hypervisor, time-travel
debugger, concurrent schedule exploration, or exhaustive fault coverage.

Primary and requested sources:

- [The Pragmatic Engineer: How to debug large, distributed systems — Antithesis](https://newsletter.pragmaticengineer.com/p/antithesis)
- [Antithesis: deterministic simulation testing](https://antithesis.com/docs/resources/deterministic_simulation_testing/)
- [Properties and assertions](https://antithesis.com/docs/properties_assertions/assertions/)
- [Is Antithesis working?](https://antithesis.com/docs/best_practices/is_antithesis_working/)
- [Test templates](https://antithesis.com/docs/test_templates/)
- [Test commands](https://antithesis.com/docs/test_templates/test_composer_reference/)
- [Fault model](https://antithesis.com/docs/environment/)
- [Optimizing for testing](https://antithesis.com/docs/best_practices/optimizing/)

## Ideas evaluated

| Idea | Why it exists | ThumbGate decision | Tradeoff |
|---|---|---|---|
| Deterministic seed and replay | A rare failure is much cheaper to debug when the exact scenario and fault point can be reconstructed. | Adopt. Every reliability report records the sanitized seed, scenario order, selected fault position, assertions, and replay command. | Application-level replay controls only the harness decisions. It does not control OS clocks, thread interleavings, or third-party internals. |
| Properties over procedural cases | A property such as “completed embeddings are never repeated” covers more executions than one brittle step sequence. | Adopt. Reliability scenarios emit named properties and fail the release proof if any are false. | Good properties require domain knowledge; vague or vacuous assertions manufacture confidence. |
| “Sometimes” / reachability assertions | Passing safety assertions means little if the fault path was never exercised. | Adopt. Each scenario proves the injected fault was observed, not merely that the final run was green. | Reachability is not correctness. It must be paired with post-fault state invariants. |
| Brown-M&M negative control | A known planted failure proves the harness can detect what it claims to detect. | Adopt. The suite injects vector outage, embedding interruption, and repeated invalid structured output; a test mutation proves one false property makes the report fail. | Negative controls must be contained in temporary stores and cannot touch production data. |
| Granular command scheduling | Reordering and parallelizing small commands explores more states than one monolithic script. | Partially adopt. Scenario order and the re-index fault boundary are seed-selected. | Concurrent process scheduling is deferred: the current local RAG workflow is primarily serial, and pretending a shuffled test list is a deterministic hypervisor would be misleading. |
| Whole-system hostile environment | Real binaries under faults expose integration bugs hidden by mocks. | Adopt narrowly at production module boundaries. The simulator calls the real re-index, hybrid retrieval, telemetry, and structured-output orchestration with injected provider/index failures. | Network partitions, clock jumps, process kills, and disk corruption need an isolated container/system harness; they are not simulated here. |
| Quiet-period recovery checks | Safety during faults and convergence after faults are different properties. | Adopt in the re-index scenario: inject once, then replay without the fault and require reconciliation plus lock release. | Recovery checks add runtime and must have bounded retries rather than waiting forever. |
| Turn production bugs into failure classes | A missed production bug should strengthen autonomous testing for the whole category, not only add one exact reproduction. | Adopt. Partial re-index checkpoint loss and wrong-store CLI targeting now have deterministic class-level guards. | The corpus of failures still needs continuous maintenance; a static simulator will decay. |
| Full deterministic hypervisor / SaaS | Controls clocks, scheduling, network, process, and storage behavior for replay across a distributed system. | Do not adopt now. | High setup and operating cost relative to ThumbGate's current local RAG topology. Reconsider for a multi-node hosted data plane with real concurrency incidents. |

## Implemented reliability harness

`npm run prove:rag -- --reliability-seed <seed>` now runs three bounded
production-path scenarios and writes `proof/rag-reliability-report.json`.

| Scenario | Injected fault | Required properties | What a failure means |
|---|---|---|---|
| `reindex_interruption_resume` | One embedding call fails at a seed-selected document boundary. | Fault is observable; replay completes; completed embeddings are not repeated; failed document is retried once; catalog/index reconcile; lock is released. | Checkpoint/resume, idempotency, or lock recovery is broken. |
| `vector_outage_lexical_fallback` | Vector search throws before rank fusion. | Lexical evidence still returns; fallback type is explicit; result stays within limit; local scope remains enforced. | Dense search became a single point of failure or failover weakens scope. |
| `invalid_structured_output_fail_closed` | The provider returns invalid JSON twice. | Invalid output is rejected; failure is typed; exactly one repair is attempted; repair failure is explicit. | Model orchestration can loop, leak unvalidated text, or misreport success. |

The proof is fail-closed. The normal scenario run passes 3/3. A deliberate test
mutation setting `completed_embeddings_are_not_repeated=false` makes the
reliability report fail, establishing that the proof is not vacuously green.
The receipt also separates 11 `always` properties from three `reachable`
properties and requires reachability 3/3, so a pass cannot hide an unexercised
fault path.

## Deep-research triage

The completed decision brief also proposed a virtual clock, a broader fault
catalog, exploration-novelty metrics, Docker whole-system topologies, and
agent-authored property skills. Those are credible next layers, not current
high-ROI work:

- The three failures under test are state and provider-boundary failures, not
  timer or thread-scheduling failures. Replacing direct clocks across the
  runtime would be broad speculative plumbing today.
- Three targeted faults already found two concrete bugs. Expanding to ten or
  more fault types before each has a corresponding property would create test
  theater.
- Novelty search is useful once there is a meaningful scenario graph. With
  three scenarios, explicit reachability is simpler and more auditable.
- The production modules already compose in one Node process with local
  LanceDB. A Docker topology becomes valuable when ThumbGate has a real
  multi-process or multi-node dependency whose ordering can fail.
- The checked-in stage contracts and research note already provide the
  property catalog and topology context needed by coding agents. A new skill
  bundle would add maintenance before proving incremental value.

## Bugs found while applying the method

1. A `partial_failure` re-index state was not resumable. The next run discarded
   successful checkpoints and repeated embeddings. The state machine now
   resumes both `in_progress` and `partial_failure`; the injected interruption
   proves only the failed document is retried.
2. `rag:warm -- --feedback-dir <path>` accepted the option but the CLI parser
   dropped it. The command inspected an empty worktree store while appearing
   successful. The parser now carries `feedbackDir`, and a real home-index run
   showed one current document, one LanceDB table, a bounded one-row local warm
   scan, and honest `exact_only` recall because no ANN index exists.
3. Local LanceDB rejects its remote-only native prewarm API. The warm operation
   now falls back to a bounded local table scan and reports the method and rows
   read instead of failing or claiming a native warm.

## ROI and limits

The implementation adds no paid service and no runtime dependency. Its cost is
temporary local files plus three short scenarios during `prove:rag`. It catches
or prevents repeated embedding spend, false-green operations against the wrong
store, unavailable-vector outages, unbounded repair loops, stale locks, and
unreconciled re-indexes.

It does not prove correctness under clock jumps, concurrent writers, process
kills, kernel faults, or network partitions. Those become worthwhile when the
hosted architecture and incident history show a distributed-concurrency need.
Until then, targeted deterministic boundary injection gives more reliability
per engineering dollar than recreating Antithesis's platform.
