---
"thumbgate": patch
---

Enterprise GCP / Dialogflow CX guardrails add-on (`adapters/gcp/`).

- **DFCX webhook gate** — routes a Dialogflow CX fulfillment request through the pre-action gate engine (`evaluateGates`) plus same-session repeat detection before the side-effect (DB/CRM/billing) runs; returns allow or a safe block response.
- **Cloud Run / Functions entrypoint** — drop-in proxy that forwards allowed turns to the customer's existing fulfillment URL.
- **Vertex / Gemini scorer** — fetch-based (no SDK) client so ThumbGate scoring can run on Google models inside the customer's GCP tenant.

Ships as Cloud Run / Cloud Functions middleware; intentionally NOT part of the published npm bundle (not in `files[]`). Adds `test:dfcx-gate`, `test:dfcx-gate-server`, and `test:vertex-scorer` to the CI test chain.
