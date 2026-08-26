---
"thumbgate": patch
---

WebMCP agent surface for the hosted product pages plus declaration governance (2026-08-26 CEO directive: webmachinelearning/webmcp).

- `public/js/webmcp.js` — feature-detected `document.modelContext.registerTool` instrumentation for index/pricing: three READ-ONLY tools (product overview, pricing pointer, live health), every one declaring `annotations.readOnlyHint: true`. No checkout/payment tools; the payment form stays human-only; browsers without WebMCP are a no-op. Served via an explicit `/js/webmcp.js` route mirroring buyer-intent; excluded from the npm tarball (packaged runtime degrades to a 404 no-op).
- `src/webmcp-governance.js` — the enforcement angle: `validateToolDeclaration` / `auditToolRegistry` enforce truthful side-effect hints (mutation-named tools cannot claim readOnlyHint; commerce-shaped tools require humanConfirmationHint and can never autosubmit), and `evaluateWebMcpPretool` returns PreToolUse-shaped verdicts for agents invoking page-exposed tools (deny agent-driven commerce, warn on mutations, allow reads). Also excluded from the tarball.
- `tests/webmcp-governance.test.js` (`npm run test:webmcp`, wired into the suite) — validator semantics plus page-wiring proofs: script parses, registers only read-only tools, never uses toolautosubmit, both pages load it and carry the `WebMCP-ready` marker (which `scripts/revenue-status.js` already checks for), and the payment form carries no tool attributes.
