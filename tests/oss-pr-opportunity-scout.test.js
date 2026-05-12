const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildIssueSearchQueries,
  buildOssPrOpportunityScoutPlan,
  writeOssPrOpportunityScoutPack,
} = require('../scripts/oss-pr-opportunity-scout');

test('OSS scout maps ThumbGate dependencies to upstream GitHub issue searches', () => {
  const report = buildOssPrOpportunityScoutPlan({
    dependencies: ['@google/genai', 'stripe', 'unknown-package'],
    maxRepos: 5,
  });

  assert.equal(report.name, 'thumbgate-oss-pr-opportunity-scout');
  assert.equal(report.status, 'ready_to_scout');
  assert.ok(report.opportunities.some((item) => item.repo === 'googleapis/js-genai'));
  assert.ok(report.opportunities.some((item) => item.repo === 'stripe/stripe-node'));
  assert.ok(report.searchProtocol.antiSpamRule.includes('reproduced'));
});

test('OSS scout issue search includes help wanted, bounties, and regressions', () => {
  const queries = buildIssueSearchQueries('nodejs/undici');

  assert.ok(queries.some((query) => query.includes('good first issue')));
  assert.ok(queries.some((query) => query.includes('help wanted')));
  assert.ok(queries.some((query) => query.includes('bounty')));
  assert.ok(queries.some((query) => query.includes('regression')));
});

test('OSS scout writes promotion pack artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-oss-scout-'));
  const { jsonPath, markdownPath, report } = writeOssPrOpportunityScoutPack(dir, {
    dependencies: ['@huggingface/transformers'],
  });

  assert.equal(report.summary.mappedRepos, 1);
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /OSS PR Opportunity Scout/);
});
