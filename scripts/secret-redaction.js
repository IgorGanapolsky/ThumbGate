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
  { id: 'anthropic_api_key', label: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/gi },
  { id: 'openai_project_key', label: 'OpenAI project key', regex: /\bsk-proj-[A-Za-z0-9_-]{16,}/g },
  { id: 'openai_api_key', label: 'OpenAI API key', regex: /\bsk-[A-Za-z0-9]{20,}/g },

  // GitHub tokens.
  { id: 'github_pat', label: 'GitHub personal access token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g },
  { id: 'github_fine_grained_pat', label: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },

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
    regex: /\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: (_m, scheme) => `${scheme} ${REDACTED('bearer_token')}`,
  },

  // Generic `secretish_key = <value>` / `secretish_key: "<value>"` assignment. The value must be
  // 16+ chars with no whitespace, and the key must be a credential-ish name (never a bare
  // `publishable_key`). Runs last so provider-specific labels are preferred.
  {
    id: 'secret_assignment',
    label: 'Secret assignment',
    regex: /\b(api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|token)\b(\s*[:=]\s*)["']?[A-Za-z0-9_.\/+=~-]{16,}["']?/gi,
    replace: (_m, key, sep) => `${key}${sep}${REDACTED('secret_assignment')}`,
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

module.exports = {
  SECRET_REDACTION_PATTERNS,
  redactSecrets,
  redactSecretsDeep,
  containsSecret,
};
