---
"thumbgate": patch
---

fix(evals/security): harden double-blind evaluation protocol against seal substitution and incomplete scorer output

- runEvaluation now validates that model and benchmark seals match the enclave commitment before scoring, preventing post-approval seal substitution attacks
- scoreFn must return exactly one result per benchmark question, or runEvaluation throws before computing passRate
- Remove hardcoded attestation key (CWE-321) — both attest() and verifyAttestation() now require a non-empty caller-provided attestationKey and throw on missing/empty/whitespace keys
- Private content store — asset content stored in a private WeakMap instead of enumerable _content; seals expose only metadata via JSON.stringify
