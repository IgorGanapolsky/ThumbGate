const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BUNDLE_MEDIUM,
  CANONICAL_SHORT_DESCRIPTION,
  CODEX_BUNDLE_URL,
  CODEX_INSTALL_PAGE_URL,
  CODEX_SOURCE,
  INSTALL_PAGE_MEDIUM,
  SETUP_GUIDE_MEDIUM,
  buildCodexPluginRevenuePack,
  buildCodexPluginSurfaces,
  buildCodexTrackingMetadata,
  buildFollowOnOffers,
  buildMeasurementPlan,
  buildOperatorSequences,
  buildReadyTargetLanes,
  buildTrackedCodexLink,
  isCliInvocation,
  parseArgs,
  renderCodexReadyTargetsCsv,
  renderCodexPluginRevenuePackCsv,
  renderCodexPluginRevenuePackMarkdown,
  writeCodexPluginRevenuePack,
} = require('../scripts/codex-plugin-revenue-pack');

const LINKS_FIXTURE = {
  appOrigin: 'https://thumbgate-production.up.railway.app',
  guideLink: 'https://thumbgate-production.up.railway.app/guide',
  proCheckoutLink: 'https://thumbgate-production.up.railway.app/checkout/pro',
  sprintLink: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
  proPriceLabel: '$19/mo or $149/yr',
};

const ABOUT_FIXTURE = {
  repositoryUrl: 'https://github.com/IgorGanapolsky/ThumbGate',
  homepageUrl: 'https://thumbgate-production.up.railway.app',
  githubDescription: 'Agent governance for ThumbGate.',
  topics: ['thumbgate', 'codex', 'pre-action-checks', 'agent-reliability', 'guardrails', 'developer-tools'],
};

