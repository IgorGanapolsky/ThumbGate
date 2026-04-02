const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PII_PATTERNS, SENSITIVITY_LEVELS,
  scanForPii, redactPii, classifyFeedback,
  scanDpoPair, gateDpoExport, sensitivityRank,
} = require('../scripts/pii-scanner');

// === Pattern Detection ===
test('PII_PATTERNS has email, phone, ssn, credit card, ip', () => {
  const ids = PII_PATTERNS.map((p) => p.id);
  assert.ok(ids.includes('email'));
  assert.ok(ids.includes('phone_us'));
  assert.ok(ids.includes('ssn'));
  assert.ok(ids.includes('credit_card'));
  assert.ok(ids.includes('ip_address'));
});

test('SENSITIVITY_LEVELS in correct order', () => {
  assert.deepEqual(SENSITIVITY_LEVELS, ['public', 'internal', 'sensitive', 'restricted']);
});

test('sensitivityRank orders correctly', () => {
  assert.ok(sensitivityRank('restricted') > sensitivityRank('sensitive'));
  assert.ok(sensitivityRank('sensitive') > sensitivityRank('internal'));
  assert.ok(sensitivityRank('internal') > sensitivityRank('public'));
});

// === scanForPii ===
test('scanForPii detects email', () => {
  const r = scanForPii('Contact john@example.com for details');
  assert.ok(r.hasPii);
  assert.equal(r.findings[0].id, 'email');
  assert.equal(r.highestSensitivity, 'sensitive');
});

test('scanForPii detects credit card', () => {
  const r = scanForPii('Card: 4111-1111-1111-1111');
  assert.ok(r.hasPii);
  assert.ok(r.findings.some((f) => f.id === 'credit_card'));
  assert.equal(r.highestSensitivity, 'restricted');
});

test('scanForPii detects SSN', () => {
  const r = scanForPii('SSN: 123-45-6789');
  assert.ok(r.hasPii);
  assert.equal(r.highestSensitivity, 'restricted');
});

test('scanForPii returns clean for safe text', () => {
  const r = scanForPii('Fixed the deploy script to check health endpoint');
  assert.equal(r.hasPii, false);
  assert.equal(r.highestSensitivity, 'public');
});

test('scanForPii handles empty/null', () => {
  assert.equal(scanForPii(null).hasPii, false);
  assert.equal(scanForPii('').hasPii, false);
});

test('scanForPii detects multiple PII types', () => {
  const r = scanForPii('Email john@test.com, card 4111111111111111, SSN 123-45-6789');
  assert.ok(r.findings.length >= 2);
  assert.equal(r.highestSensitivity, 'restricted');
});

// === redactPii ===
test('redactPii replaces email', () => {
  const r = redactPii('Contact john@example.com please');
  assert.ok(r.includes('[REDACTED:email]'));
  assert.ok(!r.includes('john@example.com'));
});

test('redactPii replaces credit card', () => {
  const r = redactPii('Pay with 4111-1111-1111-1111');
  assert.ok(r.includes('[REDACTED:credit_card]'));
});

test('redactPii also redacts secrets', () => {
  const r = redactPii('Key: sk-ant-abc123def456ghi789jkl012mno');
  assert.ok(r.includes('[REDACTED:'));
});

test('redactPii handles empty', () => {
  assert.equal(redactPii(''), '');
  assert.equal(redactPii(null), '');
});

// === classifyFeedback ===
test('classifyFeedback labels clean feedback as public', () => {
  const r = classifyFeedback({ context: 'Fixed the deploy bug', whatWorked: 'Health check passed' });
  assert.equal(r.sensitivity, 'public');
  assert.equal(r.hasPii, false);
});

test('classifyFeedback labels PII feedback as sensitive/restricted', () => {
  const r = classifyFeedback({ context: 'User john@test.com reported the bug', whatWentWrong: 'Card 4111111111111111 was charged twice' });
  assert.equal(r.hasPii, true);
  assert.equal(r.sensitivity, 'restricted');
  assert.ok(r.redactedContent.includes('[REDACTED:'));
  assert.ok(r.originalContentHash.length > 0);
});

// === scanDpoPair ===
test('scanDpoPair detects PII in chosen response', () => {
  const r = scanDpoPair({ prompt: 'Fix the bug', chosen: 'Email john@test.com', rejected: 'No fix' });
  assert.ok(r.hasPii);
  assert.equal(r.safe, false);
});

test('scanDpoPair passes clean pairs', () => {
  const r = scanDpoPair({ prompt: 'Fix deploy', chosen: 'Added health check', rejected: 'Skipped verification' });
  assert.equal(r.hasPii, false);
  assert.equal(r.safe, true);
});

// === gateDpoExport ===
test('gateDpoExport blocks pairs with PII', () => {
  const pairs = [
    { prompt: 'Fix bug', chosen: 'Done', rejected: 'Failed' },
    { prompt: 'Update', chosen: 'Contact john@evil.com', rejected: 'No' },
    { prompt: 'Deploy', chosen: 'Card 4111111111111111', rejected: 'Skip' },
  ];
  const r = gateDpoExport(pairs);
  assert.equal(r.totalScanned, 3);
  assert.equal(r.safePairs.length, 1);
  assert.equal(r.blockedCount, 2);
  assert.ok(r.passRate < 50);
});

test('gateDpoExport passes all clean pairs', () => {
  const pairs = [
    { prompt: 'Fix', chosen: 'Fixed deploy', rejected: 'Skipped tests' },
    { prompt: 'Add', chosen: 'Added gate', rejected: 'No gate' },
  ];
  const r = gateDpoExport(pairs);
  assert.equal(r.safePairs.length, 2);
  assert.equal(r.blockedCount, 0);
  assert.equal(r.passRate, 100);
});

test('gateDpoExport respects custom maxSensitivity', () => {
  const pairs = [{ prompt: 'Fix', chosen: 'IP is 192.168.1.1', rejected: 'No' }];
  const loose = gateDpoExport(pairs, { maxSensitivity: 'internal' });
  assert.equal(loose.safePairs.length, 1);
  const strict = gateDpoExport(pairs, { maxSensitivity: 'public' });
  assert.equal(strict.safePairs.length, 0);
});

test('gateDpoExport handles empty', () => {
  const r = gateDpoExport([]);
  assert.equal(r.totalScanned, 0);
  assert.equal(r.passRate, 100);
});
