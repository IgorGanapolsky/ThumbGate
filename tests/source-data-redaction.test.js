'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  redactSourceDataStable,
  redactSourceDataStableDeep,
} = require('../scripts/secret-redaction');
const { captureFeedback, readJSONL } = require('../scripts/feedback-loop');
const { initDB, upsertLesson, searchLessons } = require('../scripts/lesson-db');
const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
const { searchLessons: searchLessonsJsonl } = require('../scripts/lesson-search');
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-source-redact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('redactSourceDataStable replaces secrets, emails, phone numbers, and tokens with deterministic idempotent placeholders', () => {
  const salt = 'seeded-test-placeholder-salt-2026';
  const fakeSecret = ['sk', '-ant-', 'FakeSeededSecretValue0000001'].join('');
  const fakeToken = ['ghp', '_', 'FakeSeededGithubToken0000002'].join('');
  const fakeEmailA = 'Owner.Ops@Example-Corp.io';
  const fakeEmailB = 'owner.ops@example-corp.io';
  const fakePhoneA = '(415) 890-4321';
  const fakePhoneB = '+14158904321';

  const first = redactSourceDataStable(
    `Key ${fakeSecret}, token Bearer ${fakeToken}. Mail ${fakeEmailA}. Call ${fakePhoneA}.`,
    { salt },
  );
  const second = redactSourceDataStable(
    `Key ${fakeSecret}, token ${fakeToken}, mail ${fakeEmailB}, call ${fakePhoneB}`,
    { salt },
  );
  assert.doesNotMatch(first, /FakeSeeded|example-corp|890-4321/i);
  assert.match(first, /\[SECRET:[a-f0-9]{8}\]/);
  assert.match(first, /Bearer \[TOKEN:[a-f0-9]{8}\]/);
  assert.match(first, /\[EMAIL:[a-f0-9]{8}\]/);
  assert.match(first, /\[PHONE:[a-f0-9]{8}\]/);

  // Same underlying value produces the exact same placeholder across case/format variants.
  const extractTag = (s, prefix) => s.match(new RegExp(`\\[${prefix}:[a-f0-9]{8}\\]`))[0];
  assert.equal(extractTag(first, 'SECRET'), extractTag(second, 'SECRET'));
  assert.equal(extractTag(first, 'TOKEN'), extractTag(second, 'TOKEN'));
  assert.equal(extractTag(first, 'EMAIL'), extractTag(second, 'EMAIL'));
  assert.equal(extractTag(first, 'PHONE'), extractTag(second, 'PHONE'));

  // Idempotent: re-running does not double-hash placeholders.
  assert.equal(redactSourceDataStable(first, { salt }), first);
  assert.deepEqual(redactSourceDataStableDeep({ id: 'keep_id', msg: fakeEmailA }, { salt }), {
    id: 'keep_id',
    msg: extractTag(first, 'EMAIL'),
  });
  // False-positive immunity on stack frames, retina assets, semver/builds, and log metrics.
  const technical = 'Stack fn@feedback-loop.js:1305 asset logo@2x.png ver 1.124.305.1024 codes 400 401 5000 token internationalization';
  assert.equal(redactSourceDataStable(technical, { salt }), technical);
  // Cycle-safe + Date/RegExp-safe + retrievalMeta array preservation.
  const cyc = { when: new Date('2026-11-12T00:00:00Z'), re: /abc/, nested: { id: fakeEmailA } };
  cyc.self = cyc;
  const cleanCyc = redactSourceDataStableDeep(cyc, { salt });
  assert.equal(cleanCyc.self, cleanCyc);
  assert.ok(cleanCyc.when instanceof Date);
  assert.ok(cleanCyc.re instanceof RegExp);
  assert.equal(cleanCyc.nested.id, extractTag(first, 'EMAIL'));
  const arr = [fakeEmailA];
  Object.defineProperty(arr, 'retrievalMeta', { value: { strategy: 'pragmatic' }, enumerable: false });
  const cleanArr = redactSourceDataStableDeep(arr, { salt });
  assert.deepEqual(cleanArr.retrievalMeta, { strategy: 'pragmatic' });
});

