'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APPCYPHER_LIST_URL,
  CHECKED_AT,
  DRAFTS_CSV_NAME,
  DIRECTORY_MEDIUM,
  DIRECTORY_SOURCE,
  DIRECTORY_SURFACE,
  DOCS_PATH,
  GLAMA_CANONICAL_URL,
  GLAMA_LEGACY_URL,
  GLAMA_SEARCH_URL,
  MCP_SO_URL,
  PUNKPEYE_LIST_URL,
  SMITHERY_DETAILS_URL,
  SMITHERY_SEARCH_URL,
  buildMcpDirectoryRevenuePack,
  buildTrackedDirectoryLink,
  isCliInvocation,
  parseArgs,
  renderDraftsCsv,
  renderMcpDirectoryRevenuePackMarkdown,
  writeMcpDirectoryRevenuePack,
} = require('../scripts/mcp-directory-revenue-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-directory-pack-'));
}

test('directory surfaces preserve the current repair priorities and evidence dates', () => {
  const pack = buildMcpDirectoryRevenuePack(LINKS_FIXTURE);

  assert.deepEqual(pack.surfaces.map((surface) => surface.key), [
    'mcp_so',
    'glama',
    'smithery',
    'punkpeye',
    'appcypher',
  ]);
  assert.equal(pack.surfaces[0].surfaceUrl, MCP_SO_URL);
  assert.equal(pack.surfaces[1].surfaceUrl, GLAMA_SEARCH_URL);
  assert.equal(pack.surfaces[1].submissionPath, GLAMA_CANONICAL_URL);
  assert.equal(pack.surfaces[2].surfaceUrl, SMITHERY_SEARCH_URL);
  assert.equal(pack.surfaces[2].submissionPath, 'https://smithery.ai/new');
  assert.equal(pack.surfaces[3].surfaceUrl, PUNKPEYE_LIST_URL);
  assert.equal(pack.surfaces[4].surfaceUrl, APPCYPHER_LIST_URL);
  assert.ok(pack.surfaces.every((surface) => surface.evidenceCheckedAt === CHECKED_AT));
  assert.ok(pack.surfaces.every((surface) => !/guaranteed installs|guaranteed revenue|approved/i.test(surface.evidenceSummary)));
  assert.match(pack.surfaces[1].evidenceSummary, /memory management and gateway capabilities/i);
  assert.match(pack.surfaces[3].publicStatus, /duplicate/i);
});

test('operator queue focuses on repair before expansion', () => {
  const pack = buildMcpDirectoryRevenuePack(LINKS_FIXTURE);

  assert.deepEqual(pack.operatorQueue.map((entry) => entry.key), [
    'refresh_glama_summary',
    'repair_smithery_namespace',
    'remove_punkpeye_duplicate',
    'add_appcypher_entry',
    'keep_mcp_so_canonical',
  ]);
  assert.equal(pack.operatorQueue[0].nextAsk, GLAMA_CANONICAL_URL);
  assert.equal(pack.operatorQueue[1].proofAsset, SMITHERY_SEARCH_URL);
  assert.equal(pack.operatorQueue[1].nextAsk, SMITHERY_DETAILS_URL);
  assert.match(pack.operatorQueue[2].recommendedMotion, /deletes the legacy duplicate row/i);
  assert.ok(pack.operatorQueue.every((entry) => !/guaranteed ranking|guaranteed revenue/i.test(entry.recommendedMotion)));
});

test('follow-on offers use tracked directory CTAs for guide, Pro, and sprint lanes', () => {
  const pack = buildMcpDirectoryRevenuePack(LINKS_FIXTURE);

  assert.equal(pack.followOnOffers.length, 3);
  assert.equal(pack.followOnOffers[1].label, 'ThumbGate Pro');

  for (const offer of pack.followOnOffers) {
    const url = new URL(offer.cta);
    assert.equal(url.searchParams.get('utm_source'), DIRECTORY_SOURCE);
    assert.equal(url.searchParams.get('utm_medium'), DIRECTORY_MEDIUM);
    assert.ok(url.searchParams.get('utm_campaign'));
    assert.ok(url.searchParams.get('cta_id'));
    assert.ok(url.searchParams.get('offer_code'));
  }

  const guideUrl = new URL(pack.followOnOffers[0].cta);
  const proUrl = new URL(pack.followOnOffers[1].cta);
  const sprintUrl = new URL(pack.followOnOffers[2].cta);

  assert.equal(guideUrl.searchParams.get('surface'), 'mcp_directory_guide');
  assert.equal(proUrl.searchParams.get('plan_id'), 'pro');
  assert.equal(proUrl.searchParams.get('surface'), 'mcp_directory_pro');
  assert.equal(sprintUrl.searchParams.get('surface'), 'mcp_directory_sprint');
});

