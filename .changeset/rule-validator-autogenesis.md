---
"thumbgate": minor
---

Add a pre-promotion rule validator (scripts/rule-validator.js) that gates
every auto-promoted prevention rule before it lands in
synthesized-rules.jsonl. Inspired by the Autogenesis self-evolving agent
protocol (arxiv 2604.15034): we already had capability-gap identification,
candidate generation, and integration — this plugs the missing "validate
before integrate" phase.

A proposed rule is now promotable iff it fires on the seed lesson that
triggered promotion AND its precision on recent overlapping-tag events
clears a floor (default 0.8). Rules that fail either invariant are parked
in a new rejected-rules.jsonl side log with a machine-readable reason
(rule_does_not_match_seed_lesson, precision_below_floor,
insufficient_sample, no_firings_in_sample, invalid_rule_shape) so
operators can audit silent rejections. Thresholds are overridable; the
validator is a pure function (no IO) and covered by 15 new tests.
