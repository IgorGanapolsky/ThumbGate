'use strict';

/**
 * secret-redaction.js — the single, canonical secret-redaction helper.
 *
 * WHY THIS EXISTS
 * On 2026-06-10 a live Stripe `sk_live_` key was found in plaintext inside a captured
 * `.thumbgate/conversation-window.jsonl`. ThumbGate must never become a secret-leak vector:
 * secrets must be redacted (a) before any conversation/feedback/memory record lands on disk,
 * and (b) before any training/analytics dataset is exported or shared.
 *
 * This module is the ONE place that owns redaction-at-rest. Capture writers and dataset
 * exporters all call into it instead of each rolling their own. It is intentionally separate
 * from `secret-scanner.js`: that module is the PreToolUse *scan/block* layer and deliberately
 * tolerates `sk_test_`/`test_token` inside commands. For data persisted to disk we redact
 * test-mode secrets too — a `sk_test_` key is still a credential we should not store.
 *
 * NOT REDACTED ON PURPOSE
 *   - Stripe publishable keys (`pk_live_`, `pk_test_`) are public by design. No pattern matches
 *     them, and the generic `key=value` pattern keys on `api_key|secret|token|...`, never on a
 *     bare `publishable_key`, so they are preserved verbatim.
 *
 * Properties:
 *   - Idempotent: re-redacting already-redacted text is a no-op (the `[REDACTED:id]` marker
 *     contains characters outside every value charset).
 *   - Non-mutating: `redactSecretsDeep` returns a redacted copy; inputs are untouched.
 */

const REDACTED = (id) => `[REDACTED:${id}]`;

// Identifier names that denote a credential, used by the generic `key = value` pattern. Kept as
// two small matchers (instead of one mega-alternation) so the assignment regex stays simple.
const SECRET_KEY_NAME = /(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|access[_-]?token|client[_-]?secret)/i;
// Public identifiers whose values are not secrets (e.g. Stripe publishable `pk_*` keys). Excluded
// so `publishable_key = pk_live_…` is preserved verbatim.
const PUBLIC_KEY_NAME = /publishable|public/i;

/**
 * Ordered list of redaction patterns. Order matters: the most specific provider patterns run
 * before the broad `key=value` fallback so a known secret keeps its precise label. Every regex
 * is `g` (and case-insensitive where appropriate) so all occurrences are replaced.
 *
 * `replace` may be a string or a function `(match, ...groups) => string`.
 */
