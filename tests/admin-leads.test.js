'use strict';

// Owner console Leads tab: emails captured by POST /v1/marketing/install-email, owner-only, newest first.

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectLeads, parseAdminRoute } = require('../scripts/owner-admin');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-leads-'));

test('leads lists captured emails newest first and keeps IP and user agent out', async () => {
  const dir = tmp();
  const rows = [
    { capturedAt: '2026-11-20T10:00:00.000Z', email: 'first@example.org', source: 'install_page', installId: 'i1', cliVersion: null, remoteAddr: '203.0.113.9', userAgent: 'Mozilla/5.0' },
    { capturedAt: '2026-11-25T10:00:00.000Z', email: ' Second@Example.org ', source: 'cli_subscribe', installId: null, cliVersion: '1.46.0', remoteAddr: '203.0.113.10', userAgent: 'node' },
    { capturedAt: '2026-11-26T10:00:00.000Z', email: 'second@example.org', source: 'install_page', installId: null, cliVersion: null },
  ];
  fs.writeFileSync(path.join(dir, 'marketing-install-emails.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\nnot json\n');
  const result = await collectLeads({ feedbackDir: dir });
  assert.equal(result.source, 'install_email_ledger');
  assert.equal(result.data.total, 3);
  assert.equal(result.data.uniqueEmails, 2, 'addresses are compared trimmed and lowercased');
  assert.equal(result.data.records[0].capturedAt, '2026-11-26T10:00:00.000Z', 'newest first');
  assert.equal(result.data.records[1].email, 'Second@Example.org');
  assert.equal(result.data.records[2].hasInstallId, true);
  assert.equal(result.data.malformedLines, 1);
  assert.deepEqual(result.warnings, ['malformed_lines']);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /203\.0\.113/, 'no IP address');
  assert.doesNotMatch(json, /Mozilla/, 'no user agent');
});

test('leads with no ledger yet is an empty ok result', async () => {
  const result = await collectLeads({ feedbackDir: tmp() });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.records, []);
  assert.equal(result.data.total, 0);
});

test('leads is a routable admin section that takes no query options', () => {
  assert.deepEqual(parseAdminRoute('/v1/admin/leads', new URLSearchParams()).section, 'leads');
  assert.throws(() => parseAdminRoute('/v1/admin/leads', new URLSearchParams('limit=5')), /invalid_query/);
});
