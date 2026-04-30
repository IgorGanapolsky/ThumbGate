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

test('LAUNCH_NOW uses hosted revenue status for live commercial truth', () => {
  const launchNow = fs.readFileSync(path.join(projectRoot, 'LAUNCH_NOW.md'), 'utf8');

  assert.match(launchNow, /npm run revenue:status\b/);
  assert.doesNotMatch(launchNow, /# 3\. Current commercial snapshot is explicit\s+npm run revenue:status:local/s);
  assert.match(launchNow, /Use `npm run revenue:status:local` only as a local fallback/i);
});

test('FIRST_CUSTOMER_BATTLE_PLAN is marked historical and redirects to current operator docs', () => {
  const battlePlan = fs.readFileSync(path.join(projectRoot, 'FIRST_CUSTOMER_BATTLE_PLAN.md'), 'utf8');

  assert.match(battlePlan, /Historical/i);
  assert.match(battlePlan, /\[LAUNCH_NOW\.md\]\(LAUNCH_NOW\.md\)/);
  assert.match(battlePlan, /\[docs\/marketing\/operator-priority-handoff\.md\]\(docs\/marketing\/operator-priority-handoff\.md\)/);
});