const SECRET_REDACTION_PATTERNS = [
  // PEM / OpenSSH private key blocks — redact the whole block.
  {
    id: 'private_key_block',
    label: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },

  // Stripe secret-bearing keys. Publishable keys (pk_*) are intentionally absent.
  { id: 'stripe_live_secret', label: 'Stripe live secret key', regex: /\bsk_live_[A-Za-z0-9]{8,}/g },
  { id: 'stripe_test_secret', label: 'Stripe test secret key', regex: /\bsk_test_[A-Za-z0-9]{8,}/g },
  { id: 'stripe_restricted_live', label: 'Stripe restricted live key', regex: /\brk_live_[A-Za-z0-9]{8,}/g },
  { id: 'stripe_restricted_test', label: 'Stripe restricted test key', regex: /\brk_test_[A-Za-z0-9]{8,}/g },
  { id: 'stripe_webhook_secret', label: 'Stripe webhook signing secret', regex: /\bwhsec_[A-Za-z0-9]{8,}/g },

  // Anthropic / OpenAI. Run before the legacy `sk-` pattern so the precise label wins.
  { id: 'anthropic_api_key', label: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { id: 'openai_project_key', label: 'OpenAI project key', regex: /\bsk-proj-[A-Za-z0-9_-]{16,}/g },
  { id: 'openai_api_key', label: 'OpenAI API key', regex: /\bsk-[A-Za-z0-9]{20,}/g },

  // GitHub tokens.
  { id: 'github_pat', label: 'GitHub personal access token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g },
  { id: 'github_fine_grained_pat', label: 'GitHub fine-grained token', regex: /\bgithub_pat_\w{20,}/g },

  // Slack tokens.
  { id: 'slack_token', label: 'Slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },

  // Google API key.
  { id: 'google_api_key', label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}/g },

  // AWS access key id (long-lived AKIA + temporary ASIA).
  { id: 'aws_access_key', label: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },

  // JSON Web Tokens.
  {
    id: 'jwt',
    label: 'JSON Web Token',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}/g,
  },

  // `Authorization: Bearer <token>` style. Keep the scheme word, redact the credential.
  {
    id: 'bearer_token',
    label: 'Bearer token',
    regex: /\b(Bearer|Token)\s+[a-z0-9._~+/=-]{16,}/gi,
    replace: (_m, scheme) => `${scheme} ${REDACTED('bearer_token')}`,
  },

  // Generic `<name> = <value>` / `<name>: "<value>"` assignment with a 16+ char whitespace-free
  // value. A simple matcher finds every assignment; the replace fn redacts only when the name is a
  // credential (SECRET_KEY_NAME) and not a public identifier (PUBLIC_KEY_NAME), so `publishable_key`
  // is preserved. Runs last so provider-specific labels are preferred.
  {
    id: 'secret_assignment',
    label: 'Secret assignment',
    regex: /\b([\w.-]{2,40})(\s*[:=]\s*["']?)([A-Za-z0-9._+=~/-]{16,})(["']?)/g,
    replace: (match, key, pre, _value, post) =>
      (SECRET_KEY_NAME.test(key) && !PUBLIC_KEY_NAME.test(key))
        ? `${key}${pre}${REDACTED('secret_assignment')}${post}`
        : match,
  },
];

/**
 * Redact secrets from a single string. Returns the input unchanged when it is not a non-empty
 * string. Each pattern's lastIndex is reset before use so the module-level (stateful, `g`-flag)
 * regexes are safe to reuse across calls.
 *
 * @param {string} text
 * @returns {string}
 */
function redactSecrets(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const replacement = pattern.replace || REDACTED(pattern.id);
    out = out.replace(pattern.regex, replacement);
  }
  return out;
}

/**
 * Returns true if `text` contains at least one redactable secret.
 * @param {string} text
 * @returns {boolean}
 */
function containsSecret(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return SECRET_REDACTION_PATTERNS.some((pattern) => {
    pattern.regex.lastIndex = 0;
    return pattern.regex.test(text);
  });
}

/**
 * Recursively redact every string contained in `value`. Objects and arrays are deep-copied so
 * the input is never mutated; non-string primitives pass through untouched. Object keys are left
 * as-is (only values are redacted).
 *
 * @param {*} value
 * @returns {*} redacted copy
 */
function redactSecretsDeep(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = redactSecretsDeep(val);
    }
    return out;
  }
  return value;
}
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function computeLuhnCheckDigit(digitsWithoutCheck) {
  let sum = 0;
  let shouldDouble = true;
  for (let i = digitsWithoutCheck.length - 1; i >= 0; i -= 1) {
    let digit = Number(digitsWithoutCheck[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return String((10 - (sum % 10)) % 10);
}

function formatCardToken(rawMatch, digestDigits) {
  const digitsOnly = rawMatch.replaceAll(/\D/g, '');
  if (digitsOnly.startsWith('9999')) return rawMatch;
  const middleLen = digitsOnly.length - 5;
  const payload = `9999${digestDigits(digitsOnly, middleLen)}`;
  const fullDigits = `${payload}${computeLuhnCheckDigit(payload)}`;
  let cursor = 0;
  let formatted = '';
  for (const ch of rawMatch) {
    if (ch >= '0' && ch <= '9') {
      formatted += fullDigits[cursor];
      cursor += 1;
    } else {
      formatted += ch;
    }
  }
  return formatted;
}

function tokenizeSecretsReferentially(text, digestHex) {
  let out = text;
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.id === 'bearer_token') {
      out = out.replaceAll(pattern.regex, (full, scheme) => {
        const rawSecret = full.slice(scheme.length).trim();
        return `${scheme} [FPT:bearer_token#${digestHex(rawSecret).slice(0, 8)}]`;
      });
    } else if (pattern.id === 'secret_assignment') {
      out = out.replaceAll(pattern.regex, (match, key, pre, value, post) => (
        (SECRET_KEY_NAME.test(key) && !PUBLIC_KEY_NAME.test(key))
          ? `${key}${pre}[FPT:secret_assignment#${digestHex(value).slice(0, 8)}]${post}`
          : match
      ));
    } else {
      out = out.replaceAll(pattern.regex, (match) => `[FPT:${pattern.id}#${digestHex(match).slice(0, 8)}]`);
    }
  }
  return out;
}

function createVaultlessDigesters(salt) {
  const digestHex = (val) => crypto.createHmac('sha256', salt).update(String(val)).digest('hex');
  const digestDigits = (val, len) => {
    const hex = digestHex(val);
    let out = '';
    for (let i = 0; i < len * 2; i += 2) {
      out += String(Number.parseInt(hex.slice(i, i + 2), 16) % 10);
    }
    return out;
  };
  return { digestHex, digestDigits };
}

function formatEmailToken(match, _local, domain, digestHex) {
  if (domain.toLowerCase() === 'tokenized.local') return match;
  return `tok_${digestHex(match.toLowerCase()).slice(0, 8)}@tokenized.local`;
}

function formatSsnToken(match, sep, digestDigits) {
  const canonical = match.replaceAll(/\D/g, '');
  const d = digestDigits(canonical, 6);
  return `900${sep}${d.slice(0, 2)}${sep}${d.slice(2, 6)}`;
}

function formatUsPhoneToken(match, countryPrefix, area, exchange, digestDigits) {
  if (area === '900' || (area === '555' && exchange.startsWith('01'))) return match;
  const canonical = `${area}${exchange}${match.replaceAll(/\D/g, '').slice(-4)}`;
  const d = digestDigits(canonical, 6);
  const prefix = countryPrefix || '';
  return `${prefix}555-01${d.slice(0, 1)}-${d.slice(1, 5)}`;
}

const FPT_EMAIL_RE = /\b([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24})\b/g;
const FPT_CARD_RE = /\b(?:\d{4}[ -]?){3}\d{1,7}\b/g;
const FPT_SSN_RE = /\b(?!900[-.\s])\d{3}([-.\s])\d{2}\1\d{4}\b/g;
const FPT_US_PHONE_RE = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s](\d{3})[-.\s]\d{4}\b/g;