test('tracked directory link helper keeps attribution machine-readable', () => {
  const url = new URL(buildTrackedDirectoryLink('https://thumbgate-production.up.railway.app/guide', {
    utmCampaign: 'mcp_directory_guide',
    utmContent: 'guide',
    campaignVariant: 'directory_repair',
    offerCode: 'MCP-DIRECTORY_GUIDE',
    ctaId: 'mcp_directory_guide',
    ctaPlacement: 'follow_on_offer',
  }));

  assert.equal(url.searchParams.get('utm_source'), DIRECTORY_SOURCE);
  assert.equal(url.searchParams.get('utm_medium'), DIRECTORY_MEDIUM);
  assert.equal(url.searchParams.get('surface'), DIRECTORY_SURFACE);
});

test('rendered markdown stays operator-ready and names the legacy leaks explicitly', () => {
  const markdown = renderMcpDirectoryRevenuePackMarkdown({
    ...buildMcpDirectoryRevenuePack(LINKS_FIXTURE),
    generatedAt: '2026-04-29T04:00:00.000Z',
  });

  assert.match(markdown, /MCP Directory Repair Pack/);
  assert.match(markdown, /canonical-but-stale Glama summary/);
  assert.match(markdown, /`rlhf-loop\/thumbgate`/);
  assert.match(markdown, /memory gateway with persistent storage across sessions/i);
  assert.match(markdown, /punkpeye awesome-mcp-servers/);
  assert.match(markdown, /duplicate legacy row/i);
  assert.match(markdown, /Proof-backed setup guide/);
  assert.match(markdown, /utm_source=mcp_directories/);
  assert.match(markdown, /ThumbGate Pro/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /official registry approved|guaranteed installs|guaranteed revenue/i);
});

test('draft csv export stays machine-readable and aligned with the outreach drafts', () => {
  const csv = renderDraftsCsv(buildMcpDirectoryRevenuePack(LINKS_FIXTURE).outreachDrafts);

  assert.match(csv, /^channel,audience,draft$/m);
  assert.match(csv, /Glama claim or support request/);
  assert.match(csv, /memory gateway with persistent storage across sessions/i);
  assert.match(csv, /punkpeye duplicate-removal PR body/);
});

test('checked-in MCP directory pack stays in sync with the generator output', () => {
  const committed = fs.readFileSync(DOCS_PATH, 'utf8');
  const updatedMatch = committed.match(/^Updated: (.+)$/m);

  assert.ok(updatedMatch, 'expected checked-in pack to include an Updated line');

  const markdown = renderMcpDirectoryRevenuePackMarkdown({
    ...buildMcpDirectoryRevenuePack(LINKS_FIXTURE),
    generatedAt: updatedMatch[1],
  });

  assert.equal(markdown, committed);
});

test('CLI options and artifact writing emit markdown, JSON, and queue CSV', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const pack = buildMcpDirectoryRevenuePack(LINKS_FIXTURE);
  const written = writeMcpDirectoryRevenuePack(pack, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'mcp-directory-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'mcp-directory-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'mcp-directory-operator-queue.csv')), true);
  assert.equal(fs.existsSync(path.join(tempDir, DRAFTS_CSV_NAME)), true);

  const json = JSON.parse(fs.readFileSync(path.join(tempDir, 'mcp-directory-revenue-pack.json'), 'utf8'));
  assert.equal(json.operatorQueue.length, 5);
  assert.equal(json.measurementPlan.northStar, 'directory_referral_to_paid_intent');
  assert.match(fs.readFileSync(path.join(tempDir, 'mcp-directory-operator-queue.csv'), 'utf8'), /refresh_glama_summary/);
  assert.match(fs.readFileSync(path.join(tempDir, DRAFTS_CSV_NAME), 'utf8'), /punkpeye duplicate-removal PR body/);
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'mcp-directory-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
