---
"thumbgate": patch
---

Security: redact secrets at capture-time and export-time so ThumbGate never stores or ships a
credential. Adds a single canonical helper `scripts/secret-redaction.js` (covers Stripe
`sk_live_`/`sk_test_`/`rk_live_`/`rk_test_`/`whsec_`, AWS access keys, GitHub/Slack/Google/Anthropic/OpenAI
keys, JWTs, bearer tokens, PEM private-key blocks, and generic `key=value` secret assignments;
Stripe publishable `pk_live_` keys are intentionally preserved as public).

It is wired into the conversation-capture writers — `feedback-history-distiller` (the
`conversation-window.jsonl` writer, which was the incident vector), `lesson-inference` (lesson
writer), and `self-distill-agent` (run manifest) — so a pasted key is redacted before it lands on
disk, and into the `export-dpo-pairs` and `export-databricks-bundle` exporters so published/shared
datasets cannot leak captured secrets (the DPO redaction also cleans the HF preferences split).
Prompted by a 2026-06-10 incident where a live Stripe `sk_live_` key was found in plaintext in
`.thumbgate/conversation-window.jsonl`.

Note: the `feedback-log.jsonl` / `memory-log.jsonl` writers in `feedback-loop.js` are covered at
the export boundary (both exporters redact when reading them); adding at-rest redaction inside
`feedback-loop.js` is deferred to a follow-up because that file carries unrelated pre-existing
SonarCloud findings that would block this security PR's quality gate.
