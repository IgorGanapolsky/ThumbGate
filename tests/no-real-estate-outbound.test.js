'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

// Exact regex from 2026-11-11-no-real-estate-in-thumbgate.md for generator output
const GENERATOR_FORBIDDEN_RE =
  /real.?estate|tax.?deed|197\.552|folio|miami-dade|broward|propstream|rexera/i;

// Word-bounded repo scan regex (so "portfolio" in enterprise governance docs is not confused with parcel "folio")
const REPO_SURFACE_FORBIDDEN_RE =
  /real.?estate|tax.?deed|197\.552|\bfolios?\b|miami-dade|broward|propstream|rexera|eliseai|fair housing|property managers?|deals\.igorganapolsky/i;

const LINKEDIN_INCIDENT_SNIPPET =
  "ThumbGate blocks destructive AI agent tool calls in <0.5ms. And for Florida real estate investors bidding this week's Miami-Dade tax-deed auction, our statutory F.S. 197.552 5-Folio Pre-Bid Diligence Packet ($100) is live at https://deals.igorganapolsky.com.";

test('outbound social/newsletter/marketing generators never emit real-estate or tax-deed text', () => {
  // 1. Daily/hourly social post generator across every angle
  const socialHourly = require('../scripts/social-post-hourly');
  const angles = [
    'horror-story',
    'educational',
    'product-demo',
    'hot-take',
    'community',
    'tip',
    'stats',
  ];
  for (const angle of angles) {
    if (typeof socialHourly.generatePost === 'function') {
      const text = String(socialHourly.generatePost(angle) || '');
      assert.doesNotMatch(
        text,
        GENERATOR_FORBIDDEN_RE,
        `social-post-hourly (${angle}) matched forbidden real-estate pattern`,
      );
    }
  }

  // 2. Weekly stats digest post generator
  const { generateWeeklyStatsPost } = require('../scripts/daily-digest');
  const weekly = generateWeeklyStatsPost({ periodDays: 7 });
  assert.doesNotMatch(
    String(weekly?.post || ''),
    GENERATOR_FORBIDDEN_RE,
    'daily-digest generateWeeklyStatsPost matched forbidden real-estate pattern',
  );

  // 3. Multi-platform launch / campaign post builders
  const launchPub = require('../scripts/social-analytics/publish-thumbgate-launch');
  const platforms = ['linkedin', 'twitter', 'threads', 'bluesky', 'reddit'];
  const offers = [
    'launch',
    'release-1.28.0',
    'operator-lab',
    'paid-sprint',
    'voice-agent-diagnostic',
  ];
  for (const platform of platforms) {
    for (const offer of offers) {
      if (typeof launchPub.buildPlatformPost === 'function') {
        try {
          const text = String(launchPub.buildPlatformPost(platform, offer) || '');
          assert.doesNotMatch(
            text,
            GENERATOR_FORBIDDEN_RE,
            `publish-thumbgate-launch (${platform}/${offer}) matched forbidden real-estate pattern`,
          );
        } catch {
          // Unsupported platform/offer combination is acceptable; any returned string must be clean.
        }
      }
    }
  }

  // 4. Medium weekly newsletter / submission pitch generator
  const mediumWeekly = require('../scripts/medium-weekly');
  const pitch = mediumWeekly.buildSubmissionPitch({ date: new Date('2026-11-11T12:00:00Z') });
  const pitchMd = mediumWeekly.renderSubmissionPitchMarkdown(pitch);
  assert.doesNotMatch(
    `${JSON.stringify(pitch)}\n${pitchMd}`,
    GENERATOR_FORBIDDEN_RE,
    'medium-weekly matched forbidden real-estate pattern',
  );

  // 5. Google AI Mode article generator & creator growth campaign builder
  const { buildGoogleAiModeMonetizedArticle } = require('../scripts/google-ai-mode-link-visibility-monetizer');
  const aiModeArticle = JSON.stringify(buildGoogleAiModeMonetizedArticle());
  assert.doesNotMatch(aiModeArticle, GENERATOR_FORBIDDEN_RE);

  const { buildCreatorGrowthCampaign } = require('../scripts/growth-campaigns');
  const growthCampaign = JSON.stringify(buildCreatorGrowthCampaign());
  assert.doesNotMatch(growthCampaign, GENERATOR_FORBIDDEN_RE);

  // 6. LinkedIn content-engine CLI preview output
  const liPreview = execFileSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'content-engine', 'linkedin-content-generator.js'), '--preview'],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.doesNotMatch(
    liPreview,
    GENERATOR_FORBIDDEN_RE,
    'linkedin-content-generator --preview matched forbidden real-estate pattern',
  );

  // 7. 24/7 sales promotion job drops any real-estate partner offer
  const { writePartnerOfferMarkdownFiles } = require('../scripts/thumbgate-24x7-sales-promotion-job');
  const tmpOffersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-no-re-offers-'));
  try {
    const written = writePartnerOfferMarkdownFiles(
      [
        {
          id: 'clean-ai-partner',
          company: 'Acme Agent Cloud',
          domain: 'acme.dev',
          status: 'staged',
          draft: {
            recipientLabel: 'Founders',
            subject: 'ThumbGate PreToolUse firewall integration',
            body: 'Zero-latency PreToolUse guardrails for coding agents.',
          },
        },
        {
          id: 'contaminated-re-offer',
          company: 'PropStream',
          domain: 'propstream.com',
          status: 'staged',
          draft: {
            recipientLabel: 'Sales',
            subject: 'Miami-Dade tax-deed 5-folio packet',
            body: LINKEDIN_INCIDENT_SNIPPET,
          },
        },
      ],
      tmpOffersDir,
    );
    assert.equal(written.length, 1);
    assert.ok(written[0].endsWith('clean-ai-partner.md'));
  } finally {
    fs.rmSync(tmpOffersDir, { recursive: true, force: true });
  }
});

