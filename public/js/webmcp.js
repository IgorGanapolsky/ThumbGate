'use strict';

/**
 * WebMCP instrumentation for the hosted ThumbGate product pages (Chrome
 * origin trial; API reference verified 2026-08-26:
 * document.modelContext.registerTool).
 *
 * Policy (enforced by src/webmcp-governance.js + tests/webmcp-governance.test.js):
 *  - READ-ONLY tools only, each declaring annotations.readOnlyHint: true.
 *  - No checkout/payment/subscription tools; the /go/diagnostic-pay form
 *    stays human-only and carries no tool attributes. An agent can learn
 *    about ThumbGate here; a human completes any purchase.
 *  - Feature-detected: browsers without document.modelContext are a no-op.
 */
(function registerThumbGateTools() {
  var ctx = typeof document !== 'undefined' && document.modelContext;
  if (!ctx || typeof ctx.registerTool !== 'function') return;

  var noInput = { type: 'object', properties: {} };

  ctx.registerTool({
    name: 'thumbgate_get_product_overview',
    description: 'What ThumbGate is: an infrastructure firewall for AI coding agents. Captures feedback, promotes it to memory, generates prevention rules, and blocks known-bad tool calls via PreToolUse hooks. Returns the install command and key links.',
    inputSchema: noInput,
    annotations: { readOnlyHint: true },
    execute: function () {
      return Promise.resolve(JSON.stringify({
        product: 'ThumbGate',
        summary: 'Infrastructure firewall for AI coding agents: feedback -> memory -> prevention rules -> PreToolUse enforcement.',
        install: 'npm install -g thumbgate',
        docs: '/guide.html',
        pricing: '/pricing.html',
      }));
    },
  });

  ctx.registerTool({
    name: 'thumbgate_get_pricing_summary',
    description: 'Read-only pointer to ThumbGate plans. Does not start any purchase; buying always requires a human on the pricing page.',
    inputSchema: noInput,
    annotations: { readOnlyHint: true },
    execute: function () {
      return Promise.resolve(JSON.stringify({
        note: 'Plans and current prices are listed on the pricing page. Agent-initiated purchase is not supported by design; hand off to a human.',
        pricingPage: '/pricing.html',
        openSource: 'npm install -g thumbgate (permissive public code)',
      }));
    },
  });

  ctx.registerTool({
    name: 'thumbgate_get_service_health',
    description: 'Read-only live health of the hosted ThumbGate service: status, version, build.',
    inputSchema: noInput,
    annotations: { readOnlyHint: true },
    execute: function (_input, opts) {
      var signal = opts && opts.signal;
      return fetch('/health', { signal: signal }).then(function (res) {
        return res.text();
      });
    },
  });
})();
