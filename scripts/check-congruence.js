#!/usr/bin/env node
/**
 * Congruence checker — ensures branding, tech stack, and version are
 * consistent across all public-facing materials.
 *
 * Runs in CI on every PR. Fails if any surface is out of sync.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  collectLocalGitHubAboutErrors,
  loadGitHubAboutConfig,
  verifyLiveGitHubAbout,
} = require('./github-about');
const { getClaudePluginLatestDownloadUrl } = require('./distribution-surfaces');
const {
  ENTERPRISE_PRICE_LABEL,
} = require('./commercial-offer');

const ROOT = path.join(__dirname, '..');
const PRICING_SURFACE_ROOTS = [
  'README.md',
  'SKILL.md',
  'bin',
  'docs',
  'public',
  '.agents/skills/thumbgate/SKILL.md',
  '.claude/skills/thumbgate/SKILL.md',
];
const PRICING_SURFACE_EXTENSIONS = new Set(['.html', '.js', '.json', '.md', '.txt']);
const LEGACY_THUMBGATE_PRICING_PATTERNS = [
  {
    label: 'legacy $12 Team seat price',
    pattern: /\$12\s*\/\s*seat\s*\/\s*mo|\$12\/seat|\bTEAM \$12\b|"price":\s*"12"/i,
  },
  {
    label: 'retired founder $5 pricing',
    pattern: /(?:Founding Member|Founding|founder)[^\n]{0,80}\$5\/mo|\$5\/mo[^\n]{0,80}(?:Founding Member|Founding|founder)|Price:\s*\$5\/mo recurring/i,
  },
  {
    label: 'retired $10 Pro pricing',
    pattern: /(?:\*\*Pro\*\*|\bPro\b|price reverts|paying users)[^\n]{0,80}\$10\/mo|\$10\/mo[^\n]{0,80}(?:\*\*Pro\*\*|\bPro\b|price reverts|paying users)/i,
  },
  {
    label: 'retired $29 Team pricing',
    pattern: /(?:\*\*Team\*\*|Team)[^\n]{0,80}\$29\/mo|\$29\/mo[^\n]{0,80}(?:\*\*Team\*\*|Team)/i,
  },
  {
    label: 'retired $19 starter-pack positioning',
    // `$19/mo` is the current Pro subscription price. The retired claim was
    // the "Mistake-Free Starter Pack" packaging, not recurring pricing itself.
    pattern: /Mistake-Free Starter Pack/i,
  },
  {
    label: 'retired $49 founder lifetime pricing',
    // Use (?!\d) so legitimate $499 diagnostic copy is not a false positive.
    pattern: /(?:Founding Member|Founder|Founding Member Deal)[^\n]{0,100}\$49(?!\d)|\$49(?!\d)[^\n]{0,100}(?:Pro forever|Founding Member|Founder)/i,
  },
  {
    label: 'retired founder-license positioning',
    pattern: /founder[- ]license/i,
  },
];
const FALSE_PUBLIC_CLAIM_PATTERNS = [
  {
    label: 'single thumbs-down guarantee',
    pattern: /thumbs-down once, caught every time|one thumbs-down\s*=\s*one reusable check|learns from every mistake/i,
  },
  {
    label: 'pre-model enforcement claim',
    pattern: /before the model sees (?:it|them)|zero tokens (?:spent|used)/i,
  },
  {
    label: 'unsupported setup-time metric',
    pattern: /block your first repeated AI mistake in 5 minutes|install in 30 seconds|hit your first check in 60 seconds/i,
  },
  {
    label: 'stale gate-count metric',
    pattern: /checks:\s*36 active/i,
  },
  {
    label: 'automatic cross-agent enforcement claim',
    pattern: /one install, every agent|enforcement out of the box/i,
  },
  {
    label: 'overbroad audit claim',
    pattern: /every block names the matched rule, source lesson, tool call, and audit event|logs every decision/i,
  },
  {
    label: 'overbroad default self-protection claim',
    pattern: /hard-block(?:s|ing)? secret exfiltration and guardrail-tampering by default/i,
  },
  {
    label: 'unshipped hosted Enterprise promise',
    pattern: /<li><strong>(?:shared lesson database|org dashboard|shared enforcement memory|audit-grade decision trail)<\/strong>/i,
  },
];

function read(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
}

function listTextFiles(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    return PRICING_SURFACE_EXTENSIONS.has(path.extname(full)) ? [rel] : [];
  }
  if (!stat.isDirectory()) return [];

  const files = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTextFiles(childRel));
    } else if (PRICING_SURFACE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(childRel);
    }
  }
  return files;
}

async function main() {
  const errors = [];
  const githubAbout = loadGitHubAboutConfig(ROOT);

  function check(condition, message) {
    if (!condition) errors.push(message);
  }

  const checkLiveGitHubAbout = process.argv.includes('--check-live');

  // --- Version congruence ---
  const pkg = JSON.parse(read('package.json'));
  const version = pkg.version;

  const landingHtml = read('public/index.html') || '';
  const pricingHtml = read('public/pricing.html') || '';
  const guideHtml = read('public/guide.html') || '';
  const compareHtml = read('public/compare.html') || '';
  const proHtml = read('public/pro.html') || '';
  const readmeMd = read('README.md') || '';
  const commercialTruth = read('docs/COMMERCIAL_TRUTH.md') || '';
  const marketingCopy = read('docs/MARKETING_COPY_CONGRUENCE.md') || '';
  const docsLandingHtml = read('docs/landing-page.html') || '';
  const agentsMd = read('AGENTS.md') || '';
  const claudeMd = read('CLAUDE.md') || '';
  const geminiMd = read('GEMINI.md') || '';
  const serverStdio = read('adapters/mcp/server-stdio.js') || '';
  // const productHuntKit / productHuntLaunchKit removed 2026-06-06 with docs/marketing/.
  const claudePluginReadme = read('.claude-plugin/README.md') || '';
  const claudeDesktopPacket = read('docs/CLAUDE_DESKTOP_EXTENSION.md') || '';
  const latestClaudePluginUrl = getClaudePluginLatestDownloadUrl(ROOT);
  // Enterprise is the contact-sales tier (Free / Pro / Enterprise). The former
  // Team tier is retired: it must NOT be advertised as a customer-facing tier on
  // any buyer surface, and Enterprise must be present in its place.
  const enterpriseTierPattern = /Enterprise/i;
  // Catch the retired Team seat price even when markup (e.g. a <span>) splits
  // "$49" from "/seat", or when it appears without a trailing "/mo".
  const retiredTeamSeatPattern = /\$49\b[\s\S]{0,40}seat/i;
  const pricingSurfaceFiles = PRICING_SURFACE_ROOTS.flatMap(listTextFiles);
  const legacyPricingHits = [];
  for (const rel of pricingSurfaceFiles) {
    const text = read(rel) || '';
    for (const { label, pattern } of LEGACY_THUMBGATE_PRICING_PATTERNS) {
      if (pattern.test(text)) {
        legacyPricingHits.push(`${rel} (${label})`);
      }
    }
  }

  check(
    landingHtml.includes(`v${version}`),
    `public/index.html missing version v${version} (found in package.json)`
  );

  check(
    serverStdio.includes(`version: '${version}'`),
    `adapters/mcp/server-stdio.js missing version '${version}'`
  );

  // --- Brand congruence: "ThumbGate" must appear in all public surfaces ---
  const brandSurfaces = {
    // Accept either the legacy wordmark-only nav ("ThumbGate</a>") or the
    // current SVG-mark + `.logo-text` nav ("ThumbGate</span></a>").
    'public/index.html (nav)':
      landingHtml.includes('ThumbGate</a>')
      || landingHtml.includes('class="logo-text">ThumbGate</span>'),
    'public/index.html (title)': landingHtml.includes('<title>ThumbGate'),
    'README.md (heading)': readmeMd.startsWith('# ThumbGate'),
    'package.json (description)': pkg.description.includes('ThumbGate'),
    'AGENTS.md': agentsMd.includes('ThumbGate'),
    'CLAUDE.md': claudeMd.includes('ThumbGate'),
    'GEMINI.md': geminiMd.includes('ThumbGate'),
  };

  for (const [surface, present] of Object.entries(brandSurfaces)) {
    check(present, `Brand "ThumbGate" missing from ${surface}`);
  }

  // --- Tech stack congruence: technical details belong in technical surfaces ---
  const techTerms = [
    'SQLite',
    'FTS5',
    'MemAlign',
    'Thompson Sampling',
    'LanceDB',
    'PreToolUse',
  ];

  for (const term of techTerms) {
    check(
      readmeMd.includes(term),
      `Tech term "${term}" missing from README.md`
    );
  }

  // --- SEO positioning terms remain available without crowding the cash page ---
  const technicalContent = [
    guideHtml,
    compareHtml,
    read('public/llm-context.md') || '',
    read('docs/articles/tds-pre-action-checks.md') || '',
  ].join('\n');
  const seoTerms = ['human-in-the-loop', 'vibe coding'];
  for (const term of seoTerms) {
    check(
      technicalContent.toLowerCase().includes(term.toLowerCase()),
      `SEO term "${term}" missing from technical content surfaces`
    );
  }

  // --- FAQPage schema must exist for rich results ---
  check(
    landingHtml.includes('"@type": "FAQPage"'),
    'public/index.html missing FAQPage JSON-LD schema (needed for Google rich results)'
  );

  // --- Honest disclaimer must be on both surfaces ---
  check(
    readmeMd.includes('does not update model weights'),
    'README.md missing honest disclaimer ("does not update model weights")'
  );
  check(
    !/<<<<<<<|=======|>>>>>>>/.test(readmeMd),
    'README.md contains unresolved merge conflict markers'
  );
  check(
    /warn by default[^.]*den(?:y|ies) (?:when|in) strict/i.test(landingHtml),
    'public/index.html must state the default-versus-strict enforcement boundary'
  );
  check(
    /\$19\/mo/i.test(guideHtml) && /\$149\/yr/i.test(guideHtml),
    'public/guide.html must advertise the current Pro monthly and annual pricing'
  );
  check(
    enterpriseTierPattern.test(ENTERPRISE_PRICE_LABEL),
    'scripts/commercial-offer.js ENTERPRISE_PRICE_LABEL must describe the Enterprise tier'
  );
  check(
    legacyPricingHits.length === 0,
    `Legacy ThumbGate pricing found in public pricing surfaces: ${legacyPricingHits.join(', ')}`
  );
  check(
    enterpriseTierPattern.test(guideHtml),
    'public/guide.html must advertise the Enterprise tier (Free / Pro / Enterprise)'
  );
  check(
    /Pro at \$19\/mo or \$149\/yr/i.test(commercialTruth),
    'docs/COMMERCIAL_TRUTH.md must record the current Pro offer'
  );
  check(
    enterpriseTierPattern.test(commercialTruth),
    'docs/COMMERCIAL_TRUTH.md must record the Enterprise tier'
  );
  check(
    /one hard, test-backed safety gate/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must describe the one test-backed gate'
  );
  check(
    /supported AI-agent workflow/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must keep the supported-workflow boundary'
  );
  check(
    /two business days/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must state the managed delivery window'
  );
  check(
    /\$19\/mo or \$149\/yr/i.test(readmeMd),
    'README.md must advertise the current Pro monthly and annual pricing'
  );
  check(
    enterpriseTierPattern.test(readmeMd),
    'README.md must advertise the Enterprise tier'
  );
  // Free / Pro / Enterprise must be the visible model everywhere a buyer looks,
  // and the retired Team seat price must NOT reappear on any buyer surface.
  for (const [surface, text] of Object.entries({
    'public/compare.html': compareHtml,
    'public/pro.html': proHtml,
    'docs/landing-page.html': docsLandingHtml,
    // docs/marketing/product-hunt-launch-kit.md removed 2026-06-06.
    'README.md': readmeMd,
    'public/guide.html': guideHtml,
    'docs/COMMERCIAL_TRUTH.md': commercialTruth,
  })) {
    check(
      enterpriseTierPattern.test(text),
      `${surface} must advertise the Enterprise tier (Free / Pro / Enterprise)`
    );
    check(
      !retiredTeamSeatPattern.test(text),
      `${surface} must not advertise the retired Team tier ($49/seat/mo)`
    );
  }
  check(
    /Hosted team lesson sync \| — \| — \| Not general availability/i.test(readmeMd),
    'README.md must state that hosted team lesson sync is not general availability'
  );
  check(
    /Hosted org dashboard \| — \| — \| Not general availability/i.test(readmeMd),
    'README.md must state that the hosted org dashboard is not general availability'
  );
  check(
    /history-aware/i.test(readmeMd),
    'README.md must mention history-aware lesson distillation'
  );
  check(
    /feedback session|open_feedback_session|append_feedback_context|finalize_feedback_session/i.test(readmeMd),
    'README.md must mention the linked feedback session flow'
  );
  check(
    !/free.*unlimited captures/i.test(readmeMd) && !/unlimited captures.*free/i.test(readmeMd),
    'README.md must not claim the free tier has unlimited feedback captures'
  );
  check(
    !/shared team db/i.test(readmeMd),
    'README.md must not claim Pro includes a shared team DB'
  );
  check(
    !/\/mo\$19/i.test(readmeMd),
    'README.md must not contain malformed duplicated Pro pricing'
  );
  check(
    !/\/mo\$19/i.test(guideHtml),
    'public/guide.html must not contain malformed duplicated Pro pricing'
  );

  check(
    /action="\/go\/diagnostic-pay"[^>]*method="POST"/i.test(landingHtml),
    'public/index.html must post directly to the canonical managed-gate checkout route'
  );
  check(
    /\$(?:499|__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__)/.test(landingHtml)
      && /Managed AI Agent Workflow Gate/i.test(landingHtml),
    'public/index.html must expose the $499 managed gate offer'
  );
  check(
    /\/checkout\/pro/i.test(landingHtml) && /\$19\/mo/i.test(landingHtml),
    'public/index.html must expose self-serve Pro at $19/mo alongside the managed gate'
  );
  check(
    !/\/go\/sprint|href="[^"]*workflow-sprint-intake/i.test(landingHtml),
    'public/index.html must not reintroduce retired sprint intake cash paths'
  );
  check(
    /id="workflow-sprint-intake"[^>]*data-legacy-intake-alias/i.test(landingHtml),
    'public/index.html must preserve old intake hashes as an alias to the managed-gate checkout'
  );
  check(
    /action="\/go\/diagnostic-pay"[^>]*method="POST"/i.test(pricingHtml),
    'public/pricing.html must use the same canonical managed-gate checkout route'
  );
  check(
    /\/checkout\/pro/i.test(pricingHtml) && /\$19\/mo/i.test(pricingHtml),
    'public/pricing.html must expose self-serve Pro at $19/mo alongside the managed gate'
  );
  check(
    !/\/go\/sprint|workflow-sprint-intake/i.test(pricingHtml),
    'public/pricing.html must not reintroduce retired sprint intake cash paths'
  );
  check(
    /ThumbGate Pre-Action Checks/i.test(githubAbout.githubDescription),
    'config/github-about.json githubDescription must lead with ThumbGate Pre-Action Checks'
  );
  check(
    /pre-action checks|shared lessons|team safeguards/i.test(githubAbout.githubDescription),
    'config/github-about.json githubDescription must preserve the GitHub repo positioning'
  );
  check(
    /Source:\s*hosted-billing-summary/i.test(commercialTruth)
      && /local-fallback/i.test(commercialTruth)
      && /401/.test(commercialTruth),
    'docs/COMMERCIAL_TRUTH.md must preserve the authenticated-telemetry boundary for traction claims'
  );
  check(
    !githubAbout.topics.some((topic) => /(?:save-llm-tokens|reduce-llm-cost|ai-cost-optimization)/i.test(topic)),
    'config/github-about.json topics must not advertise unmeasured token or cost savings'
  );

  for (const [surface, text] of Object.entries({
    'README.md': readmeMd,
    'public/index.html': landingHtml,
    'docs/COMMERCIAL_TRUTH.md': commercialTruth,
    'docs/MARKETING_COPY_CONGRUENCE.md': marketingCopy,
    'package.json description': pkg.description,
  })) {
    for (const { label, pattern } of FALSE_PUBLIC_CLAIM_PATTERNS) {
      check(!pattern.test(text), `${surface} contains ${label}`);
    }
  }
  // Product Hunt launch-kit checks removed 2026-06-06 — docs/marketing/
  // was deleted in the post-Reddit credibility cleanup. The live PH URL is
  // still pinned in CHANGELOG / README via separate checks.
  check(
    claudePluginReadme.includes(latestClaudePluginUrl),
    '.claude-plugin/README.md must link to the latest Claude plugin bundle'
  );
  check(
    claudeDesktopPacket.includes(latestClaudePluginUrl),
    'docs/CLAUDE_DESKTOP_EXTENSION.md must link to the latest Claude plugin bundle'
  );

  errors.push(...collectLocalGitHubAboutErrors(ROOT));

  if (checkLiveGitHubAbout) {
    try {
      const liveCheck = await verifyLiveGitHubAbout({
        expected: githubAbout,
        repo: githubAbout.repo,
        root: ROOT,
      });
      errors.push(...liveCheck.errors);
    } catch (error) {
      errors.push(`Unable to verify live GitHub About: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Congruence check FAILED — ${errors.length} issue(s):\n`);
    for (const error of errors) {
      console.error(`  • ${error}`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(
    `✅ Congruence check passed — version v${version}, brand "ThumbGate", ${techTerms.length} tech terms verified across repo surfaces, GitHub About source-of-truth verified${checkLiveGitHubAbout ? ', and live GitHub metadata verified' : ''}.`
  );
}

main().catch((error) => {
  console.error(`\n❌ Congruence check FAILED — ${error.message}\n`);
  process.exit(1);
});
