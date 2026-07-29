#!/usr/bin/env node
'use strict';

/**
 * generate-case-study-outreach.js — buyer outreach pack from dogfood case studies.
 *
 * No fabricated customer logos. Packs are built from public case-study anchors
 * with first-party UTMs for the cash path.
 *
 *   node scripts/generate-case-study-outreach.js --case=sudo-evasion
 *   node scripts/generate-case-study-outreach.js --case=sudo-evasion --json
 *   node scripts/generate-case-study-outreach.js --case=sudo-evasion --write
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'proof', 'outreach');

const CASES = Object.freeze({
  'sudo-evasion': {
    id: 'sudo-evasion',
    title: 'A guardrail you could walk past with sudo',
    anchor: 'sudo-evasion',
    problem: 'Catastrophic PreToolUse gates matched the happy path but missed wrappers like `sudo rm -rf ~`.',
    metric: '62 evasion holes → 0 on the published npm artifact',
    result: 'Canonicalization + an adversarial grid (14 commands × 9 transforms) closed the class; CI + 6-hourly published-artifact jobs keep it closed.',
    buyerPain: 'Your coding agent can re-spell a blocked command and walk past a regex denylist.',
    ctaPrimary: 'diagnostic',
    proofLinks: {
      caseStudyPath: '/case-studies#sudo-evasion',
      scorecardPath: '/eval-scorecard',
      whitepaperPath: '/whitepaper',
      diagnosticPath: '/diagnostic',
      proPath: '/checkout/pro',
    },
  },
  'fail-open': {
    id: 'fail-open',
    title: 'Production failure: a firewall enforcing nothing',
    anchor: 'fail-open',
    problem: 'A missing PreToolUse hook binary fails open — the product looked fine while blocking nothing.',
    metric: 'Silent-gate canary + published-artifact deny checks',
    result: 'Enforcement restored and verified with known-dangerous commands; silence is now treated as a P0 class.',
    buyerPain: 'Green uptime does not mean your agent firewall is still firing.',
    ctaPrimary: 'diagnostic',
    proofLinks: {
      caseStudyPath: '/case-studies#fail-open',
      scorecardPath: '/eval-scorecard',
      whitepaperPath: '/whitepaper',
      diagnosticPath: '/diagnostic',
      proPath: '/checkout/pro',
    },
  },
});

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    caseId: 'sudo-evasion',
    json: false,
    write: false,
    help: false,
    outDir: DEFAULT_OUT_DIR,
    baseUrl: 'https://thumbgate.ai',
  };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--case=')) args.caseId = arg.slice('--case='.length);
    else if (arg.startsWith('--out-dir=')) args.outDir = path.resolve(arg.slice('--out-dir='.length));
    else if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length).replace(/\/$/, '');
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-case-study-outreach.js --case=<id> [--write] [--json]

Cases: ${Object.keys(CASES).join(', ')}
`);
}

function withUtm(baseUrl, pathAndHash, campaign, content) {
  const [pathname, hash = ''] = pathAndHash.split('#');
  const url = new URL(pathname, baseUrl);
  url.searchParams.set('utm_source', 'case_study_outreach');
  url.searchParams.set('utm_medium', content);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('cta_id', `${campaign}_${content}`);
  const hashPart = hash ? `#${hash}` : '';
  return `${url.toString()}${hashPart}`;
}

function buildPack(caseDef, options = {}) {
  const baseUrl = options.baseUrl || 'https://thumbgate.ai';
  const campaign = `case_${caseDef.id.replace(/-/g, '_')}`;
  const links = {
    caseStudy: withUtm(baseUrl, caseDef.proofLinks.caseStudyPath, campaign, 'case_study'),
    scorecard: withUtm(baseUrl, caseDef.proofLinks.scorecardPath, campaign, 'scorecard'),
    whitepaper: withUtm(baseUrl, caseDef.proofLinks.whitepaperPath, campaign, 'whitepaper'),
    diagnostic: withUtm(baseUrl, caseDef.proofLinks.diagnosticPath, campaign, 'diagnostic'),
    pro: withUtm(baseUrl, `${caseDef.proofLinks.proPath}`, campaign, 'pro'),
  };

  const linkedin = [
    caseDef.buyerPain,
    '',
    `We dogfooded this on ThumbGate itself: ${caseDef.metric}.`,
    caseDef.result,
    '',
    `Full write-up (no fabricated logos): ${links.caseStudy}`,
    `Live bench scorecard: ${links.scorecard}`,
    '',
    `If one repeated AI-agent failure is already costing you, the $499 Diagnostic installs one hard gate with regression proof: ${links.diagnostic}`,
  ].join('\n');

  const email = [
    `Subject: Your agent can walk past a regex denylist`,
    '',
    `Hi —`,
    '',
    caseDef.buyerPain,
    '',
    `Concrete proof from our own product loop (not a customer logo page):`,
    `- ${caseDef.metric}`,
    `- ${caseDef.result}`,
    '',
    `Case study: ${links.caseStudy}`,
    `Scorecard: ${links.scorecard}`,
    `White paper: ${links.whitepaper}`,
    '',
    `If you want this on one painful workflow this week: ${links.diagnostic}`,
    `Self-serve Pro: ${links.pro}`,
    '',
    `— Igor`,
  ].join('\n');

  const reddit = [
    `**Problem:** ${caseDef.problem}`,
    '',
    `**What we measured:** ${caseDef.metric}`,
    '',
    `**What fixed it:** ${caseDef.result}`,
    '',
    `Public case study (dogfood, not a fake logo wall): ${links.caseStudy}`,
    `Bench scorecard: ${links.scorecard}`,
  ].join('\n');

  const markdown = [
    `# Outreach pack — ${caseDef.title}`,
    '',
    `Case id: \`${caseDef.id}\``,
    '',
    '## Links (tracked)',
    '',
    `- Case study: ${links.caseStudy}`,
    `- Scorecard: ${links.scorecard}`,
    `- White paper: ${links.whitepaper}`,
    `- Diagnostic $499: ${links.diagnostic}`,
    `- Pro: ${links.pro}`,
    '',
    '## LinkedIn',
    '',
    linkedin,
    '',
    '## Email',
    '',
    '```',
    email,
    '```',
    '',
    '## Reddit / forum',
    '',
    reddit,
    '',
    '## Honesty',
    '',
    'First-party dogfood narrative only. Do not imply third-party customer endorsement.',
    '',
  ].join('\n');

  return {
    caseId: caseDef.id,
    title: caseDef.title,
    links,
    channels: {
      linkedin,
      email,
      reddit,
    },
    markdown,
  };
}

function generate(options = {}) {
  const caseId = options.caseId || 'sudo-evasion';
  const caseDef = CASES[caseId];
  if (!caseDef) {
    throw new Error(`Unknown case id: ${caseId}. Known: ${Object.keys(CASES).join(', ')}`);
  }
  const pack = buildPack(caseDef, { baseUrl: options.baseUrl });
  let outPath = null;
  if (options.write) {
    const outDir = options.outDir || DEFAULT_OUT_DIR;
    fs.mkdirSync(outDir, { recursive: true });
    outPath = path.join(outDir, `case-study-outreach-${caseId}.md`);
    fs.writeFileSync(outPath, pack.markdown, 'utf8');
  }
  return { ...pack, outPath };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const result = generate(args);
  if (args.json) {
    console.log(JSON.stringify({
      caseId: result.caseId,
      title: result.title,
      links: result.links,
      channels: result.channels,
      outPath: result.outPath,
    }, null, 2));
  } else if (result.outPath) {
    console.log(`Wrote ${result.outPath}`);
  } else {
    console.log(result.markdown);
  }
  return 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

module.exports = {
  CASES,
  parseArgs,
  withUtm,
  buildPack,
  generate,
  main,
};