/**
 * Capital One Databolt-style Vaultless Format-Preserving Tokenization (FPT).
 * Tokenizes sensitive values at ingestion while preserving format and referential integrity.
 */
function tokenizeFormatPreservingVaultless(text, {
  salt = process.env.THUMBGATE_FPT_KEY,
  preserveSecretReferentialIntegrity = false,
} = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (typeof salt !== 'string' || salt.length < 16) {
    throw new TypeError('tokenizeFormatPreservingVaultless requires a secret key of at least 16 characters');
  }
  const { digestHex, digestDigits } = createVaultlessDigesters(salt);
  let out = preserveSecretReferentialIntegrity
    ? tokenizeSecretsReferentially(text, digestHex)
    : redactSecrets(text);
  out = out.replaceAll(FPT_EMAIL_RE, (m, local, dom) => formatEmailToken(m, local, dom, digestHex));
  out = out.replaceAll(FPT_CARD_RE, (m) => formatCardToken(m, digestDigits));
  out = out.replaceAll(FPT_SSN_RE, (m, sep) => formatSsnToken(m, sep, digestDigits));
  out = out.replaceAll(FPT_US_PHONE_RE, (m, area, exch) => {
    const prefixMatch = m.match(/^\+?1[-.\s]/);
    return formatUsPhoneToken(m, prefixMatch ? prefixMatch[0] : '', area, exch, digestDigits);
  });
  return out;
}

function tokenizeDeepAtSource(value, options = {}) {
  let fieldsTokenized = 0;
  function walk(node) {
    if (typeof node === 'string') {
      const tokenized = tokenizeFormatPreservingVaultless(node, options);
      if (tokenized !== node) fieldsTokenized += 1;
      return tokenized;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === 'object') {
      const copy = {};
      for (const [k, v] of Object.entries(node)) copy[k] = walk(v);
      return copy;
    }
    return node;
  }
  return {
    data: walk(value),
    fieldsTokenized,
    referentialIntegrity: true,
  };
}

function collectFieldDetokenizationBlockers(requestedFields, allowedFields) {
  if (!Array.isArray(requestedFields) || requestedFields.length === 0) return [];
  if (!Array.isArray(allowedFields)) return [];
  const allowedSet = new Set(allowedFields);
  return requestedFields
    .filter((field) => !allowedSet.has(field))
    .map((field) => `unauthorized_field_detokenization:${field}`);
}

function writeDetokenizationAudit(auditEntry, { auditLogPath, onAuditEvent }) {
  if (typeof onAuditEvent === 'function') onAuditEvent(auditEntry);
  if (typeof auditLogPath === 'string' && auditLogPath.length > 0) {
    fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
    fs.appendFileSync(auditLogPath, `${JSON.stringify(auditEntry)}\n`, { mode: 0o600 });
  }
}

function enforceZeroTrustDetokenizationGate({
  authenticated = false,
  roleAuthorizedForPlaintext = false,
  explicitDetokenizePermission = false,
  crossesExternalNetwork = false,
  principalId = null,
  requestedFields = [],
  allowedFields = null,
  auditLogPath = null,
  onAuditEvent = null,
} = {}) {
  const blockers = [];
  if (authenticated !== true) blockers.push('unauthenticated_caller');
  if (crossesExternalNetwork) blockers.push('vaultless_tokenization_must_stay_in_customer_environment');
  if (roleAuthorizedForPlaintext !== true || explicitDetokenizePermission !== true) {
    blockers.push('default_tokenized_view_enforced_explicit_detokenize_permission_required');
  }
  blockers.push(...collectFieldDetokenizationBlockers(requestedFields, allowedFields));
  const allowed = blockers.length === 0;
  const viewMode = allowed ? 'DETOKENIZED_PLAINTEXT' : 'TOKENIZED_ONLY';
  const auditEntry = {
    recordedAt: new Date().toISOString(),
    principalId: principalId || 'anonymous',
    requestedFields: Array.isArray(requestedFields) ? [...requestedFields] : [],
    allowed,
    viewMode,
    blockers: [...blockers],
  };
  writeDetokenizationAudit(auditEntry, { auditLogPath, onAuditEvent });
  return {
    allowed,
    viewMode,
    vaultlessInEnvironment: !crossesExternalNetwork,
    blockers,
    auditEntry,
  };
}

module.exports = {
  SECRET_REDACTION_PATTERNS,
  redactSecrets,
  redactSecretsDeep,
  containsSecret,
  computeLuhnCheckDigit,
  tokenizeFormatPreservingVaultless,
  tokenizeDeepAtSource,
  enforceZeroTrustDetokenizationGate,
};
