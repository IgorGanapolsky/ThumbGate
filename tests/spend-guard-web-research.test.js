'use strict';

// Read-only web tools (WebFetch, WebSearch, MCP fetch/search) cannot move money.
// On 2026-11-27 the spend guard hard-denied 10 research fetches as
// checkout_path / financial_action_and_object because docs URLs contain words
// like "billing", "checkout", "plans" or "upgrade". These fixtures pin the
// narrowed rule: research stays allowed, real checkout stays denied.

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateSpend, classifyWebUrl } = require('../scripts/thumbgate-spend-guard');

const RESEARCH_FETCHES = [
  'https://docs.stripe.com/billing/subscriptions/overview',
  'https://docs.stripe.com/payments/checkout',
  'https://stripe.com/docs/billing/subscriptions/overview',
  'https://docs.github.com/en/billing/managing-your-billing',
  'https://github.com/vercel/next.js/blob/canary/docs/upgrade.md',
  'https://docs.railway.com/reference/plans',
  'https://shopify.dev/docs/api/checkout-ui-extensions',
  'https://developer.paypal.com/docs/checkout/',
  'https://www.reddit.com/r/ClaudeAI/comments/x/claude_code_subscription_vs_api_credits/',
  'https://news.ycombinator.com/item?id=1',
  'https://vendor.example.com/blog/how-we-rebuilt-checkout',
  'https://www.anthropic.com/pricing',
];

const RESEARCH_SEARCHES = [
  'stripe checkout session create subscription',
  'how to cancel a paid plan billing',
  'claude code pro plan upgrade credits $20',
];

const REAL_CHECKOUT = [
  'https://checkout.stripe.com/c/pay/cs_live_abc',
  'https://buy.stripe.com/abc123',
  'https://billing.stripe.com/p/session/test',
  'https://app.apollo.io/#/settings/billing',
  'https://app.apollo.io/settings/plans/upgrade',
  'https://thumbgate.ai/checkout?plan=pro',
  'https://vendor.example.com/checkout',
  'https://vendor.example.com/purchase',
  'https://vendor.example.com/upgrade',
  'https://vendor.example.com/subscribe',
  'https://vendor.example.com/plans',
  'https://vendor.example.com/billing',
  'https://vendor.example.com#billing',
];

const WEB_TOOLS = ['WebFetch', 'web_fetch', 'mcp__TinyFish__fetch_content', 'mcp__fetch__fetch'];

test('documentation and research fetches are allowed', () => {
  for (const tool of WEB_TOOLS) {
    for (const url of RESEARCH_FETCHES) {
      const verdict = evaluateSpend(tool, { url, prompt: 'Summarize the billing and checkout docs' });
      assert.equal(verdict.decision, 'allow', `${tool} ${url} was denied as ${verdict.ruleId}`);
    }
  }
});

test('web searches are allowed whatever they mention', () => {
  for (const tool of ['WebSearch', 'web_search', 'mcp__TinyFish__search']) {
    for (const query of RESEARCH_SEARCHES) {
      const verdict = evaluateSpend(tool, { query });
      assert.equal(verdict.decision, 'allow', `${tool} "${query}" was denied as ${verdict.ruleId}`);
    }
  }
});

test('real checkout and payment pages stay denied for every web tool', () => {
  for (const tool of WEB_TOOLS) {
    for (const url of REAL_CHECKOUT) {
      const verdict = evaluateSpend(tool, { url });
      assert.equal(verdict.decision, 'deny', `${tool} ${url} must stay denied`);
    }
  }
  assert.equal(evaluateSpend('WebFetch', { uri: 'https://app.apollo.io/#/settings/billing' }).decision, 'deny');
});

test('a fetch tool that sends a body or a write method falls back to the full rules', () => {
  const post = evaluateSpend('mcp__fetch__fetch', {
    url: 'https://api.stripe.com/v1/charges',
    method: 'POST',
    body: 'amount=58800',
  });
  assert.equal(post.decision, 'deny');
});

test('browser navigation is not treated as a read-only fetch', () => {
  const verdict = evaluateSpend('mcp__playwright__browser_navigate', { url: 'https://docs.stripe.com/billing' });
  assert.equal(verdict.decision, 'deny', 'navigation is out of scope here and keeps the strict path rule');
});

test('classifyWebUrl separates payment hosts, commerce paths and research', () => {
  assert.equal(classifyWebUrl('https://checkout.stripe.com/c/pay/x'), 'payment_host');
  assert.equal(classifyWebUrl('https://vendor.example.com/checkout'), 'commerce');
  assert.equal(classifyWebUrl('https://vendor.example.com/docs/../checkout'), 'commerce');
  assert.equal(classifyWebUrl('https://docs.stripe.com/billing'), 'research');
});
