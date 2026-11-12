#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scanText } = require('./secret-scanner');
const { SECRET_REDACTION_PATTERNS } = require('./secret-redaction');
const { resolveFeedbackDir } = require('./feedback-paths');

const PROMPT_SECRET_LEDGER_FILENAME = 'prompt-secret-ledger.jsonl';

const PROMPT_SECRET_BLOCK_REASON =
  'That message contains a password or key, so it was not sent to the agent. Put it in your password manager or macOS Keychain instead; if you already pasted it anywhere else, change it.';

const PEM_HEADER_REGEX = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/;
const PASSWORD_LINE_HINT_REGEX = /\b(?:password|passwd|passcode|pwd|pw)\b/i;

const SERVICE_BY_ID = {
  anthropic_api_key: 'anthropic',
  openai_api_key: 'openai',
  openai_project_key: 'openai',
  stripe_live_secret: 'stripe',
  stripe_test_secret: 'stripe',
  stripe_restricted_live: 'stripe',
  stripe_restricted_test: 'stripe',
  stripe_webhook_secret: 'stripe',
  github_pat: 'github',
  github_fine_grained_pat: 'github',
  aws_access_key: 'aws',
  google_api_key: 'google',
  slack_token: 'slack',
  pem_private_key: 'ssh_or_tls',
  private_key_block: 'ssh_or_tls',
};

const PASSWORD_KEYWORDS = new Set(['password', 'passwd', 'passcode', 'pwd', 'pw']);
const COPULA_PASSWORD_KEYWORDS = new Set(['password', 'passwd', 'passcode']);
const SHORTHAND_PW_KEYWORDS = new Set(['pw', 'pwd']);
const DETERMINER_WORDS = new Set('my our the new current temp temporary updated'.split(' '));
const PREFIX_FILLER_WORDS = new Set(
  'my our your his her their its the a an this that new old current temp temporary updated changed reset real live test dev local prod production staging personal work company team shared account login signin user admin root master app service site portal dashboard here is was use using with and for on in to of'.split(' ')
);
const NON_SECRET_VALUE_WORDS = new Set(
  'string number boolean object null undefined true false none empty blank required optional redacted hidden masked secret password passwd passcode placeholder example todo tbd n/a na yes no on off'.split(' ')
);
const PROSE_WORDS_AFTER_KEYWORD = new Set(
  'reset resets resetting change changes changed changing update updates updated updating rotate rotated rotation manager managers vault vaults keychain store stored saved kept hashed hashing hash hashes salt encrypted encryption leaked exposed blocked redacted field fields input inputs prompt prompts policy policies check checks column columns form forms flow flows auth login logout signin signup page modal dialog screen button link error errors issue issues bug bugs fix test tests testing spec file files path env var vars config guard gate hook rule rules less only protection protected strength validation validator generator recovery forgot forgotten expired missing invalid incorrect rejected wrong broken safe strong weak short long good bad fine ok okay working fixed same different not still already never always now here in on at by of for from to with without before after into onto over under and or a an the my your our their this that what which who must should can will would could may might does did has have had is was are be'.split(' ')
);

function tryRequire(modPath) {
  try {
    return require(modPath);
  } catch {
    return null;
  }
}

function isAsciiAlpha(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiAlnum(code) {
  return isAsciiAlpha(code) || (code >= 48 && code <= 57);
}

function isServiceBodyChar(code) {
  return isAsciiAlnum(code) || code === 46 || code === 95 || code === 45;
}

function isTrailingSentencePunct(code) {
  return code === 46 || code === 44 || code === 59 || code === 33 || code === 63;
}

function trimByCode(str, trimLeadFn, trimTrailFn) {
  let start = 0;
  let end = str.length;
  while (start < end && trimLeadFn(str.codePointAt(start))) start += 1;
  while (end > start && trimTrailFn(str.codePointAt(end - 1))) end -= 1;
  return str.slice(start, end);
}

function lettersOnlyLower(raw) {
  const input = String(raw || '').slice(0, 64);
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.codePointAt(i);
    if (isAsciiAlpha(code)) out += input[i].toLowerCase();
  }
  return out;
}

function normalizeWordToken(raw) {
  const input = String(raw || '').slice(0, 64);
  const trimmed = trimByCode(input, (c) => !isAsciiAlnum(c), (c) => !isAsciiAlnum(c));
  return trimmed.toLowerCase();
}

function sanitizeMetricId(raw) {
  const input = String(raw || 'secret_material').slice(0, 64);
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const c = input.codePointAt(i);
    out += isServiceBodyChar(c) ? input[i] : '_';
  }
  return out || 'secret_material';
}

