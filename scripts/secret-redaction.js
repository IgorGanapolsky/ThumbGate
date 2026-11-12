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

/**
 * Capital One Databolt-style Vaultless Format-Preserving Tokenization (FPT).
 */
function tokenizeFormatPreservingVaultless(text, { salt = process.env.THUMBGATE_FPT_KEY } = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (typeof salt !== 'string' || salt.length < 16) {
    throw new Error('tokenizeFormatPreservingVaultless requires a secret key of at least 16 characters');
  }
  const digestHex = (val) => crypto.createHmac('sha256', String(salt)).update(String(val)).digest('hex');
  const digestDigits = (val, len) => {
    const hex = digestHex(val);
    let out = '';
    for (let i = 0; i < hex.length && out.length < len; i += 2) {
      out += String(Number.parseInt(hex.slice(i, i + 2), 16) % 10);
    }
    return out.padEnd(len, '0').slice(0, len);
  };

  let out = redactSecrets(text);
  out = out.replace(/\b([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (match, _local, domain) => {
    if (domain.toLowerCase() === 'tokenized.local') return match;
    return `tok_${digestHex(match.toLowerCase()).slice(0, 8)}@tokenized.local`;
  });
  out = out.replace(/\b(?!900-)\d{3}-\d{2}-\d{4}\b/g, (match) => {
    const d = digestDigits(match, 6);
    return `900-${d.slice(0, 2)}-${d.slice(2, 6)}`;
  });
  out = out.replace(/\b(\d{3})-(\d{3})-(\d{4})\b/g, (match, a, b) => {
    if (a === '900' || (a === '555' && b.startsWith('01'))) return match;
    const d = digestDigits(match, 6);
    return `555-01${d.slice(0, 1)}-${d.slice(1, 5)}`;
  });
  return out;
}

function enforceZeroTrustDetokenizationGate({
  authenticated = false,
  roleAuthorizedForPlaintext = false,
  explicitDetokenizePermission = false,
  crossesExternalNetwork = false,
} = {}) {
  const blockers = [];
  if (authenticated !== true) blockers.push('unauthenticated_caller');
  if (crossesExternalNetwork) blockers.push('vaultless_tokenization_must_stay_in_customer_environment');
  if (roleAuthorizedForPlaintext !== true || explicitDetokenizePermission !== true) {
    blockers.push('default_tokenized_view_enforced_explicit_detokenize_permission_required');
  }
  return {
    allowed: blockers.length === 0,
    viewMode: blockers.length === 0 ? 'DETOKENIZED_PLAINTEXT' : 'TOKENIZED_ONLY',
    vaultlessInEnvironment: !crossesExternalNetwork,
    blockers,
  };
}

const os = require('node:os');

const TOKEN_PATTERN_IDS = new Set([
  'github_pat',
  'github_fine_grained_pat',
  'slack_token',
  'jwt',
  'bearer_token',
]);
const STABLE_SKIP_OBJECT_KEYS = new Set([
  'id',
  'sourceFeedbackId',
  'relatedFeedbackId',
  'canonicalHash',
  'receiptHash',
  'timestamp',
  'recordedAt',
  'lastVerifiedAt',
  'createdAt',
  'updatedAt',
  'signal',
  'type',
  'status',
  'domain',
  'importance',
  'verificationStatus',
]);
const NON_EMAIL_EXT_RE = /\.(?:[cm]?[jt]sx?|json|ya?ml|md|png|jpe?g|gif|webp|svg|ico|css|scss|html?|lock|service|socket|timer|target|git|py|rb|go|rs|java|kt|swift|sh)$/i;
const PLACEHOLDER_GUARD_RE = /\[(?:SECRET|TOKEN|EMAIL|PHONE|REDACTED):[A-Za-z0-9_-]+\]/g;
const SENTINEL_RE = /\uE000TGPH_(\d+)_\uE000/g;
const EMAIL_SOURCE_RE = /(?<![A-Za-z0-9._%+-:/])([A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?)@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)(?![A-Za-z0-9_:]|[.-][A-Za-z0-9])/g;
const US_PAREN_PHONE_RE = /(?<![0-9A-Za-z_./-])(?:\+?1[-.\s]?)?\([2-9]\d{2}\)[-.\s]?[2-9]\d{2}[-.\s]\d{4}(?![0-9A-Za-z_]|[.-]\d)/g;
const US_SEP_PHONE_RE = /(?<![0-9A-Za-z_./-])(?:\+1[-.\s]?)?[2-9]\d{2}([-.])[2-9]\d{2}\1\d{4}(?![0-9A-Za-z_]|[.-]\d)/g;
const US_PLUS_SPACE_PHONE_RE = /(?<![0-9A-Za-z_./-])\+1\s[2-9]\d{2}\s[2-9]\d{2}\s\d{4}(?![0-9A-Za-z_]|[.-]\d)/g;
const INTL_PHONE_SOURCE_RE = /(?<![0-9A-Za-z_./-])\+[1-9]\d{0,2}(?:[-.\s]\d{2,8}){2,4}(?![0-9A-Za-z_]|[.-]\d)/g;
const E164_PHONE_SOURCE_RE = /(?<![0-9A-Za-z_./-])\+[1-9]\d{9,14}(?![0-9A-Za-z_]|[.-]\d)/g;

let cachedDefaultSalt = null;
function resolveSourceRedactionSalt(explicitSalt) {
  if (typeof explicitSalt === 'string' && explicitSalt.trim()) return explicitSalt.trim();
  const envSalt = process.env.THUMBGATE_PLACEHOLDER_SALT;
  if (typeof envSalt === 'string' && envSalt.trim()) return envSalt.trim();
  if (cachedDefaultSalt) return cachedDefaultSalt;
  let user = 'local';
  try {
    user = os.userInfo().username || 'local';
  } catch {
    /* fallback when os.userInfo throws in keyless containers */
  }
  cachedDefaultSalt = crypto.createHash('sha256')
    .update(`thumbgate-source-placeholder-v1:${os.hostname()}:${user}`)
    .digest('hex');
  return cachedDefaultSalt;
}

function stablePlaceholder(kind, canonicalValue, salt) {
  const digest = crypto.createHmac('sha256', salt).update(String(canonicalValue)).digest('hex').slice(0, 8);
  return `[${kind}:${digest}]`;
}

function maskExistingPlaceholders(text) {
  const saved = [];
  const masked = text.replace(PLACEHOLDER_GUARD_RE, (m) => {
    const idx = saved.push(m) - 1;
    return `\uE000TGPH_${idx}_\uE000`;
  });
  return { masked, saved };
}

function unmaskPlaceholders(text, saved) {
  if (!saved.length) return text;
  return text.replace(SENTINEL_RE, (_m, idx) => saved[Number(idx)] || '');
}

function trimTrailingDot(cred) {
  return cred.endsWith('.') ? { core: cred.slice(0, -1), suffix: '.' } : { core: cred, suffix: '' };
}

function replacePatternWithStablePlaceholder(out, pattern, salt) {
  pattern.regex.lastIndex = 0;
  if (pattern.id === 'bearer_token') {
    return out.replace(/\b(Bearer)\s+([A-Za-z0-9._~+/=-]{16,})/g, (_m, scheme, cred) => {
      const { core, suffix } = trimTrailingDot(cred);
      return `${scheme} ${stablePlaceholder('TOKEN', core, salt)}${suffix}`;
    });
  }
  if (pattern.id === 'secret_assignment') {
    return out.replace(pattern.regex, (match, key, pre, value, post) => {
      if (!SECRET_KEY_NAME.test(key) || PUBLIC_KEY_NAME.test(key)) return match;
      const { core, suffix } = trimTrailingDot(value);
      const kind = /token/i.test(key) ? 'TOKEN' : 'SECRET';
      return `${key}${pre}${stablePlaceholder(kind, core, salt)}${suffix}${post}`;
    });
  }
  const kind = TOKEN_PATTERN_IDS.has(pattern.id) ? 'TOKEN' : 'SECRET';
  return out.replace(pattern.regex, (match) => stablePlaceholder(kind, match, salt));
}

function normalizePhoneDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function shouldKeepEmailLiteral(local, domain) {
  const lowerDomain = domain.toLowerCase();
  if (lowerDomain === 'tokenized.local') return true;
  if (NON_EMAIL_EXT_RE.test(lowerDomain)) return true;
  if (/^\d+x\./i.test(lowerDomain) || /^\d+\.\d+/.test(lowerDomain)) return true;
  return local.toLowerCase() === 'git' && /github|gitlab|bitbucket/i.test(lowerDomain);
}

function replacePhoneMatch(match, salt) {
  const norm = normalizePhoneDigits(match);
  if (norm.length < 10 || /^55501\d{5}$/.test(norm)) return match;
  return stablePlaceholder('PHONE', norm, salt);
}

function redactSourceDataStable(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const salt = resolveSourceRedactionSalt(options.salt);
  const { masked, saved } = maskExistingPlaceholders(text);
  let out = masked;
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    out = replacePatternWithStablePlaceholder(out, pattern, salt);
  }
  out = out.replace(EMAIL_SOURCE_RE, (match, local, domain) => (
    shouldKeepEmailLiteral(local, domain) ? match : stablePlaceholder('EMAIL', match.toLowerCase(), salt)
  ));
  for (const phoneRe of [US_PAREN_PHONE_RE, US_SEP_PHONE_RE, US_PLUS_SPACE_PHONE_RE, INTL_PHONE_SOURCE_RE, E164_PHONE_SOURCE_RE]) {
    out = out.replace(phoneRe, (m) => replacePhoneMatch(m, salt));
  }
  return unmaskPlaceholders(out, saved);
}

function isNonPlainObject(value) {
  return value instanceof Date || value instanceof RegExp || Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof Map || value instanceof Set;
}

function isSafeTopLevelSkipValue(key, val, depth) {
  if (depth > 0 || !STABLE_SKIP_OBJECT_KEYS.has(key)) return false;
  if (typeof val !== 'string') return true;
  return val.length <= 128 && !val.includes('@') && !val.includes(' ') && !containsSecret(val);
}

function redactArrayDeep(arr, options, seen, depth) {
  const mapped = [];
  seen.set(arr, mapped);
  for (const item of arr) {
    mapped.push(redactValueDeep(item, options, seen, depth + 1));
  }
  const metaDesc = Object.getOwnPropertyDescriptor(arr, 'retrievalMeta');
  if (metaDesc && 'value' in metaDesc) {
    Object.defineProperty(mapped, 'retrievalMeta', {
      ...metaDesc,
      value: redactValueDeep(metaDesc.value, options, seen, depth + 1),
    });
  }
  return mapped;
}

function redactValueDeep(value, options, seen, depth) {
  if (typeof value === 'string') return redactSourceDataStable(value, options);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (isNonPlainObject(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) return redactArrayDeep(value, options, seen, depth);
  const out = {};
  seen.set(value, out);
  for (const [key, val] of Object.entries(value)) {
    out[key] = isSafeTopLevelSkipValue(key, val, depth) ? val : redactValueDeep(val, options, seen, depth + 1);
  }
  return out;
}

function redactSourceDataStableDeep(value, options = {}) {
  return redactValueDeep(value, options, new WeakMap(), 0);
}
module.exports = {
  SECRET_REDACTION_PATTERNS,
  redactSecrets,
  redactSecretsDeep,
  containsSecret,
  tokenizeFormatPreservingVaultless,
  enforceZeroTrustDetokenizationGate,
  redactSourceDataStable,
  redactSourceDataStableDeep,
};
