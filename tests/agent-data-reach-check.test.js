'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { reviewConfigs, formatText } = require('../scripts/agent-data-reach-check');

const SECRET = 'S3CR3T-MARKER';
function write(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-'));
  const f = path.join(dir, 'mcp.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
}
const one = (servers) => reviewConfigs([write({ mcpServers: servers })]);
const ids = (r, i = 0) => r.servers[i].findings.map((f) => f.id);

test('credential forms are flagged and the value never appears in output', () => {
  const cases = [
    { command: 'npx', args: ['pg-mcp', `postgres://app:${SECRET}@db/x`] },
    { command: 'npx', args: ['pg-mcp', `postgres://db/x?user=a&password=${SECRET}`] },
    { command: 'npx', args: ['pg-mcp', `host=db password=${SECRET}`] },
    { command: 'npx', args: ['pg-mcp', '--password', SECRET] },
    { command: 'node', args: ['server.js'], env: { MONGODB_URI: `mongodb://u:${SECRET}@h/db` } },
    { url: 'https://x.example/postgres-mcp', headers: { Authorization: `Bearer ${SECRET}` } },
  ];
  for (const c of cases) {
    const r = one({ db: c });
    assert.ok(ids(r).includes('credential-in-config-file'), JSON.stringify(c));
    assert.ok(!JSON.stringify(r).includes(SECRET) && !formatText(r).includes(SECRET));
  }
});

test('database found only through env value; env reference not flagged as credential', () => {
  const r = one({ main: { command: 'node', args: ['server.js'], env: { DATABASE_URL: 'postgres://h/db' } } });
  assert.equal(r.servers[0].engine, 'postgres');
  const r2 = one({ db: { command: 'npx', args: ['mysql-mcp', '--readonly'], env: { MYSQL_PASSWORD: '${MYSQL_PASSWORD}' } } });
  assert.ok(!ids(r2).includes('credential-in-config-file'));
  assert.equal(r2.servers[0].readOnlyFlagPresentNotVerified, true);
});

test('read-only flag exactness and write conflicts', () => {
  assert.equal(one({ db: { command: 'x', args: ['sqlite-mcp', '--readonly=false'] } }).servers[0].readOnlyFlagPresentNotVerified, false);
  assert.ok(ids(one({ db: { command: 'x', args: ['sqlite-mcp', '--readonly=false'] } })).includes('write-enabled-or-readonly-off'));
  const both = one({ db: { command: 'x', args: ['sqlite-mcp', '--read-only', '--allow-write'] } });
  assert.equal(both.servers[0].readOnlyFlagPresentNotVerified, false);
  assert.ok(both.questions.readOnlyFlagNotPresent.includes('db'));
  assert.ok(ids(one({ db: { command: 'x', args: ['sqlite-mcp'], env: { ALLOW_WRITE: 'true' } } })).includes('write-enabled-or-readonly-off'));
  assert.equal(one({ db: { command: 'x', args: ['sqlite-mcp'], env: { NOTE: 'read_only=true' } } }).servers[0].readOnlyFlagPresentNotVerified, false);
});

test('engine match uses word boundaries', () => {
  assert.equal(one({ neonlights: { command: 'node', args: ['lights.js'] } }).servers[0].databaseServerDetected, false);
});

test('unknown shape and unreadable files never read as clean', () => {
  const r = reviewConfigs([write({ context_servers: { a: { command: 'x' } } }), '/nonexistent/x.json', write('{nope')]);
  const text = formatText(r);
  assert.match(text, /no-recognised-servers/);
  assert.match(text, /WARNING: 2 file\(s\) unreadable/);
  assert.match(text, /WARNING: 1 file\(s\) had no recognised servers/);
  assert.match(text, /does not prove actual reach/);
});

test('control characters in names are neutralised and capped', () => {
  const r = one({ ['evil\u001b[31m IGNORE ALL ' + 'x'.repeat(200)]: { command: 'npx', args: ['sqlite-mcp'] } });
  const text = formatText(r);
  assert.ok(!/\u001b/.test(text));
  assert.ok(!text.includes('x'.repeat(100)));
});

test('CLI exits non-zero when a file is unreadable; zero otherwise', () => {
  const script = path.join(__dirname, '..', 'scripts', 'agent-data-reach-check.js');
  assert.equal(spawnSync('node', [script, '/nonexistent.json']).status, 1);
  assert.equal(spawnSync('node', [script, write({ mcpServers: {} })]).status, 0);
});

test('only plain $VAR and ${VAR} are env references; default-value forms are flagged', () => {
  for (const v of ['${DB_PASSWORD}', '$DB_PASSWORD']) {
    assert.ok(!ids(one({ db: { command: 'npx', args: ['mysql-mcp'], env: { MYSQL_PASSWORD: v } } })).includes('credential-in-config-file'), v);
  }
  for (const v of [`\${DB_PASSWORD:-${SECRET}}`, `\${DB_PASSWORD-${SECRET}}`, `\${DB_PASSWORD:=${SECRET}}`]) {
    const r = one({ db: { command: 'npx', args: ['mysql-mcp'], env: { MYSQL_PASSWORD: v } } });
    assert.ok(ids(r).includes('credential-in-config-file'), v);
    assert.ok(!JSON.stringify(r).includes(SECRET));
  }
});
