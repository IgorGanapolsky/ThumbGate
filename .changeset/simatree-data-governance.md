---
"thumbgate": minor
---

feat(governance): add Simatree enterprise data lifecycle & BI analytics governance engine

- **Why-Before-How Intent Gate (`scripts/simatree-data-governance.js`)**: Enforces explicit context-grounded business rationale and verifiable rollback snapshot IDs before executing destructive database or lakehouse operations (DROP, ALTER, TRUNCATE, unindexed DELETE/UPDATE).
- **Bayesian Uncertainty Estimator**: Calculates statistical posterior confidence bounds across historical sample sizes and schema drift scores, preventing hallucinations on stale analytics tables.
- **PMO Transformation Audit Gate**: Validates multi-phase enterprise IT modernization plans with immutable milestone receipts.
- **Pre-Action Gate Configuration (`config/gates/simatree-data-governance.json`)**: Interdicts ungrounded data mutations across Snowflake, BigQuery, Databricks, and Postgres.
- **Learn Hub Guide (`public/learn/simatree-enterprise-data-governance-bi-analytics.html`)**: Technical reference with JSON-LD structured schemas (`TechArticle`, `FAQPage`, `SoftwareApplication`).
- **Comprehensive Unit & Integration Test Suite (`tests/simatree-data-governance.test.js`)**: 100% test coverage validating SQL hazard interdiction, Bayesian confidence thresholds, PMO audits, and CLI execution.