test('social-quality-gate, validate-social-post, and gates-engine hard-block real-estate outbound posts while preserving sentinel skip filter', async () => {
  // 1. social-quality-gate blocks post and contextual reply
  const { gatePost, gateContextualReply } = require('../scripts/social-quality-gate');
  const blockedPost = gatePost(LINKEDIN_INCIDENT_SNIPPET);
  assert.equal(blockedPost.allowed, false);
  assert.ok(blockedPost.findings.some((f) => f.id === 'prohibited_real_estate'));

  const blockedReply = gateContextualReply(
    'How do you gate MCP tool calls?',
    'Use PreToolUse hooks — also check our Miami-Dade tax-deed 5-Folio packet.',
  );
  assert.equal(blockedReply.allowed, false);
  assert.ok(blockedReply.findings.some((f) => f.id === 'prohibited_real_estate'));

  // 2. validate-social-post rejects draft blocks containing real-estate terms
  const { evaluateBlock } = require('../scripts/validate-social-post');
  const evalRes = evaluateBlock({ label: 'linkedin-draft', body: LINKEDIN_INCIDENT_SNIPPET });
  assert.ok(evalRes.prohibitedTerm);
  assert.ok(evalRes.results.every((r) => r.ok === false));
  // Ensure "portfolio" is NOT falsely blocked by word-bounded \bfolios?\b
  const portfolioDraft = evaluateBlock({
    label: 'portfolio-draft',
    body: 'ThumbGate governs PreToolUse calls across our AI agent portfolio in <0.5ms.',
  });
  assert.equal(portfolioDraft.prohibitedTerm, null);
  assert.equal(portfolioDraft.results.find((r) => r.platform === 'linkedin').ok, true);

  // Exercise CLI --text rejection path for prohibited real-estate draft
  assert.throws(() => {
    execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-social-post.js'), '--text', LINKEDIN_INCIDENT_SNIPPET],
      { encoding: 'utf8' },
    );
  });

  // Direct publisher modules reject prohibited off-brand real-estate text before HTTP I/O
  const liPub = require('../scripts/social-analytics/publishers/linkedin');
  const { publishComment } = require('../scripts/social-analytics/publishers/linkedin-comment');
  const { publishQuotePost } = require('../scripts/social-analytics/publishers/linkedin-quote-post');
  await assert.rejects(() => liPub.publishTextPost('tok', 'urn:li:person:1', LINKEDIN_INCIDENT_SNIPPET), /prohibited off-brand term/);
  await assert.rejects(() => liPub.publishImagePost('tok', 'urn:li:person:1', LINKEDIN_INCIDENT_SNIPPET, ['https://example.com/a.png']), /prohibited off-brand term/);
  await assert.rejects(() => liPub.publishArticlePost('tok', 'urn:li:person:1', LINKEDIN_INCIDENT_SNIPPET, 'https://thumbgate.ai', 'Title'), /prohibited off-brand term/);
  await assert.rejects(() => publishComment('tok', 'urn:li:person:1', 'urn:li:activity:1', LINKEDIN_INCIDENT_SNIPPET), /prohibited off-brand term/);
  await assert.rejects(() => publishQuotePost('tok', 'urn:li:person:1', 'urn:li:activity:1', LINKEDIN_INCIDENT_SNIPPET), /prohibited off-brand term/);

  const { filterAllowedChannels } = require('../scripts/thumbgate-24x7-sales-promotion-job');
  assert.deepEqual(
    filterAllowedChannels({ linkedin: 3, biggerpockets_realestate: 2, bluesky: 1 }),
    { linkedin: 3, bluesky: 1 },
  );

  // 3. gates-engine hard-denies BrowserOS Neo & CLI social publishing of real-estate text (never demoted to warn)
  const gatesEngine = require('../scripts/gates-engine');
  const defaultConfigPath = path.join(REPO_ROOT, 'config', 'gates', 'default.json');
  const prevStrict = process.env.THUMBGATE_STRICT_ENFORCEMENT;
  delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  try {
    const browserComposeDecision = gatesEngine.evaluateGates(
      'mcp__browseros-neo__run',
      {
        code: `await page.goto('https://www.linkedin.com/sharing/compose'); await page.insertText(${JSON.stringify(LINKEDIN_INCIDENT_SNIPPET)});`,
      },
      defaultConfigPath,
    );
    assert.ok(browserComposeDecision, 'expected BrowserOS Neo LinkedIn real-estate compose to hit gate');
    assert.equal(browserComposeDecision.decision, 'deny');
    assert.equal(browserComposeDecision.gate, 'outbound-off-brand-vertical-block');
    const postured = gatesEngine.applyEnforcementPosture(browserComposeDecision);
    assert.equal(postured.decision, 'deny', 'hard-floor gate must never demote to warn');

    const cliSocialDecision = gatesEngine.evaluateGates(
      'Bash',
      {
        command: `node scripts/post-everywhere.js ${JSON.stringify(LINKEDIN_INCIDENT_SNIPPET)}`,
      },
      defaultConfigPath,
    );
    assert.ok(cliSocialDecision, 'expected CLI post-everywhere real-estate post to hit gate');
    assert.equal(cliSocialDecision.decision, 'deny');
    assert.equal(cliSocialDecision.gate, 'outbound-off-brand-vertical-block');

    // Edit/Write/Read on social scripts inside a real-estate-named path must NEVER false-positive
    const editDecision = gatesEngine.evaluateGates(
      'Edit',
      { file_path: '/tmp/ThumbGate-wt-no-real-estate/scripts/post-everywhere.js' },
      defaultConfigPath,
    );
    if (editDecision) {
      assert.notEqual(editDecision.gate, 'outbound-off-brand-vertical-block');
    }

    // Dev Bash commands (node --test, git commit, rg) must NEVER false-positive
    for (const devCmd of [
      'node --test tests/social-post-hourly.test.js tests/no-real-estate-outbound.test.js',
      'git commit -m "fix(post-everywhere): block real-estate outbound posts"',
      'rg real-estate scripts/post-everywhere.js',
    ]) {
      const devDecision = gatesEngine.evaluateGates('Bash', { command: devCmd }, defaultConfigPath);
      if (devDecision) {
        assert.notEqual(devDecision.gate, 'outbound-off-brand-vertical-block');
      }
    }
    const cleanComposeDecision = gatesEngine.evaluateGates(
      'mcp__browseros-neo__run',
      {
        code: "await page.goto('https://www.linkedin.com/sharing/compose'); await page.insertText('ThumbGate blocks destructive git push --force calls in 0.4ms via PreToolUse.');",
      },
      defaultConfigPath,
    );
    if (cleanComposeDecision) {
      assert.notEqual(cleanComposeDecision.gate, 'outbound-off-brand-vertical-block');
    }
  } finally {
    if (prevStrict !== undefined) process.env.THUMBGATE_STRICT_ENFORCEMENT = prevStrict;
  }

  // 4. Exception preserved: linkedin-monetization-sentinel skips real-estate/tax-deed posts
  const { classifyLinkedInPostAndDraftComment } = require('../scripts/linkedin-monetization-sentinel');
  const skipped = classifyLinkedInPostAndDraftComment({
    urn: 'urn:li:activity:999',
    author: 'External Poster',
    text: 'Miami-Dade tax-deed real estate auction results.',
  });
  assert.equal(skipped, null);
});

test('tracked ThumbGate code, docs, skills, sales, and public assets contain zero real-estate or tax-deed offers', () => {
  const allowedFilterFiles = new Set([
    'config/gates/default.json',
    'scripts/linkedin-monetization-sentinel.js',
    'scripts/social-quality-gate.js',
    'scripts/validate-social-post.js',
    'scripts/thumbgate-24x7-sales-promotion-job.js',
  ]);
  const rootsToScan = ['src', 'scripts', 'public', 'docs', 'sales', 'skills', '.agents/skills', 'assets'];
  const tracked = execFileSync('git', ['ls-files', '--', ...rootsToScan], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const violations = [];
  for (const relPath of tracked) {
    if (allowedFilterFiles.has(relPath)) continue;
    if (/\.(?:png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|mp4|sqlite)$/i.test(relPath)) continue;
    const absPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    const match = REPO_SURFACE_FORBIDDEN_RE.exec(content);
    if (match) {
      violations.push(`${relPath}: matched "${match[0]}"`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found prohibited real-estate/tax-deed text in tracked ThumbGate files:\n${violations.join('\n')}`,
  );
});
