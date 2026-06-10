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
