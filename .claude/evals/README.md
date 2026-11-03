# ThumbGate Verifier Evaluation Set

> MAST taxonomy prescription #5: "Start with one agent and measure it. Build an
> evaluation set early." Anthropic: "Started with a set of about 20 queries
> representing real usage patterns, graded outputs with an LLM judge against a
> rubric."

This directory contains real PR scenarios used to validate that the Isolated
Verifier catches regressions and confirms goal achievement. Each scenario is a
JSON file with a `goal`, `expected_files`, `expected_checks`, and `verdict`
field. Run the eval set with:

```bash
node scripts/verify-eval-set.js
```

## Scenarios

| File | Goal Domain | Expected Verdict |
|---|---|---|
| write-gate-steal.json | Verifier write gate + approveWrites callback | PASS |
| mabl-budget-envelope.json | Budget envelope + signed receipt in report | PASS |
| landing-gemini-critique.json | Landing page Gemini critique fixes | PASS |
| doc-only-change.json | README.md only (no source changes) | SKIP unit_tests (TIA condition) |
| off-topic-change.json | Changed files unrelated to stated goal | FAIL |
