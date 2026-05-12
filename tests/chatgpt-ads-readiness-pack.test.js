const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildChatgptAdsReadinessPack,
  writeChatgptAdsReadinessPack,
} = require('../scripts/chatgpt-ads-readiness-pack');

test('ChatGPT ads readiness pack prepares proof-backed ad groups and measurement', () => {
  const report = buildChatgptAdsReadinessPack({
    offer: 'Workflow Hardening Sprint',
    keywords: ['AI agent verification before PR', 'agent governance for coding teams'],
    budget: 750,
  });

  assert.equal(report.name, 'thumbgate-chatgpt-ads-readiness-pack');
  assert.equal(report.status, 'ready_for_interest_signup');
  assert.ok(report.adGroups.some((group) => group.id === 'agent-governance-intent'));
  assert.ok(report.creative.every((creative) => creative.proofRequired.length > 0));
  assert.equal(report.measurement.budget, 750);
  assert.ok(report.strategy.trustBoundary.includes('separate from answers'));
});

test('ChatGPT ads readiness pack writes marketing artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-chatgpt-ads-'));
  const { jsonPath, markdownPath, report } = writeChatgptAdsReadinessPack(dir);

  assert.equal(report.source.openAiAdvertisersUrl, 'https://openai.com/advertisers');
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /ChatGPT Ads Readiness Pack/);
});
