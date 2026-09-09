#!/usr/bin/env node
'use strict';

/**
 * Register / Microsoft ASCII-smuggling FORMAT steal (2026-09-04):
 * strip or fold Unicode TAG characters (U+E0000–U+E007F) BEFORE any
 * keyword, regex, or gate match. Tag-space splicing ("fun" + U+E0020 +
 * "ding") must not defeat a literal match. The same strip also collapses
 * hidden prompt payloads smuggled as tags.
 *
 * Public source:
 *   https://www.theregister.com/security/2026/09/04/ascii-smuggling-isnt-just-an-ai-security-risk/5294595
 *   https://www.microsoft.com/en-us/security/blog/2026/09/03/ascii-smuggling-crosses-over-from-ai-prompt-injection-to-phishing-evasion/
 *
 * Steal the FORMAT (normalize first, then match). Do not clone Microsoft
 * Defender, do not ingest campaign volume, do not dual-edit
 * config/gates/default.json or the untracked ascii-smuggling-protection.js
 * homograph theater.
 *
 * Complementary to scripts/prompt-dlp.js and scripts/secret-redaction.js.
 *
 * ECI: inventory/honesty doctor on pre-existing match rails, not a
 * net-new anti-phishing SKU.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.unicode-tag-block-normalize.v1';
const DEFAULT_ROOT = path.join(__dirname, '..');
const TAG_BLOCK_RE = /[\u{E0000}-\u{E007F}]/gu;
const TAG_ASCII_MIN = 0xE0020;
const TAG_ASCII_MAX = 0xE007E;
const TAG_PLANE = 0xE0000;

const SURFACES = Object.freeze({
  promptDlp: 'scripts/prompt-dlp.js',
  secretRedaction: 'scripts/secret-redaction.js',
  gatesEngine: 'scripts/gates-engine.js',
  memoryFirewall: 'scripts/memory-firewall.js',
});

const HIDDEN_PROMPT_NEEDLES = [
  'ignore previous',
  'ignore all previous',
  'exfiltrate',
  'send secrets',
  'override policy',
];

function hasTagBlock(text) {
  TAG_BLOCK_RE.lastIndex = 0;
  return TAG_BLOCK_RE.test(String(text || ''));
}

function stripTagBlock(text) {
  return String(text || '').replace(TAG_BLOCK_RE, '');
}

function foldTagBlockToAscii(text) {
  const input = String(text || '');
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp >= TAG_ASCII_MIN && cp <= TAG_ASCII_MAX) {
      out += String.fromCharCode(cp - TAG_PLANE);
    } else if (cp >= 0xE0000 && cp <= 0xE007F) {
      /* language tag / cancel tag — drop */
    } else {
      out += ch;
    }
  }
  return out;
}

