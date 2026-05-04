const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

const brittlePatterns = [
  /\b\d+(?:\+)?\s+tests(?:\s+passing)?\b/i,
  /\b\d+\/\d+\s+healthy\b/i,
  /\b\d+(?:\.\d+)?%\s*(?:pass rate|coverage)\b/i,
  /\b\d+\s+MCP tools\b/i,
  /\b\d+\s+agent adapters\b/i,
  /\b\d+\s+proof(?:-of-correctness)? reports?\b/i,
];

const activeDocs = [
  'README.md',
  'CLAUDE.md',
  'docs/geo-strategy-for-ai-agents.md',
  'docs/pitch/agentic-commerce.md',
  'docs/pitch/agentic-commerce-thread.txt',
  'docs/marketing/devto-reliability-post.md',
  'docs/marketing/devto-article.md',
  'docs/marketing/product-hunt-launch.md',
  'docs/marketing/twitter-thread-formatted.md',
  'public/index.html',
];

const freeTierTruthFiles = [
  'docs/COMMERCIAL_TRUTH.md',
  'public/index.html',
  'public/guide.html',
  'public/compare.html',
  'public/llm-context.md',
  'docs/landing-page.html',
  'docs/marketing/product-hunt-launch-kit.md',
  'docs/marketing/show-hn.md',
  'docs/marketing/email-nurture-sequence.md',
];

const staleFreeTierPatterns = [
  /3 daily feedback captures/i,
  /5 daily lesson searches/i,
  /5 lesson searches per day/i,
  /unlimited recall/i,
  /3 captures\/day/i,
  /1 agent/i,
];

test('active docs avoid brittle hard-coded verification metrics', () => {
  for (const relativePath of activeDocs) {
    const fullPath = path.join(projectRoot, relativePath);
    const text = fs.readFileSync(fullPath, 'utf8');

    for (const pattern of brittlePatterns) {
      assert.doesNotMatch(
        text,
        pattern,
        `${relativePath} should avoid brittle metric claim matching ${pattern}`,
      );
    }
  }
});

test('README keeps buyer CTAs on current first-party ThumbGate surfaces', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

  assert.doesNotMatch(readme, /https:\/\/usethumbgate\.com/i);
  assert.match(readme, /https:\/\/thumbgate-production\.up\.railway\.app\/\?utm_source=github&utm_medium=readme/);
  assert.match(readme, /https:\/\/thumbgate-production\.up\.railway\.app\/checkout\/pro\?utm_source=github&utm_medium=readme/);
  assert.match(readme, /https:\/\/thumbgate-production\.up\.railway\.app\/dashboard\?utm_source=github&utm_medium=readme/);
  assert.match(readme, /https:\/\/thumbgate-production\.up\.railway\.app\/guides\/codex-cli-guardrails\?utm_source=github&utm_medium=readme/);
});

test('active commercial surfaces avoid stale free-tier limit claims', () => {
  for (const relativePath of freeTierTruthFiles) {
    const text = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    for (const pattern of staleFreeTierPatterns) {
      assert.doesNotMatch(
        text,
        pattern,
        `${relativePath} should not claim stale free-tier limits matching ${pattern}`,
      );
    }
  }
});

test('pricing comparison keeps free-tier pro features out of the free column', () => {
  const pricing = fs.readFileSync(path.join(projectRoot, 'docs/marketing/pricing-comparison.md'), 'utf8');

  assert.match(pricing, /\|\s*Feedback capture\s*\|\s*3 total\s*\|\s*Unlimited\s*\|/i);
  assert.match(pricing, /\|\s*Recall \+ lesson search\s*\|\s*No\s*\|\s*Yes\s*\|/i);
  assert.match(pricing, /\|\s*DPO\/KTO export\s*\|\s*No\s*\|\s*Yes\s*\|/i);
});

test('commercial truth labels local enforcement and hosted telemetry boundaries', () => {
  const truth = fs.readFileSync(path.join(projectRoot, 'docs/COMMERCIAL_TRUTH.md'), 'utf8');

  assert.match(truth, /Data Processing & Telemetry Boundaries/);
  assert.match(truth, /local-first/i);
  assert.match(truth, /THUMBGATE_NO_TELEMETRY=1/);
  assert.match(truth, /DO_NOT_TRACK=1/);
  assert.match(truth, /Hosted checkout, newsletter, intake, team sync/i);
  assert.match(truth, /GPT-5\.5 evaluation/i);
  assert.match(truth, /do not silently call provider APIs/i);
  assert.match(truth, /should not claim sub-processor coverage/i);
});
