#!/usr/bin/env node
'use strict';

/**
 * Stealth memory injection gate (MemGhost / WhisperBench 2026).
 *
 * Paper: "When Claws Remember but Do Not Tell: Stealthy Memory Injection in
 * Persistent Personal Agents" (arXiv/HF 2607.05189).
 *
 * Threat: untrusted external content (email/IMAP/tool results) induces a
 * persistent personal agent to write poisoned facts/preferences into durable
 * memory carriers (MEMORY.md, AGENTS.md, SOUL.md, …) while staying silent in
 * the user-visible response — later sessions then trust that state.
 *
 * ThumbGate role: pre-action deny when a write targets a durable carrier AND
 * the action/content shows external untrusted provenance and/or stealth
 * memory-injection language.
 */

const GATE_ID = 'block-stealth-memory-injection-from-external';
const PAPER_ID = '2607.05189';
const PAPER_URL = 'https://huggingface.co/papers/2607.05189';

/** Omnipresent / high-availability carriers (paper: carrier availability). */
const DURABLE_CARRIER_PATTERNS = [
  /(?:^|\/)MEMORY\.md$/i,
  /(?:^|\/)AGENTS\.md$/i,
  /(?:^|\/)USER\.md$/i,
  /(?:^|\/)IDENTITY\.md$/i,
  /(?:^|\/)SOUL\.md$/i,
  /(?:^|\/)HEARTBEAT\.md$/i,
  /(?:^|\/)prevention-rules\.md$/i,
  /(?:^|\/)memory\/\d{4}-\d{2}-\d{2}\.md$/i,
  /(?:^|\/)\.thumbgate\/prevention-rules\.md$/i,
  /(?:^|\/)\.claude\/memory\/feedback\/prevention-rules\.md$/i,
  /(?:^|\/)BRAIN\.md$/i,
];

/** Episodic / retrieval-dependent paths still risky when stealth + external. */
const EPISODIC_MEMORY_PATTERNS = [
  /(?:^|\/)memory\//i,
  /(?:^|\/)\.claude\/projects\/.*\/memory\//i,
  /(?:^|\/)mem0\//i,
];

const STEALTH_PATTERNS = [
  /\bsilent(?:ly)?\s+(?:save|store|write|record|remember|inject|add)\b/i,
  /\bdo\s+not\s+(?:tell|say|mention|announce|notify|reveal|disclose)\b/i,
  /\bwithout\s+(?:telling|saying|announcing|notifying|mentioning)\b/i,
  /\bdo\s+not\s+(?:inform|alert)\s+the\s+user\b/i,
  /\bhide\s+(?:this|the)\s+(?:from|update|memory)\b/i,
  /\bstealth(?:y)?\s+memory\b/i,
  /\bmemghost\b/i,
  /\bwhisper\s*bench\b/i,
  /\bnon[- ]?diagnostic\b/i,
  /\bwithout\s+(?:user\s+)?(?:awareness|visibility|confirmation)\b/i,
];

const EXTERNAL_PROVENANCE_PATTERNS = [
  /\b(?:imap|smtp|email|inbox|mailbox|mail\s+cli)\b/i,
  /\bunread\s+(?:mail|email|messages?)\b/i,
  /\bcheck\s+(?:my\s+)?(?:email|inbox)\b/i,
  /\bfrom\s+(?:an?\s+)?(?:email|message|sender)\b/i,
  /\bexternal\s+(?:content|data|payload|source)\b/i,
  /\buntrusted\s+(?:content|source|email|payload)\b/i,
  /\btool_result\b/i,
  /\bindirect\s+prompt\s+injection\b/i,
  /\bpayload\b/i,
];

const PREFERENCE_POISON_PATTERNS = [
  /\balways\s+prefer\b/i,
  /\buser\s+(?:prefers?|wants?|insists?)\b/i,
  /\bpermanent(?:ly)?\s+(?:prefer|use|route|send)\b/i,
  /\bupdate\s+(?:my\s+)?preferences?\b/i,
  /\bfrom\s+now\s+on\b/i,
];

const FACT_POISON_PATTERNS = [
  /\bremember\s+that\b/i,
  /\bfact\s*:\s*/i,
  /\bstore\s+(?:as\s+)?(?:durable\s+)?(?:memory|knowledge|fact)\b/i,
  /\badd\s+to\s+(?:your\s+)?(?:long[- ]?term\s+)?memory\b/i,
  /\bwrite\s+(?:this\s+)?to\s+(?:MEMORY|AGENTS|SOUL|USER)\.md\b/i,
];

const WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'write',
  'edit',
  'create_file',
  'str_replace',
  'StrReplace',
  'ApplyPatch',
  'NotebookEdit',
  'MultiEdit',
]);

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function collectHaystack(toolName, toolInput = {}) {
  const parts = [
    toolName,
    toolInput.command,
    toolInput.file_path,
    toolInput.path,
    toolInput.filePath,
    toolInput.content,
    toolInput.new_string,
    toolInput.old_string,
    toolInput.contents,
    toolInput.notes,
    toolInput.context,
    toolInput.prompt,
    toolInput.description,
  ];
  if (toolInput._claw && typeof toolInput._claw === 'object') {
    parts.push(JSON.stringify(toolInput._claw));
  }
  if (toolInput.clawContext && typeof toolInput.clawContext === 'object') {
    parts.push(JSON.stringify(toolInput.clawContext));
  }
  if (toolInput._externalProvenance) {
    parts.push(String(toolInput._externalProvenance));
  }
  if (toolInput.source) {
    parts.push(String(toolInput.source));
  }
  if (Array.isArray(toolInput.tags)) {
    parts.push(toolInput.tags.join(' '));
  }
  return parts.filter(Boolean).map(normalizeText).join('\n');
}

function extractTargetPaths(toolName, toolInput = {}) {
  const paths = new Set();
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'notebook_path']) {
    if (toolInput[key]) paths.add(normalizeText(toolInput[key]));
  }
  const command = normalizeText(toolInput.command);
  if (command) {
    // Named durable carriers anywhere in the command (tee MEMORY.md, vim AGENTS.md).
    const named = /(?:^|[\s'"=])((?:\.\/|\.\.\/|\/)?(?:[\w.@[\]-]+\/)*(?:MEMORY|AGENTS|USER|IDENTITY|SOUL|HEARTBEAT|BRAIN|prevention-rules)\.md|memory\/\d{4}-\d{2}-\d{2}\.md)/gi;
    let match;
    while ((match = named.exec(command)) !== null) {
      paths.add(match[1]);
    }
    // Shell output redirects: echo ... > MEMORY.md, printf ... >> path
    // Avoid matching comparison operators by requiring whitespace (or start) before `>`.
    const redirect = /(?:^|[\s;|&(])>{1,2}\s*['"]?([^\s'"`;&|<>]+)/g;
    while ((match = redirect.exec(command)) !== null) {
      paths.add(match[1]);
    }
  }
  return [...paths].filter(Boolean);
}

function isDurableCarrier(filePath) {
  const p = normalizeText(filePath);
  return DURABLE_CARRIER_PATTERNS.some((re) => re.test(p));
}

function isEpisodicMemoryPath(filePath) {
  const p = normalizeText(filePath);
  return EPISODIC_MEMORY_PATTERNS.some((re) => re.test(p));
}

function matchAny(text, patterns) {
  const hits = [];
  for (const re of patterns) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

function isWriteLikeTool(toolName, toolInput = {}) {
  if (WRITE_TOOLS.has(toolName)) return true;
  if (toolName === 'Bash' || toolName === 'bash' || toolName === 'Shell') {
    const cmd = normalizeText(toolInput.command);
    // Shell output redirects (echo/printf/cat … > file or >> file). Require a
    // token boundary before `>` so we do not treat `2>1` / comparison noise only;
    // still match the common MemGhost path `echo '…' > MEMORY.md`.
    const hasOutputRedirect = /(?:^|[\s;|&(])>{1,2}\s*\S/.test(cmd);
    return hasOutputRedirect
      || /(?:\btee\b|\bcp\s+|\bmv\s+|\binstall\s+-m|\bsed\s+-i)/i.test(cmd)
      || /\b(?:Write|write_file|create_file)\b/i.test(cmd);
  }
  return false;
}

function isExplicitlyApproved(toolInput = {}) {
  if (toolInput.stealthMemoryInjectionApproved === true) return true;
  if (toolInput._stealthMemoryInjectionApproved === true) return true;
  if (String(process.env.THUMBGATE_ALLOW_STEALTH_MEMORY_INJECTION || '') === '1') {
    return true;
  }
  return false;
}

/**
 * Evaluate whether this tool call should be blocked as stealth memory injection.
 * @returns {null|{decision,gate,message,severity,reasoning,signals}}
 */
function evaluateStealthMemoryInjection(toolName, toolInput = {}) {
  if (isExplicitlyApproved(toolInput)) return null;
  if (!isWriteLikeTool(toolName, toolInput)) return null;

  const targets = extractTargetPaths(toolName, toolInput);
  const durableTargets = targets.filter(isDurableCarrier);
  const episodicTargets = targets.filter(isEpisodicMemoryPath);
  // Require a real memory destination (path or redirect target). Content that only
  // *describes* MEMORY.md attacks (docs, research notes) must not false-positive.
  if (durableTargets.length === 0 && episodicTargets.length === 0) {
    return null;
  }

  const haystack = collectHaystack(toolName, toolInput);
  const stealthHits = matchAny(haystack, STEALTH_PATTERNS);
  const externalHits = matchAny(haystack, EXTERNAL_PROVENANCE_PATTERNS);
  const preferenceHits = matchAny(haystack, PREFERENCE_POISON_PATTERNS);
  const factHits = matchAny(haystack, FACT_POISON_PATTERNS);
  const explicitExternalFlag = Boolean(
    toolInput._externalProvenance
    || toolInput.externalProvenance
    || toolInput.source === 'email'
    || toolInput.source === 'imap'
    || toolInput.source === 'untrusted_external'
  );

  const hasExternal = externalHits.length > 0 || explicitExternalFlag;
  const hasStealth = stealthHits.length > 0;
  const hasPoisonLanguage = preferenceHits.length > 0 || factHits.length > 0;
  const hasDurable = durableTargets.length > 0;

  // Durable + stealth alone is enough (MemGhost core).
  // Durable + external + poison language is enough (provenance risk).
  // Episodic only blocks when stealth + external both present.
  let shouldBlock = false;
  let reasonCode = null;

  if (hasDurable && hasStealth) {
    shouldBlock = true;
    reasonCode = 'durable_carrier_stealth_write';
  } else if (hasDurable && hasExternal && hasPoisonLanguage) {
    shouldBlock = true;
    reasonCode = 'durable_carrier_external_poison';
  } else if (episodicTargets.length > 0 && hasStealth && hasExternal) {
    shouldBlock = true;
    reasonCode = 'episodic_stealth_external';
  }

  if (!shouldBlock) return null;

  const carrierClass = hasDurable ? 'durable' : 'episodic';
  const message = [
    'Blocked: suspected stealth memory injection into persistent agent state.',
    `Gate ${GATE_ID} (paper ${PAPER_ID}).`,
    'Untrusted external content must not silently update durable memory carriers',
    '(MEMORY.md / AGENTS.md / SOUL.md / USER.md / HEARTBEAT.md / prevention-rules).',
    'Require human review, provenance tagging, or set',
    'THUMBGATE_ALLOW_STEALTH_MEMORY_INJECTION=1 only for explicit operator overrides.',
    `See ${PAPER_URL}`,
  ].join(' ');

  return {
    decision: 'deny',
    gate: GATE_ID,
    message,
    severity: 'critical',
    reasoning: [{
      id: GATE_ID,
      action: 'block',
      layer: 'Memory',
      severity: 'critical',
      message,
      paper: PAPER_ID,
      reasonCode,
      carrierClass,
    }],
    signals: {
      paperId: PAPER_ID,
      paperUrl: PAPER_URL,
      reasonCode,
      carrierClass,
      durableTargets,
      episodicTargets,
      stealthHits: stealthHits.slice(0, 5),
      externalHits: externalHits.slice(0, 5),
      preferenceHits: preferenceHits.slice(0, 3),
      factHits: factHits.slice(0, 3),
    },
  };
}

function main() {
  const toolName = process.argv[2] || 'Write';
  let toolInput = {};
  const raw = process.argv[3];
  if (raw) {
    try {
      toolInput = JSON.parse(raw);
    } catch {
      toolInput = { content: raw };
    }
  }
  const result = evaluateStealthMemoryInjection(toolName, toolInput);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result && result.decision === 'deny' ? 2 : 0);
}

if (process.argv[1]
  && require('node:path').resolve(process.argv[1]) === require('node:path').resolve(__filename)) {
  main();
}

module.exports = {
  GATE_ID,
  PAPER_ID,
  PAPER_URL,
  DURABLE_CARRIER_PATTERNS,
  STEALTH_PATTERNS,
  EXTERNAL_PROVENANCE_PATTERNS,
  collectHaystack,
  extractTargetPaths,
  isDurableCarrier,
  isEpisodicMemoryPath,
  isWriteLikeTool,
  evaluateStealthMemoryInjection,
};