function isPromptSecretGuardEnabled(options = {}) {
  if (options.enabled === false) return false;
  if (options.enabled === true) return true;
  const env = options.env || process.env;
  const raw = String(env.THUMBGATE_PROMPT_SECRET_GUARD ?? 'on').trim().toLowerCase();
  return !['off', '0', 'false', 'no', 'disable', 'disabled'].includes(raw);
}

function sanitizeServiceToken(raw) {
  const input = String(raw || '').trim();
  if (!input || input.length > 64) return null;
  const cleaned = trimByCode(input, (c) => !isAsciiAlnum(c), (c) => !isServiceBodyChar(c)).toLowerCase();
  if (cleaned.length < 2 || cleaned.length > 32 || !isAsciiAlpha(cleaned.codePointAt(0))) return null;
  for (let i = 1; i < cleaned.length; i += 1) {
    if (!isServiceBodyChar(cleaned.codePointAt(i))) return null;
  }
  if (PREFIX_FILLER_WORDS.has(cleaned) || PASSWORD_KEYWORDS.has(cleaned) || PROSE_WORDS_AFTER_KEYWORD.has(cleaned)) {
    return null;
  }
  return cleaned;
}

function extractServiceGuessFromWords(wordsBeforeKeyword, explicitForTarget = null) {
  const fromFor = sanitizeServiceToken(explicitForTarget);
  if (fromFor) return fromFor;
  for (let i = wordsBeforeKeyword.length - 1; i >= 0; i -= 1) {
    const candidate = sanitizeServiceToken(wordsBeforeKeyword[i]);
    if (candidate) return candidate;
  }
  return 'unknown';
}

function stripMatchingQuotes(rawToken) {
  let token = String(rawToken || '').trim();
  while (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
      token = token.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return token;
}

function isAllMaskChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '*' && ch !== '.' && ch !== '-' && ch !== 'x' && ch !== 'X' && ch !== '•') return false;
  }
  return true;
}

function hasDisallowedPrefix(token, mode) {
  if (token.startsWith('$') || token.startsWith('<') || token.startsWith('[')) return true;
  if (mode === 'delimited') return false;
  return token.startsWith('-') || token.startsWith('/') || token.startsWith('./') || token.startsWith('~/');
}

function isEnvironmentLookupValue(lower) {
  return lower.startsWith('process.env') || lower.startsWith('os.environ') || lower.startsWith('env.');
}

function isAlphaOnlyWord(token) {
  for (let i = 0; i < token.length; i += 1) {
    if (!isAsciiAlpha(token.codePointAt(i))) return false;
  }
  return token.length > 0;
}

function isLikelySecretValue(rawToken, mode = 'delimited') {
  const token = stripMatchingQuotes(rawToken);
  if (token.length < 4 || hasDisallowedPrefix(token, mode)) return false;
  const trimmedPunct = trimByCode(token, () => false, isTrailingSentencePunct);
  const lower = trimmedPunct.toLowerCase();
  if (lower.length < 4 || NON_SECRET_VALUE_WORDS.has(lower) || isAllMaskChars(lower) || isEnvironmentLookupValue(lower)) {
    return false;
  }
  if (mode !== 'delimited') return !PROSE_WORDS_AFTER_KEYWORD.has(lower);
  return !(PROSE_WORDS_AFTER_KEYWORD.has(lower) && isAlphaOnlyWord(trimmedPunct));
}

function splitWords(segment) {
  return String(segment || '').trim().split(/\s+/).filter(Boolean);
}

function parseDelimitedLhs(lhsWords) {
  if (lhsWords.length === 0) return null;
  let endIdx = lhsWords.length;
  if (lettersOnlyLower(lhsWords[endIdx - 1]) === 'is') endIdx -= 1;
  if (endIdx === 0) return null;

  const tailWord = lettersOnlyLower(lhsWords[endIdx - 1]);
  if (PASSWORD_KEYWORDS.has(tailWord)) {
    return { beforeWords: lhsWords.slice(0, endIdx - 1), explicitService: null };
  }
  if (endIdx >= 3 && lhsWords[endIdx - 2].toLowerCase() === 'for') {
    const kw = lettersOnlyLower(lhsWords[endIdx - 3]);
    if (PASSWORD_KEYWORDS.has(kw)) {
      return { beforeWords: lhsWords.slice(0, endIdx - 3), explicitService: lhsWords[endIdx - 1] };
    }
  }
  return null;
}

function detectDelimitedOnLine(line) {
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if ((ch !== ':' && ch !== '=') || (ch === ':' && line.slice(i, i + 3) === '://')) continue;
    const lhsParsed = parseDelimitedLhs(splitWords(line.slice(0, i)));
    if (!lhsParsed) continue;
    const rhsWords = splitWords(line.slice(i + 1));
    if (rhsWords.length > 0 && isLikelySecretValue(rhsWords[0], 'delimited')) {
      return {
        id: 'password_phrase',
        label: 'Password phrase',
        serviceGuess: extractServiceGuessFromWords(lhsParsed.beforeWords, lhsParsed.explicitService),
      };
    }
  }
  return null;
}