test('captureFeedback, SQLite lesson-db, and lesson-retrieval scrub source data on store and retrieve while preserving placeholder matching', (t) => {
  const dir = makeTempDir(t);
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevFirewall = process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER;
  const prevSalt = process.env.THUMBGATE_PLACEHOLDER_SALT;
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  delete process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER;
  process.env.THUMBGATE_PLACEHOLDER_SALT = 'e2e-lesson-match-salt-2026';
  t.after(() => {
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    if (prevFirewall === undefined) delete process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER;
    else process.env.THUMBGATE_MEMORY_FIREWALL_PROVIDER = prevFirewall;
    if (prevSalt === undefined) delete process.env.THUMBGATE_PLACEHOLDER_SALT;
    else process.env.THUMBGATE_PLACEHOLDER_SALT = prevSalt;
  });

  const seededSecret = ['sk', '-proj-', 'FakeSeededOpenAiKey99999999'].join('');
  const seededToken = ['ghp', '_', 'FakeSeededTokenForDeploy888888'].join('');
  const seededEmail = 'deploy-bot@acme-internal.test';
  const seededPhone = '650-777-2345';

  const cap = captureFeedback({
    signal: 'down',
    context: `Bash curl leaked ${seededSecret} and ${seededToken} when notifying ${seededEmail} at ${seededPhone}`,
    whatWentWrong: `Sent raw credential ${seededSecret} and ${seededToken} to ${seededEmail} (${seededPhone})`,
    whatToChange: `Never inline ${seededSecret} or contact ${seededEmail} / ${seededPhone} in curl flags; read env at runtime`,
    tags: ['bash', 'curl', 'security'],
  }, { feedbackDir: dir });

  assert.equal(cap.accepted, true);
  assert.equal(cap.promoted, true);

  const feedbackRaw = fs.readFileSync(path.join(dir, 'feedback-log.jsonl'), 'utf8');
  const memoryRaw = fs.readFileSync(path.join(dir, 'memory-log.jsonl'), 'utf8');
  for (const rawBlob of [feedbackRaw, memoryRaw, JSON.stringify(cap)]) {
    assert.equal(rawBlob.includes(seededSecret), false);
    assert.equal(rawBlob.includes(seededToken), false);
    assert.equal(rawBlob.includes(seededEmail), false);
    assert.equal(rawBlob.includes(seededPhone), false);
    assert.match(rawBlob, /\[SECRET:[a-f0-9]{8}\]/);
    assert.match(rawBlob, /\[TOKEN:[a-f0-9]{8}\]/);
    assert.match(rawBlob, /\[EMAIL:[a-f0-9]{8}\]/);
    assert.match(rawBlob, /\[PHONE:[a-f0-9]{8}\]/);
  }

  // Retrieval with the SAME raw email/token still matches the redacted lesson via identical placeholder!
  const retrieved = retrieveRelevantLessons(
    'Bash',
    `curl -H "Authorization: Bearer ${seededToken}" https://api.internal/notify?to=${seededEmail}`,
    { feedbackDir: dir },
  );
  assert.ok(retrieved.length >= 1);
  assert.equal(JSON.stringify(retrieved).includes(seededToken), false);
  assert.equal(JSON.stringify(retrieved).includes(seededEmail), false);
  assert.match(retrieved[0].content, /\[EMAIL:[a-f0-9]{8}\]/);

  // SQLite lesson-db also scrubs on upsert + searchLessons, and matches raw query via placeholder.
  const dbPath = path.join(dir, 'test-lessons.db');
  const db = initDB(dbPath);
  t.after(() => db.close());
  upsertLesson(db, {
    id: 'fb_sql_1',
    signal: 'negative',
    context: `Webhook failed for ${seededEmail} phone ${seededPhone}`,
    whatWentWrong: `Exposed ${seededSecret}`,
    whatToChange: `Use vault ref instead of ${seededSecret} for ${seededEmail}`,
    tags: ['webhook'],
  }, null);

  const hits = searchLessons(db, seededEmail);
  assert.equal(hits.length, 1);
  assert.equal(JSON.stringify(hits).includes(seededEmail), false);
  assert.equal(JSON.stringify(hits).includes(seededSecret), false);
  assert.match(hits[0].context, /\[EMAIL:[a-f0-9]{8}\]/);

  // Legacy unredacted row in memory-log.jsonl is also scrubbed on retrieval before reaching caller.
  const legacyMem = readJSONL(path.join(dir, 'memory-log.jsonl'));
  legacyMem.push({
    id: 'mem_legacy_raw',
    type: 'mistake',
    signal: 'negative',
    title: `Legacy leak ${seededEmail}`,
    content: `Legacy row had ${seededPhone} and ${seededToken}`,
    tags: ['bash', 'legacy'],
    timestamp: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), legacyMem.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const legacyHits = retrieveRelevantLessons('Bash', `Legacy leak ${seededEmail}`, { feedbackDir: dir });
  const hit = legacyHits.find((h) => h.id === 'mem_legacy_raw');
  assert.ok(hit);
  assert.equal(JSON.stringify(hit).includes(seededEmail), false);
  assert.equal(JSON.stringify(hit).includes(seededPhone), false);
  assert.equal(JSON.stringify(hit).includes(seededToken), false);
  assert.ok(legacyHits.retrievalMeta);
  const jsonlSearch = searchLessonsJsonl(seededEmail, { feedbackDir: dir });
  assert.ok(jsonlSearch.results.length >= 1);
  assert.equal(JSON.stringify(jsonlSearch).includes(seededEmail), false);
  assert.equal(JSON.stringify(jsonlSearch).includes(seededPhone), false);
});
