# Agentic Data Pipeline Proof Report

- passed: 6
- failed: 0

[x] **DATA-PIPE-01** materializeAgenticDataPipeline builds raw, staging, semantic, and lineage layers from billing and telemetry inputs
[x] **DATA-PIPE-02** pipeline reruns are idempotent and downgrade to noop when source hashes do not change
[x] **DATA-PIPE-03** reconciliation flags unreconciled paid events and telemetry coverage drift as warnings
[x] **DATA-PIPE-04** schedule manager emits a managed async-job spec for automated pipeline materialization
[x] **DATA-PIPE-05** semantic-layer consumes the staged pipeline and surfaces pipeline quality metrics
[x] **DATA-PIPE-06** verify-run full includes the data-pipeline proof lane and artifact

6 passed, 0 failed