function hasCopulaContext(priorWords) {
  return priorWords.some((w) => {
    const lw = normalizeWordToken(w);
    return DETERMINER_WORDS.has(lw) || Boolean(sanitizeServiceToken(w));
  });
}

function hasShorthandPrefix(priorWords) {
  return priorWords.every((w) => {
    const lw = normalizeWordToken(w);
    return PREFIX_FILLER_WORDS.has(lw) || Boolean(sanitizeServiceToken(w));
  });
}

function checkCopulaPasswordAt(words, index) {
  if (index + 2 >= words.length) return null;
  const kw = normalizeWordToken(words[index]);
  if (!COPULA_PASSWORD_KEYWORDS.has(kw) || normalizeWordToken(words[index + 1]) !== 'is') return null;
  const prior = words.slice(Math.max(0, index - 4), index);
  if (!hasCopulaContext(prior) || !isLikelySecretValue(words[index + 2], 'copula')) return null;
  return { id: 'password_phrase', label: 'Password phrase', serviceGuess: extractServiceGuessFromWords(prior) };
}

function checkShorthandPwAt(words, index) {
  if (index > 3 || index + 1 >= words.length) return null;
  const kw = normalizeWordToken(words[index]);
  if (!SHORTHAND_PW_KEYWORDS.has(kw)) return null;
  const prior = words.slice(0, index);
  if (!hasShorthandPrefix(prior) || !isLikelySecretValue(words[index + 1], 'shorthand')) return null;
  return { id: 'password_phrase', label: 'Password phrase', serviceGuess: extractServiceGuessFromWords(prior) };
}

function detectUnpunctuatedClause(clause) {
  const words = splitWords(clause);
  for (let i = 0; i < words.length - 1; i += 1) {
    const hit = checkCopulaPasswordAt(words, i) || checkShorthandPwAt(words, i);
    if (hit) return hit;
  }
  return null;
}

function detectPasswordPhrase(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line || !PASSWORD_LINE_HINT_REGEX.test(line)) continue;
    const delimitedHit = detectDelimitedOnLine(line);
    if (delimitedHit) return delimitedHit;
    for (const clause of line.split(/[;|,()]+/)) {
      const clauseHit = detectUnpunctuatedClause(clause);
      if (clauseHit) return clauseHit;
    }
  }
  return null;
}

function matchRedactionPattern(pattern, text) {
  if (pattern.id === 'secret_assignment' || pattern.id === 'private_key_block') return null;
  pattern.regex.lastIndex = 0;
  const match = pattern.regex.exec(text);
  if (!match) return null;
  const id = pattern.id === 'jwt' ? 'jwt_token' : pattern.id;
  const prefixWords = splitWords(text.slice(Math.max(0, match.index - 80), match.index)).slice(-5);
  return {
    id,
    label: pattern.label,
    serviceGuess: SERVICE_BY_ID[id] || extractServiceGuessFromWords(prefixWords),
    source: 'prompt',
  };
}

function collectKnownKeyFindings(text) {
  const findings = [];
  if (text.includes('PRIVATE KEY-----') && PEM_HEADER_REGEX.test(text)) {
    findings.push({ id: 'private_key_block', label: 'Private key block', serviceGuess: 'ssh_or_tls', source: 'prompt' });
  }
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    const hit = matchRedactionPattern(pattern, text);
    if (hit) findings.push(hit);
  }
  return findings;
}

function collectFallbackScanFindings(text, provider) {
  const scanResult = scanText(text, { provider: provider || 'heuristic', source: 'prompt' });
  if (!scanResult.detected || !Array.isArray(scanResult.findings)) return [];
  return scanResult.findings.map((f) => {
    const id = f.id || 'secret_material';
    return { id, label: f.label || 'Secret material', serviceGuess: SERVICE_BY_ID[id] || 'unknown', source: 'prompt' };
  });
}

function detectPromptSecrets(prompt, options = {}) {
  const text = String(prompt || '');
  if (!text.trim()) return { detected: false, findings: [] };

  const findings = collectKnownKeyFindings(text);
  const passwordHit = detectPasswordPhrase(text);
  if (passwordHit) findings.push({ ...passwordHit, source: 'prompt' });

  if (findings.length === 0) {
    findings.push(...collectFallbackScanFindings(text, options.provider));
  }
  return { detected: findings.length > 0, findings };
}

