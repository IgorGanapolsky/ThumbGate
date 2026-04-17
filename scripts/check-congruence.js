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
const {
  PRODUCTHUNT_URL,
  getClaudePluginLatestDownloadUrl,
} = require('./distribution-surfaces');
const {
  TEAM_MIN_SEATS,
  TEAM_MONTHLY_PRICE_DOLLARS,
  TEAM_PRICE_LABEL,
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
    pattern: /Mistake-Free Starter Pack|Mistake-Free Starter Pack[^\n]{0,80}\$19\/mo|\$19\/mo[^\n]{0,80}subscriptions/i,
  },
  {
    label: 'retired $49 founder lifetime pricing',
    pattern: /(?:Founding Member|Founder|Founding Member Deal)[^\n]{0,100}\$49|\$49[^\n]{0,100}(?:Pro forever|Founding Member|Founder)/i,
  },
  {
    label: 'retired founder-license positioning',
    pattern: /founder[- ]license/i,
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
  const guideHtml = read('public/guide.html') || '';
  const compareHtml = read('public/compare.html') || '';
  const proHtml = read('public/pro.html') || '';
  const readmeMd = read('README.md') || '';
  const commercialTruth = read('docs/COMMERCIAL_TRUTH.md') || '';
  const docsLandingHtml = read('docs/landing-page.html') || '';
  const agentsMd = read('AGENTS.md') || '';
  const claudeMd = read('CLAUDE.md') || '';
  const geminiMd = read('GEMINI.md') || '';
  const serverStdio = read('adapters/mcp/server-stdio.js') || '';
  const productHuntKit = read('docs/marketing/product-hunt-launch.md') || '';
  const productHuntLaunchKit = read('docs/marketing/product-hunt-launch-kit.md') || '';
  const claudePluginReadme = read('.claude-plugin/README.md') || '';
  const claudeDesktopPacket = read('docs/CLAUDE_DESKTOP_EXTENSION.md') || '';
  const latestClaudePluginUrl = getClaudePluginLatestDownloadUrl(ROOT);
  const teamSeatPrice = `$${TEAM_MONTHLY_PRICE_DOLLARS}/seat/mo`;
  const teamSeatPricePattern = new RegExp(`\\$${TEAM_MONTHLY_PRICE_DOLLARS}/seat/mo`, 'i');
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

  // --- Tech stack congruence: key terms must appear in both README and landing page ---
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
    check(
      landingHtml.includes(term),
      `Tech term "${term}" missing from public/index.html`
    );
  }

  // --- SEO positioning terms must appear on landing page ---
  const seoTerms = ['human-in-the-loop', 'vibe coding'];
  for (const term of seoTerms) {
    check(
      landingHtml.toLowerCase().includes(term.toLowerCase()),
      `SEO term "${term}" missing from public/index.html`
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
    landingHtml.includes('doesn\'t touch the model') || landingHtml.includes('different from model-training feedback loops'),
    'public/index.html missing honest disclaimer (FAQ or inline)'
  );
  check(
    /\$19\/mo/i.test(landingHtml) && /\$149\/yr/i.test(landingHtml),
    'public/index.html must advertise the current Pro monthly and annual pricing'
  );
  check(
    /\$19\/mo/i.test(guideHtml) && /\$149\/yr/i.test(guideHtml),
    'public/guide.html must advertise the current Pro monthly and annual pricing'
  );
  check(
    TEAM_MONTHLY_PRICE_DOLLARS === 49 && TEAM_MIN_SEATS === 3,
    'scripts/commercial-offer.js must anchor Team at $49/seat/mo with a 3-seat minimum'
  );
  check(
    TEAM_PRICE_LABEL.includes(teamSeatPrice),
    'scripts/commercial-offer.js Team label must match the canonical Team seat price'
  );
  check(
    legacyPricingHits.length === 0,
    `Legacy ThumbGate pricing found in public pricing surfaces: ${legacyPricingHits.join(', ')}`
  );
  check(
    teamSeatPricePattern.test(guideHtml),
    'public/guide.html must advertise the current Team pricing anchor'
  );
  check(
    /Pro at \$19\/mo or \$149\/yr/i.test(commercialTruth),
    'docs/COMMERCIAL_TRUTH.md must record the current Pro offer'
  );
  check(
    teamSeatPricePattern.test(commercialTruth),
    'docs/COMMERCIAL_TRUTH.md must record the current Team pricing anchor'
  );
  check(
    /shared lessons and org visibility/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must mention shared lessons and org visibility'
  );
  check(
    /\$19\/mo or \$149\/yr/i.test(readmeMd),
    'README.md must advertise the current Pro monthly and annual pricing'
  );
  check(
    teamSeatPricePattern.test(readmeMd),
    'README.md must advertise the current Team pricing anchor'
  );
  for (const [surface, text] of Object.entries({
    'public/index.html': landingHtml,
    'public/compare.html': compareHtml,
    'public/pro.html': proHtml,
    'docs/landing-page.html': docsLandingHtml,
    'docs/marketing/product-hunt-launch-kit.md': productHuntLaunchKit,
  })) {
    check(
      teamSeatPricePattern.test(text),
      `${surface} must advertise the current Team pricing anchor`
    );
  }
  check(
    /shared hosted lesson db/i.test(readmeMd),
    'README.md must describe the shared hosted Team lesson database'
  );
  check(
    /org dashboard/i.test(readmeMd),
    'README.md must describe the Team org dashboard'
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
    landingHtml.includes('👍'),
    'public/index.html must visibly include the thumbs-up icon'
  );
  check(
    landingHtml.includes('👎'),
    'public/index.html must visibly include the thumbs-down icon'
  );
  check(
    /workflow-sprint-intake/.test(landingHtml),
    'public/index.html must expose the team workflow intake path'
  );
  check(
    /shared lesson db|shared lesson database/i.test(landingHtml),
    'public/index.html must describe the shared Team lesson database'
  );
  check(
    /org dashboard/i.test(landingHtml),
    'public/index.html must describe the Team org dashboard'
  );
  check(
    /personal local dashboard/i.test(landingHtml),
    'public/index.html must keep the personal Pro dashboard message'
  );
  check(
    /history-aware/i.test(landingHtml),
    'public/index.html must mention history-aware lesson distillation'
  );
  check(
    /feedback session/i.test(landingHtml),
    'public/index.html must mention the linked feedback session flow'
  );
  check(
    /3 feedback captures total/i.test(landingHtml) || /3 captures/i.test(landingHtml),
    'public/index.html must advertise the truthful free-tier capture limits'
  );
  check(
    /1 rule/i.test(landingHtml) || /1 prevention rule/i.test(landingHtml),
    'public/index.html must advertise the truthful free-tier rule limit'
  );
  check(
    landingHtml.includes(PRODUCTHUNT_URL),
    'public/index.html must link to the live Product Hunt listing'
  );
  check(
    /Claude Desktop plugin/i.test(landingHtml),
    'public/index.html must promote the Claude Desktop plugin install lane'
  );
  check(
    /thumbs[\s-]?up/i.test(landingHtml),
    'public/index.html must explain the thumbs-up feedback path'
  );
  check(
    /thumbs[\s-]?down/i.test(landingHtml),
    'public/index.html must explain the thumbs-down feedback path'
  );
  check(
    githubAbout.metaDescription.includes('👍'),
    'config/github-about.json metaDescription must include the thumbs-up icon'
  );
  check(
    githubAbout.metaDescription.includes('👎'),
    'config/github-about.json metaDescription must include the thumbs-down icon'
  );
  check(
    /thumbs[\s-]?up/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must mention thumbs-up feedback'
  );
  check(
    /thumbs[\s-]?down/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must mention thumbs-down feedback'
  );
  check(
    /history-aware lessons/i.test(githubAbout.metaDescription),
    'config/github-about.json metaDescription must mention history-aware lessons'
  );
  check(
    /agent governance/i.test(githubAbout.githubDescription),
    'config/github-about.json githubDescription must mention agent governance'
  );
  check(
    /pre-action gates|shared lessons|team safeguards/i.test(githubAbout.githubDescription),
    'config/github-about.json githubDescription must preserve the GitHub repo positioning'
  );
  check(
    productHuntKit.includes(PRODUCTHUNT_URL),
    'docs/marketing/product-hunt-launch.md must include the live Product Hunt URL'
  );
  check(
    /thumbs[\s-]?up|👍/i.test(productHuntKit),
    'docs/marketing/product-hunt-launch.md must mention the thumbs-up path'
  );
  check(
    /thumbs[\s-]?down|👎/i.test(productHuntKit),
    'docs/marketing/product-hunt-launch.md must mention the thumbs-down path'
  );
  check(
    productHuntKit.includes(latestClaudePluginUrl),
    'docs/marketing/product-hunt-launch.md must link to the Claude plugin bundle'
  );
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
