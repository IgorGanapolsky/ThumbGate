---
"thumbgate": minor
---

feat(evals): steal Google DeepMind double-blind evaluation protocol

TheNewStack coverage of the DeepMind pilot (with MLCommons + Singapore AI
Safety Institute): confidential-computing enclave keeps model weights
hidden from evaluators and benchmark questions hidden from the provider;
only scores leave. Mapped onto ThumbGate as the enclave broker:

- sealAsset(): sha256 commitment + access token; content never crosses
  the boundary
- createEnclave()/runEvaluation(): scores-only release, questions and
  model content explicitly withheld
- leakageGuard(): refuses any output containing benchmark question text
- attest()/verifyAttestation(): HMAC hash-chain receipt; tampered scores
  or swapped benchmarks fail verification

Deterministic local model of the protocol; not real confidential
computing.