function makeReportFixture() {
  return {
    generatedAt: '2026-04-26T02:00:00.000Z',
    targets: [
      {
        temperature: 'warm',
        username: 'workflow_owner',
        source: 'reddit',
        channel: 'reddit_dm',
        contactUrl: 'https://reddit.com/u/workflow_owner',
        repoName: '',
        evidenceScore: 11,
        evidence: ['warm inbound engagement'],
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Warm workflow pain is already explicit.',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
        proofPackTrigger: 'Use proof only after pain is confirmed.',
        firstTouchDraft: 'Warm workflow draft.',
        pipelineLeadId: 'reddit_workflow_owner',
        salesCommands: {
          markContacted: 'npm run sales:pipeline -- advance --lead reddit_workflow_owner',
        },
      },
      {
        temperature: 'cold',
        username: 'freema',
        source: 'github',
        channel: 'manual',
        contactUrl: 'https://github.com/freema',
        repoName: 'mcp-jira-stdio',
        evidenceScore: 14,
        evidence: ['workflow control surface', 'production or platform workflow'],
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Production workflow approvals need proof.',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
        proofPackTrigger: 'Use proof only after pain is confirmed.',
        firstTouchDraft: 'Production workflow draft.',
        pipelineLeadId: 'github_freema_mcp_jira_stdio',
        salesCommands: {
          markContacted: 'npm run sales:pipeline -- advance --lead github_freema_mcp_jira_stdio',
        },
      },
      {
        temperature: 'cold',
        username: 'builder',
        source: 'github',
        channel: 'manual',
        contactUrl: 'https://github.com/builder',
        repoName: 'agent-handoff',
        evidenceScore: 10,
        evidence: ['workflow control surface'],
        motionLabel: 'Pro at $19/mo or $149/yr',
        motionReason: 'Self-serve tooling path is explicit.',
        cta: 'https://thumbgate-production.up.railway.app/guide',
        proofPackTrigger: 'Use proof only after pain is confirmed.',
        firstTouchDraft: 'Self-serve draft.',
        pipelineLeadId: 'github_builder_agent_handoff',
        salesCommands: {
          markContacted: 'npm run sales:pipeline -- advance --lead github_builder_agent_handoff',
        },
      },
    ],
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-codex-revenue-pack-'));
}

function buildPack() {
  return buildCodexPluginRevenuePack(makeReportFixture(), LINKS_FIXTURE, ABOUT_FIXTURE);
}

test('Codex surfaces cover install page, setup guide, and bundle without fake marketplace claims', () => {
  const surfaces = buildCodexPluginSurfaces(LINKS_FIXTURE, ABOUT_FIXTURE);

  assert.deepEqual(surfaces.map((surface) => surface.key), ['install_page', 'setup_guide', 'release_bundle']);
  assert.equal(surfaces[0].submissionUrl, CODEX_INSTALL_PAGE_URL);
  assert.equal(surfaces[1].submissionUrl, LINKS_FIXTURE.guideLink);
  assert.equal(surfaces[2].submissionUrl, CODEX_BUNDLE_URL);
  assert.match(surfaces[0].shortDescription, /Codex/i);
  assert.ok(surfaces.every((surface) => surface.proofLinks.some((link) => /COMMERCIAL_TRUTH\.md/.test(link))));
  assert.ok(surfaces.every((surface) => !/approved|partnered|guaranteed revenue/i.test(surface.longDescription)));
});

test('tracked Codex links keep source, medium, and campaign machine-readable', () => {
  const installTracking = buildCodexTrackingMetadata('install_page', {
    utmMedium: INSTALL_PAGE_MEDIUM,
    utmCampaign: 'codex_plugin_install_page',
    utmContent: 'page',
  });
  const guideTracking = buildCodexTrackingMetadata('setup_guide', {
    utmMedium: SETUP_GUIDE_MEDIUM,
    utmCampaign: 'codex_setup_guide',
    utmContent: 'guide',
  });
  const bundleTracking = buildCodexTrackingMetadata('release_bundle', {
    utmMedium: BUNDLE_MEDIUM,
    utmCampaign: 'codex_release_bundle',
    utmContent: 'download',
  });
  const installUrl = new URL(buildTrackedCodexLink(CODEX_INSTALL_PAGE_URL, installTracking));
  const guideUrl = new URL(buildTrackedCodexLink(LINKS_FIXTURE.guideLink, guideTracking));
  const bundleUrl = new URL(buildTrackedCodexLink(CODEX_BUNDLE_URL, bundleTracking));

  assert.equal(installUrl.searchParams.get('utm_source'), CODEX_SOURCE);
  assert.equal(installUrl.searchParams.get('utm_medium'), INSTALL_PAGE_MEDIUM);
  assert.equal(installUrl.searchParams.get('utm_campaign'), 'codex_plugin_install_page');
  assert.equal(guideUrl.pathname, '/guide');
  assert.equal(guideUrl.searchParams.get('utm_medium'), SETUP_GUIDE_MEDIUM);
  assert.equal(bundleUrl.searchParams.get('utm_medium'), BUNDLE_MEDIUM);
  assert.equal(bundleUrl.searchParams.get('surface'), 'release_bundle');
});

test('follow-on offers keep Pro and workflow-hardening motions explicit after install intent', () => {
  const offers = buildFollowOnOffers(LINKS_FIXTURE);

  assert.deepEqual(offers.map((offer) => offer.key), ['pro', 'teams']);
  assert.equal(offers[0].pricingModel, '$19/mo or $149/yr');
  assert.match(offers[0].cta, /utm_campaign=codex_pro_follow_on/);
  assert.match(offers[1].cta, /utm_campaign=codex_sprint_follow_on/);
});

test('measurement plan stays honest about paid intent versus bare downloads', () => {
  const plan = buildMeasurementPlan();

  assert.equal(plan.northStar, 'codex_install_intent_to_paid_intent');
  assert.match(plan.policy, /tracked checkout start|qualified workflow-hardening conversation/i);
  assert.ok(plan.metrics.includes('bundle_download_clicks'));
  assert.ok(plan.metrics.includes('paid_conversions'));
  assert.ok(plan.successThresholds.doNotCountAsSuccess.some((item) => /bundle downloads without a tracked follow-on event/i.test(item)));
});

test('operator sequences stay evidence-backed and route to real Codex follow-up surfaces', () => {
  const sequences = buildOperatorSequences(LINKS_FIXTURE);

  assert.deepEqual(sequences.map((sequence) => sequence.key), [
    'install_trust_surface',
    'setup_guide_follow_up',
    'post_proof_pro_upgrade',
    'workflow_hardening_escalation',
  ]);
  assert.match(sequences[0].cta, /\/codex-plugin\?/);
  assert.match(sequences[1].cta, /\/guide\?/);
  assert.match(sequences[2].cta, /\/checkout\/pro\?/);
  assert.match(sequences[3].cta, /#workflow-sprint-intake/);
  assert.ok(sequences.every((sequence) => !/guaranteed installs|guaranteed revenue|approved marketplace/i.test(sequence.draft)));
});

test('ready target lanes split workflow-hardening and self-serve targets for operator send order', () => {
  const lanes = buildReadyTargetLanes(makeReportFixture());

  assert.deepEqual(lanes.map((lane) => lane.key), ['workflow_hardening', 'self_serve']);
  assert.equal(lanes[0].targets[0].account, '@workflow_owner');
  assert.equal(lanes[0].targets[1].account, 'freema/mcp-jira-stdio');
  assert.equal(lanes[1].targets[0].account, 'builder/agent-handoff');
  assert.match(lanes[0].targets[0].markContactedCommand, /sales:pipeline/);
});

test('rendered pack is operator-ready and anchored to proof, guide, and bundle surfaces', () => {
  const rendered = renderCodexPluginRevenuePackMarkdown({
    ...buildPack(),
    generatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.match(rendered, /Codex Plugin Revenue Pack/);
  assert.match(rendered, /ThumbGate/);
  assert.match(rendered, new RegExp(CANONICAL_SHORT_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(rendered, /Codex plugin install page/);
  assert.match(rendered, /Proof-backed setup guide/);
  assert.match(rendered, /GitHub release bundle/);
  assert.match(rendered, /Operator Follow-Up Sequences/);
  assert.match(rendered, /Ready-Now Target Queue/);
  assert.match(rendered, /Send Now: Codex-Adjacent Workflow Hardening/);
  assert.match(rendered, /Send Next: Codex Self-Serve Install \+ Pro/);
  assert.match(rendered, /proof-backed Codex setup guide/i);
  assert.match(rendered, /VERIFICATION_EVIDENCE\.md/);
  assert.match(rendered, /workflow control surfaces/i);
  assert.doesNotMatch(rendered, /approved partner|guaranteed installs|guaranteed revenue/i);
});

test('CSV export keeps Codex submission fields in one operator file', () => {
  const csv = renderCodexPluginRevenuePackCsv(buildPack());
  const readyTargetsCsv = renderCodexReadyTargetsCsv(buildPack());

  assert.match(csv, /^key,name,role,operatorStatus,conversionGoal,/);
  assert.match(csv, /Codex plugin install page/);
  assert.match(csv, /Proof-backed setup guide/);
  assert.match(csv, /GitHub release bundle/);
  assert.match(csv, /codex_plugin_install_page/);
  assert.match(readyTargetsCsv, /^laneKey,laneLabel,motion,account,/);
  assert.match(readyTargetsCsv, /workflow_hardening/);
  assert.match(readyTargetsCsv, /builder\/agent-handoff/);
});

test('CLI options and report writing produce markdown, JSON, and CSV artifacts', () => {
  const tempDir = makeTempDir();
  const options = parseArgs(['--write-docs', '--report-dir', tempDir]);
  const plan = buildPack();
  const written = writeCodexPluginRevenuePack(plan, {
    ...options,
    writeDocs: false,
  });

  assert.equal(options.writeDocs, true);
  assert.equal(options.reportDir, tempDir);
  assert.equal(written.docsPath, null);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-plugin-revenue-pack.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-plugin-revenue-pack.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-plugin-surfaces.csv')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'codex-ready-targets.csv')), true);

  const json = JSON.parse(fs.readFileSync(path.join(tempDir, 'codex-plugin-revenue-pack.json'), 'utf8'));
  assert.equal(json.surfaces.length, 3);
  assert.equal(json.measurementPlan.northStar, 'codex_install_intent_to_paid_intent');
  assert.match(fs.readFileSync(path.join(tempDir, 'codex-plugin-surfaces.csv'), 'utf8'), /utm_source/);
  assert.match(fs.readFileSync(path.join(tempDir, 'codex-ready-targets.csv'), 'utf8'), /workflow_hardening/);
});

test('writeDocs mode also persists checked-in Codex sidecars alongside markdown', () => {
  const writes = [];
  const originalWriteFileSync = fs.writeFileSync;
  const docsRoot = path.join(__dirname, '..', 'docs', 'marketing');

  fs.writeFileSync = (filePath, ...args) => {
    writes.push(String(filePath));
    if (String(filePath).startsWith(`${docsRoot}${path.sep}`)) {
      return;
    }
    return originalWriteFileSync.call(fs, filePath, ...args);
  };

  try {
    const written = writeCodexPluginRevenuePack(buildPack(), {
      writeDocs: true,
    });

    assert.match(written.docsPath, /docs\/marketing\/codex-plugin-revenue-pack\.md$/);
    assert.ok(writes.some((entry) => entry.endsWith('docs/marketing/codex-plugin-revenue-pack.md')));
    assert.ok(writes.some((entry) => entry.endsWith('docs/marketing/codex-plugin-revenue-pack.json')));
    assert.ok(writes.some((entry) => entry.endsWith('docs/marketing/codex-plugin-surfaces.csv')));
    assert.ok(writes.some((entry) => entry.endsWith('docs/marketing/codex-ready-targets.csv')));
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});

test('CLI entrypoint detection is path based for importer safety', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'codex-plugin-revenue-pack.js');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', path.join(__dirname, 'codex-plugin-revenue-pack.test.js')]), false);
});