function normalizeForMatch(text) {
  return stripTagBlock(text);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function evaluateText(input = {}) {
  const text = input.text == null ? null : String(input.text);
  const keywords = asArray(input.keywords).map((row) => String(row || '')).filter(Boolean);
  const matchWithoutNormalize = input.matchWithoutNormalize === true;
  const modelSaidSafe = input.modelSaidSafe === true;

  const issues = [];
  if (text == null) issues.push('text_inventory_unavailable');

  const source = text || '';
  const tagsPresent = hasTagBlock(source);
  const stripped = stripTagBlock(source);
  const folded = foldTagBlockToAscii(source);

  if (tagsPresent) issues.push('unicode_tag_block_present');

  if (tagsPresent && matchWithoutNormalize) {
    issues.push('match_before_normalize');
  }

  for (const word of keywords) {
    const rawHit = source.includes(word);
    const normHit = stripped.includes(word);
    if (!rawHit && normHit) issues.push('keyword_evasion');
  }

  const foldedLower = folded.toLowerCase();
  if (HIDDEN_PROMPT_NEEDLES.some((needle) => foldedLower.includes(needle))) {
    issues.push('hidden_prompt_payload');
  }

  if (modelSaidSafe) issues.push('model_cannot_grant_authority');

  const uniqueIssues = [...new Set(issues)];
  const decision = uniqueIssues.length ? 'deny' : 'allow';
  return {
    schemaVersion: SCHEMA_VERSION,
    decision,
    issues: uniqueIssues,
    tagBlockPresent: tagsPresent,
    normalized: stripped,
    folded,
    weAreNot: [
      'Microsoft Defender campaign detector',
      '2.37M phishing-volume claim',
      'ASCII-smuggling-protection homograph theater',
    ],
    claimBoundary: decision === 'deny'
      ? 'Unicode TAG block present, match ran before strip, or hidden payload folded out of tags. Local ThumbGate doctor, not Microsoft Defender.'
      : 'No TAG-block evasion on this sample. Not a live phishing-volume detector.',
  };
}

function item(id, status, detail) {
  return { id, status, detail };
}

function surfaceExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function evaluateCheckout(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const claimLive = input.claimLive === true;
  const items = [];

  const dlp = surfaceExists(root, SURFACES.promptDlp);
  items.push(item(
    'prompt_ingest_surface',
    dlp ? 'pass' : 'fail',
    dlp
      ? 'Mapped to scripts/prompt-dlp.js. TAG-block strip must run before DLP keyword match.'
      : 'prompt-dlp.js missing',
  ));

  const secrets = surfaceExists(root, SURFACES.secretRedaction);
  items.push(item(
    'secret_match_surface',
    secrets ? 'pass' : 'fail',
    secrets
      ? 'Mapped to scripts/secret-redaction.js. Literal secret regexes lose to TAG-space splicing unless normalized first.'
      : 'secret-redaction.js missing',
  ));

  const gates = surfaceExists(root, SURFACES.gatesEngine);
  items.push(item(
    'pretooluse_match_surface',
    gates ? 'pass' : 'fail',
    gates
      ? 'Mapped to scripts/gates-engine.js. Gate patterns should see stripTagBlock(text), not raw tool input.'
      : 'gates-engine.js missing',
  ));

  const memory = surfaceExists(root, SURFACES.memoryFirewall);
  items.push(item(
    'memory_ingest_surface',
    memory ? 'pass' : 'fail',
    memory
      ? 'Mapped to scripts/memory-firewall.js. Do not promote tag-smuggled episodes as lessons.'
      : 'memory-firewall.js missing',
  ));

  items.push(item(
    'microsoft_defender_campaign',
    'not_wired',
    'Microsoft’s weekday-on / finance-domain volume detector is not implemented.',
  ));
  items.push(item(
    'published_237m_message_count',
    'not_wired',
    '2.37 million message peak is Microsoft’s measurement, not ThumbGate telemetry.',
  ));

  const liveBlockedReasons = [];
  if (claimLive) {
    liveBlockedReasons.push('claimLive_refused_without_defender_runtime');
    for (const row of items.filter((entry) => entry.status === 'not_wired')) {
      liveBlockedReasons.push(`not_wired:${row.id}`);
    }
  }

  const fails = items.filter((row) => row.status === 'fail');
  let decision = 'allow';
  if (claimLive || fails.length > 0) decision = 'deny';

  return {
    schemaVersion: `${SCHEMA_VERSION}.checkout`,
    source: 'https://www.theregister.com/security/2026/09/04/ascii-smuggling-isnt-just-an-ai-security-risk/5294595',
    affiliation: 'none',
    weAreNot: evaluateText({ text: '' }).weAreNot,
    root,
    decision,
    livePromotionAllowed: false,
    claimLive,
    liveBlockedReasons,
    items,
    claimBoundary: claimLive
      ? 'Refused: this doctor cannot become Microsoft Defender or a live phishing-volume product.'
      : 'Local TAG-block strip-then-match mapping. Simulated controls are not Microsoft’s campaign detector.',
  };
}

function formatText(report) {
  if (report.issues) {
    return `unicode-tag-block-normalize  decision=${report.decision}  issues=${(report.issues || []).join(',')}\n${report.claimBoundary}\n`;
  }
  const lines = [
    `unicode-tag-block-normalize  decision=${report.decision}  live=${report.livePromotionAllowed}`,
    `affiliation=${report.affiliation}  not: ${report.weAreNot.join(', ')}`,
  ];
  for (const row of report.items || []) {
    lines.push(`  [${row.status}] ${row.id} — ${row.detail}`);
  }
  lines.push(report.claimBoundary);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    root: DEFAULT_ROOT,
    claimLive: false,
    decide: null,
    decideRequested: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim-live') options.claimLive = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg === '--decide') {
      options.decideRequested = true;
      options.decide = argv[++i];
    } else if (arg.startsWith('--decide=')) {
      options.decideRequested = true;
      options.decide = arg.slice('--decide='.length);
    }
  }
  return options;
}

function missingDecideReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    decision: 'deny',
    issues: ['missing_decide_payload'],
    tagBlockPresent: false,
    normalized: '',
    folded: '',
    weAreNot: evaluateText({ text: '' }).weAreNot,
    claimBoundary: 'Empty --decide payload is not a checkout. Fail closed.',
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let report;
  if (options.claimLive) {
    report = evaluateCheckout({ root: options.root, claimLive: true });
  } else if (options.decideRequested) {
    if (!String(options.decide || '').trim()) {
      report = missingDecideReport();
    } else {
      report = evaluateText(JSON.parse(options.decide));
    }
  } else {
    report = evaluateCheckout({ root: options.root, claimLive: false });
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  return report.decision === 'deny' ? 2 : 0;
}

module.exports = {
  SCHEMA_VERSION,
  SURFACES,
  TAG_BLOCK_RE,
  hasTagBlock,
  stripTagBlock,
  foldTagBlockToAscii,
  normalizeForMatch,
  evaluateText,
  evaluateCheckout,
  formatText,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
