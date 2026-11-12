'use strict';

/**
 * secret-redaction.test.js
 *
 * Proves the canonical secret-redaction helper redacts the required token families, and that a
 * planted fake secret is redacted in BOTH the capture path (conversation-window writer) and the
 * export path (DPO + Databricks exporters). Regression guard for the 2026-06-10 incident where a
 * live Stripe sk_live_ key was found in plaintext in .thumbgate/conversation-window.jsonl.
 *
 * All "secrets" below are obviously-fake fixtures assembled by string concatenation, so no literal
 * credential ever appears in source (mirrors scripts/secret-fixture-tokens.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  redactSecrets,
  redactSecretsDeep,
  containsSecret,
  computeLuhnCheckDigit,
  tokenizeFormatPreservingVaultless,
  tokenizeDeepAtSource,
  enforceZeroTrustDetokenizationGate,
  SECRET_REDACTION_PATTERNS,
} = require('../scripts/secret-redaction');
const { recordConversationEntry } = require('../scripts/feedback-history-distiller');
const { exportDpoFromMemories } = require('../scripts/export-dpo-pairs');
const { exportDatabricksBundle } = require('../scripts/export-databricks-bundle');

// --- Fake fixtures (concatenated; never a contiguous secret literal in source) ---
const FAKE = {
  stripeLive: ['sk', '_live_', '0'.repeat(24)].join(''),
  stripeTest: ['sk', '_test_', '0'.repeat(24)].join(''),
  stripeRestricted: ['rk', '_live_', '0'.repeat(24)].join(''),
  stripeWebhook: ['wh', 'sec_', '0'.repeat(32)].join(''),
  stripePublishable: ['pk', '_live_', '0'.repeat(24)].join(''), // public — must NOT be redacted
  awsAccessKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  bearer: ['Bearer ', 'a'.repeat(40)].join(''),
  genericApiKey: ['api', '_key=', 'Z'.repeat(32)].join(''),
};

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// 1. Helper unit behaviour
// ---------------------------------------------------------------------------

test('redacts Stripe live/test/restricted secret keys and webhook secrets', () => {
  for (const [key, id] of [
    ['stripeLive', 'stripe_live_secret'],
    ['stripeTest', 'stripe_test_secret'],
    ['stripeRestricted', 'stripe_restricted_live'],
    ['stripeWebhook', 'stripe_webhook_secret'],
  ]) {
    const out = redactSecrets(`value=${FAKE[key]} end`);
    assert.ok(!out.includes(FAKE[key]), `${key} value should be gone`);
    assert.ok(out.includes(`[REDACTED:${id}]`), `${key} should be labelled ${id}`);
  }
});

test('redacts AWS access key, bearer token, and generic key=value assignment', () => {
  const aws = redactSecrets(`aws ${FAKE.awsAccessKey} here`);
  assert.ok(!aws.includes(FAKE.awsAccessKey));
  assert.ok(aws.includes('[REDACTED:aws_access_key]'));

  const bearer = redactSecrets(`Authorization: ${FAKE.bearer}`);
  assert.ok(!bearer.includes('a'.repeat(40)));
  assert.ok(bearer.includes('[REDACTED:bearer_token]'));
  assert.ok(bearer.includes('Bearer '), 'scheme word preserved');

  const generic = redactSecrets(FAKE.genericApiKey);
  assert.ok(!generic.includes('Z'.repeat(32)));
  assert.ok(generic.includes('[REDACTED:secret_assignment]'));
});

test('does NOT redact Stripe publishable (pk_live_) key — it is public', () => {
  const out = redactSecrets(`publishable_key is ${FAKE.stripePublishable}`);
  assert.equal(out, `publishable_key is ${FAKE.stripePublishable}`);
  assert.equal(containsSecret(FAKE.stripePublishable), false);
});

test('containsSecret detects a planted secret and ignores clean text', () => {
  assert.equal(containsSecret(`x ${FAKE.stripeLive}`), true);
  assert.equal(containsSecret('a perfectly ordinary sentence with no keys'), false);
});

test('redactSecretsDeep walks nested objects/arrays without mutating the input', () => {
  const input = {
    role: 'user',
    content: `here is my key ${FAKE.stripeLive}`,
    nested: { items: [`leak ${FAKE.awsAccessKey}`, 'clean', 42, null] },
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = redactSecretsDeep(input);

  assert.deepEqual(input, snapshot, 'input must not be mutated');
  assert.ok(!JSON.stringify(out).includes(FAKE.stripeLive));
  assert.ok(!JSON.stringify(out).includes(FAKE.awsAccessKey));
  assert.equal(out.nested.items[1], 'clean');
  assert.equal(out.nested.items[2], 42);
  assert.equal(out.nested.items[3], null);
});

test('redaction is idempotent and patterns are non-empty', () => {
  const once = redactSecrets(`k=${FAKE.stripeLive}`);
  assert.equal(redactSecrets(once), once);
  assert.ok(SECRET_REDACTION_PATTERNS.length > 0);
});

// ---------------------------------------------------------------------------
// 2. Capture path — conversation-window writer
// ---------------------------------------------------------------------------

test('capture: recordConversationEntry redacts a planted secret before writing conversation-window.jsonl', () => {
  const feedbackDir = mkTmp('tg-redact-capture-');
  const result = recordConversationEntry(
    { role: 'user', text: `Use this key in checkout: ${FAKE.stripeLive} thanks` },
    { feedbackDir },
  );
  assert.equal(result.recorded, true);

  const onDisk = fs.readFileSync(result.conversationLogPath, 'utf8');
  assert.ok(!onDisk.includes(FAKE.stripeLive), 'secret must not land on disk');
  assert.ok(onDisk.includes('[REDACTED:stripe_live_secret]'), 'secret redacted in log');

  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 3. Export path — DPO pairs
// ---------------------------------------------------------------------------

test('export: exportDpoFromMemories redacts a planted secret in pairs and jsonl', () => {
  const memories = [
    {
      id: 1,
      title: 'MISTAKE: leaked credential in fix',
      content: `Pasted the live key directly: ${FAKE.stripeLive}`,
      category: 'error',
      tags: ['verification', 'secrets'],
    },
    {
      id: 2,
      title: 'SUCCESS: never paste live keys',
      content: `Store keys in the vault, not inline like ${FAKE.awsAccessKey}`,
      category: 'learning',
      tags: ['verification', 'secrets'],
    },
  ];

  const result = exportDpoFromMemories(memories);
  assert.ok(result.pairs.length >= 1, 'at least one pair built');
  assert.ok(!result.jsonl.includes(FAKE.stripeLive), 'rejected content secret redacted');
  assert.ok(!result.jsonl.includes(FAKE.awsAccessKey), 'chosen content secret redacted');
  assert.ok(result.jsonl.includes('[REDACTED:'), 'redaction markers present in jsonl');

  const serializedPairs = JSON.stringify(result.pairs);
  assert.ok(!serializedPairs.includes(FAKE.stripeLive), 'returned pairs (consumed by HF) redacted');
});

// ---------------------------------------------------------------------------
// 4. Export path — Databricks bundle
// ---------------------------------------------------------------------------

test('export: exportDatabricksBundle redacts a planted secret in every bundle table row', () => {
  const feedbackDir = mkTmp('tg-redact-databricks-');
  const proofDir = mkTmp('tg-redact-proof-'); // empty → no repo proof scan
  const outputDir = mkTmp('tg-redact-bundle-');

  fs.writeFileSync(
    path.join(feedbackDir, 'feedback-log.jsonl'),
    JSON.stringify({ signal: 'negative', context: `agent pasted ${FAKE.stripeLive}` }) + '\n',
  );
  fs.writeFileSync(
    path.join(feedbackDir, 'memory-log.jsonl'),
    JSON.stringify({ category: 'error', content: `bad: ${FAKE.stripeWebhook}` }) + '\n',
  );

  const result = exportDatabricksBundle(feedbackDir, outputDir, { proofDir });
  const eventsTable = fs.readFileSync(path.join(outputDir, 'tables', 'feedback_events.jsonl'), 'utf8');
  const memoryTable = fs.readFileSync(path.join(outputDir, 'tables', 'memory_records.jsonl'), 'utf8');

  assert.ok(!eventsTable.includes(FAKE.stripeLive), 'feedback_events secret redacted');
  assert.ok(eventsTable.includes('[REDACTED:stripe_live_secret]'));
  assert.ok(!memoryTable.includes(FAKE.stripeWebhook), 'memory_records secret redacted');
  assert.ok(memoryTable.includes('[REDACTED:stripe_webhook_secret]'));
  assert.ok(result.totalRows >= 2);

  for (const dir of [feedbackDir, proofDir, outputDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Capital One Databolt / Gartner 2026 Shift-Left Source Tokenization
// ---------------------------------------------------------------------------

function isValidLuhn(digits) {
  const payload = digits.slice(0, -1);
  return computeLuhnCheckDigit(payload) === digits.slice(-1);
}

test('tokenizeFormatPreservingVaultless preserves card format, Luhn validity, idempotence, and secret referential integrity', () => {
  const salt = 'gartner-2026-databolt-source-fpt-key';
  const cardA = ['4111', '1111', '1111', '1111'].join('-');
  const secretA = ['sk_live_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3'].join('');
  const secretB = ['sk_live_', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7'].join('');
  const bearerSecret = ['Bearer ', 'opaque_bearer_cred_99887766'].join('');
  const kvAssign = ['client_secret=', 'super_confidential_value_12345'].join('');
  const pubAssign = 'publishable_key=pk_live_public_identifier_12345';

  const input = `Charge ${cardA} for maya@acme.io using ${secretA}, ${secretB}, ${bearerSecret}, ${kvAssign}, ${pubAssign}`;
  const first = tokenizeFormatPreservingVaultless(input, {
    salt,
    preserveSecretReferentialIntegrity: true,
  });
  const second = tokenizeFormatPreservingVaultless(input, {
    salt,
    preserveSecretReferentialIntegrity: true,
  });

  assert.equal(first, second, 'deterministic referential integrity');
  assert.equal(
    tokenizeFormatPreservingVaultless(first, { salt, preserveSecretReferentialIntegrity: true }),
    first,
    'idempotent on already-tokenized payload',
  );
  assert.ok(!first.includes(cardA));
  assert.ok(!first.includes('maya@acme.io'));
  assert.ok(!first.includes(secretA));
  assert.ok(!first.includes(secretB));
  assert.ok(first.includes(pubAssign), 'preserves public key assignment');

  const tokenCardMatch = first.match(/\b9999-\d{4}-\d{4}-\d{4}\b/);
  assert.ok(tokenCardMatch, 'preserves 4-4-4-4 hyphenated card layout');
  assert.equal(isValidLuhn(tokenCardMatch[0].replaceAll('-', '')), true, 'tokenized card is Luhn-valid');

  const secretTokens = [...first.matchAll(/\[FPT:stripe_live_secret#([0-9a-f]{8})\]/g)].map((m) => m[1]);
  assert.equal(secretTokens.length, 2);
  assert.notEqual(secretTokens[0], secretTokens[1], 'distinct secrets map to distinct tokens for join correlation');
  assert.match(first, /Bearer \[FPT:bearer_token#[0-9a-f]{8}\]/);
  assert.match(first, /client_secret=\[FPT:secret_assignment#[0-9a-f]{8}\]/);
  assert.equal(tokenizeFormatPreservingVaultless('', { salt }), '');
});

test('tokenizeDeepAtSource tokenizes nested payloads without mutating input and enforceZeroTrustDetokenizationGate writes audit trail', () => {
  const salt = 'gartner-2026-databolt-deep-source-key';
  const tmpAuditDir = mkTmp('tg-detok-audit-');
  const auditLogPath = path.join(tmpAuditDir, 'detok-audit.jsonl');
  try {
    const sourcePayload = {
      user: { email: 'cto@enterprise.io', ssn: '123-45-6789', phone: '415-890-1234' },
      events: ['login from cto@enterprise.io', 'clean note'],
      count: 2,
    };
    const result = tokenizeDeepAtSource(sourcePayload, { salt });
    assert.equal(result.referentialIntegrity, true);
    assert.equal(result.fieldsTokenized, 4);
    assert.equal(sourcePayload.user.email, 'cto@enterprise.io', 'caller input not mutated');
    assert.ok(result.data.events[0].includes(result.data.user.email), 'same email joins across nested fields');

    const emitted = [];
    const deniedField = enforceZeroTrustDetokenizationGate({
      authenticated: true,
      roleAuthorizedForPlaintext: true,
      explicitDetokenizePermission: true,
      crossesExternalNetwork: false,
      principalId: 'analyst-pod-1',
      requestedFields: ['email', 'ssn'],
      allowedFields: ['email'],
      auditLogPath,
      onAuditEvent: (entry) => emitted.push(entry),
    });
    assert.equal(deniedField.allowed, false);
    assert.equal(deniedField.viewMode, 'TOKENIZED_ONLY');
    assert.ok(deniedField.blockers.includes('unauthorized_field_detokenization:ssn'));
    assert.equal(emitted.length, 1);

    const allowedField = enforceZeroTrustDetokenizationGate({
      authenticated: true,
      roleAuthorizedForPlaintext: true,
      explicitDetokenizePermission: true,
      crossesExternalNetwork: false,
      principalId: 'custodian-1',
      requestedFields: ['email'],
      allowedFields: ['email'],
      auditLogPath,
    });
    assert.equal(allowedField.allowed, true);
    assert.equal(allowedField.viewMode, 'DETOKENIZED_PLAINTEXT');
    const unrestrictedFields = enforceZeroTrustDetokenizationGate({
      authenticated: true,
      roleAuthorizedForPlaintext: true,
      explicitDetokenizePermission: true,
      requestedFields: ['email'],
      allowedFields: null,
    });
    assert.equal(unrestrictedFields.allowed, true);

    const auditLines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(auditLines.length, 2);
    assert.equal(auditLines[0].principalId, 'analyst-pod-1');
    assert.equal(auditLines[1].allowed, true);
  } finally {
    fs.rmSync(tmpAuditDir, { recursive: true, force: true });
  }
});
