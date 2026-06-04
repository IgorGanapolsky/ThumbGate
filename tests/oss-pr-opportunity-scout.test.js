const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildIssueSearchQueries,
  buildOssPrOpportunityScoutPlan,
  writeOssPrOpportunityScoutPack,
  STRATEGIC_DEPENDENCIES,
  RELATIONSHIP_OVERRIDES,
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

test('OSS scout covers the MCP ecosystem (ThumbGate is an MCP server) on the default path', () => {
  // No explicit dependencies → strategic ecosystem repos are unioned in.
  const report = buildOssPrOpportunityScoutPlan({ maxRepos: 30 });

  const mcpSdk = report.opportunities.find((item) => item.repo === 'modelcontextprotocol/typescript-sdk');
  assert.ok(mcpSdk, 'MCP TypeScript SDK must be scouted even though it is not an npm dependency');

  // MCP is our own protocol surface — it must rank as a top opportunity, not an afterthought.
  assert.ok(mcpSdk.score >= 50, `expected MCP to rank highly, got score=${mcpSdk.score}`);
  assert.ok(
    mcpSdk.reasons.some((r) => /protocol surface|MCP authors/i.test(r)),
    'MCP opportunity should explain the buyer-overlap reason',
  );

  // The draft must be TRUTHFUL: we implement MCP, we do not import the SDK.
  assert.ok(
    /building ThumbGate as an MCP server/i.test(mcpSdk.outreachDraft),
    'MCP outreach draft must not falsely claim we "use" the SDK',
  );
  assert.ok(!/using @modelcontextprotocol\/sdk/i.test(mcpSdk.outreachDraft));

  // The servers ecosystem repo (raw owner/repo identifier) must also resolve.
  assert.ok(report.opportunities.some((item) => item.repo === 'modelcontextprotocol/servers'));
});

test('every strategic ecosystem dependency resolves to a repo with a truthful draft', () => {
  const report = buildOssPrOpportunityScoutPlan({ maxRepos: 50 });
  const byDep = new Map(report.opportunities.map((o) => [o.dependency, o]));

  for (const dep of STRATEGIC_DEPENDENCIES) {
    const opp = byDep.get(dep);
    assert.ok(opp, `strategic dependency ${dep} must produce an opportunity`);
    assert.ok(opp.repo, `strategic dependency ${dep} must resolve to a repo`);
    // No strategic repo may emit the generic "while using X" claim if it has an
    // honest override — that override exists precisely because the claim is false.
    if (RELATIONSHIP_OVERRIDES[dep]) {
      assert.ok(
        opp.outreachDraft.includes(RELATIONSHIP_OVERRIDES[dep]),
        `${dep} draft must use its truthful relationship framing`,
      );
      assert.ok(!opp.outreachDraft.includes(`using ${dep} in ThumbGate`));
    }
  }
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