function buildDiagnosticRecord(safeType, safeService, timestamp) {
  return {
    source: 'secret_guard',
    step: 'user_prompt_submit',
    timestamp,
    context: 'Redacted user prompt blocked before model submission',
    metadata: { type: safeType, serviceGuess: safeService, time: timestamp },
    diagnosis: {
      diagnosed: true,
      rootCauseCategory: 'guardrail_triggered',
      criticalFailureStep: 'user_prompt_submit',
      violations: [
        {
          constraintId: `security:${safeType}`,
          description: 'Secret in user prompt blocked before model submission',
          metadata: { type: safeType, serviceGuess: safeService, time: timestamp },
        },
      ],
      evidence: [safeType],
    },
  };
}

function persistDiagnosticRecord(resolvedDir, feedbackDir, diagnosticRecord) {
  const feedbackLoop = feedbackDir ? null : tryRequire('./feedback-loop');
  try {
    if (typeof feedbackLoop?.appendDiagnosticRecord === 'function') {
      feedbackLoop.appendDiagnosticRecord(diagnosticRecord);
      return;
    }
    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.appendFileSync(path.join(resolvedDir, 'diagnostic-log.jsonl'), `${JSON.stringify(diagnosticRecord)}\n`);
  } catch { /* best-effort diagnostic write */ }
}

function persistAuditRecord(feedbackDir, safeType, safeService) {
  if (feedbackDir) return;
  const auditTrail = tryRequire('./audit-trail');
  if (typeof auditTrail?.recordAuditEvent !== 'function') return;
  try {
    const rec = auditTrail.recordAuditEvent({
      toolName: 'UserPromptSubmit',
      toolInput: { type: safeType, serviceGuess: safeService },
      decision: 'deny',
      gateId: 'prompt-secret-guard',
      message: 'Blocked secret in user prompt before model submission',
      severity: 'critical',
      source: 'secret-guard',
    });
    auditTrail.auditToFeedback?.(rec);
  } catch { /* best-effort audit write */ }
}

function recordPromptSecretEvent({ type, serviceGuess, time, feedbackDir }) {
  const resolvedDir = feedbackDir || resolveFeedbackDir();
  const timestamp = time || new Date().toISOString();
  const safeType = sanitizeMetricId(type);
  const safeService = sanitizeServiceToken(serviceGuess) || SERVICE_BY_ID[safeType] || 'unknown';
  const ledgerEntry = {
    id: `psg_${crypto.randomUUID()}`,
    event: 'prompt_secret_blocked',
    type: safeType,
    serviceGuess: safeService,
    time: timestamp,
    timestamp,
  };

  try {
    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.appendFileSync(path.join(resolvedDir, PROMPT_SECRET_LEDGER_FILENAME), `${JSON.stringify(ledgerEntry)}\n`);
  } catch { /* best-effort ledger write */ }

  persistDiagnosticRecord(resolvedDir, feedbackDir, buildDiagnosticRecord(safeType, safeService, timestamp));
  persistAuditRecord(feedbackDir, safeType, safeService);
  return ledgerEntry;
}

function buildPromptGuardOutput() {
  return {
    decision: 'block',
    reason: PROMPT_SECRET_BLOCK_REASON,
    continue: false,
    suppressOutput: true,
    stopReason: PROMPT_SECRET_BLOCK_REASON,
  };
}

function evaluatePromptGuard(prompt, options = {}) {
  if (!isPromptSecretGuardEnabled(options)) return null;
  const detection = detectPromptSecrets(prompt, options);
  if (!detection.detected || detection.findings.length === 0) return null;

  const primary = detection.findings[0];
  recordPromptSecretEvent({
    type: primary.id,
    serviceGuess: primary.serviceGuess,
    time: options.now || new Date().toISOString(),
    feedbackDir: options.feedbackDir,
  });
  return buildPromptGuardOutput();
}

function readPromptFromStdinSync() {
  try {
    if (process.stdin.isTTY) return '';
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw?.trim()) return '';
    const sanitizer = tryRequire('./feedback-sanitizer');
    const envelopePrompt = sanitizer?.extractPromptEnvelope?.(raw)?.prompt;
    if (typeof envelopePrompt === 'string') return envelopePrompt;
    const parsed = JSON.parse(raw);
    return typeof parsed?.prompt === 'string' ? parsed.prompt : raw;
  } catch {
    return '';
  }
}

function main() {
  const prompt =
    process.env.CLAUDE_USER_PROMPT ||
    process.env.THUMBGATE_USER_PROMPT ||
    process.env.CODEX_USER_PROMPT ||
    process.env.USER_PROMPT ||
    readPromptFromStdinSync();
  const result = evaluatePromptGuard(prompt);
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = {
  PROMPT_SECRET_BLOCK_REASON,
  PROMPT_SECRET_LEDGER_FILENAME,
  buildPromptGuardOutput,
  detectPasswordPhrase,
  detectPromptSecrets,
  evaluatePromptGuard,
  isPromptSecretGuardEnabled,
  recordPromptSecretEvent,
};
