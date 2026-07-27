'use strict';

// The 2026-07-26 incident: ~/.thumbgate went from ~50 files to 4. The lessons database,
// feedback log, gate stats, governance state and audit trail were lost and NOT recoverable —
// no .bak files, Time Machine denied. Nothing alerted.
//
// That corpus is the entire value of a self-improving firewall. These tests exist so the
// backup cannot silently become a no-op, which would reproduce the incident while looking
// protected.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backupModule = require('../scripts/state-backup.js');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-state-'));
  fs.writeFileSync(path.join(home, 'gate-stats.json'), JSON.stringify({ blocked: 8892, warned: 3690 }));
  fs.writeFileSync(path.join(home, 'lessons-index.jsonl'), '{"lesson":"one"}\n');
  fs.writeFileSync(path.join(home, 'lessons.sqlite'), 'sqlite-bytes');
  fs.writeFileSync(path.join(home, 'audit-trail.jsonl'), '{"audit":"entry"}\n');
  // Reinstallable / bulky — must NOT be copied.
  fs.mkdirSync(path.join(home, 'runtime', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(home, 'runtime', 'node_modules', 'big.js'), 'x'.repeat(1024));
  return home;
}

function withEnv(home, fn) {
  const prevHome = process.env.THUMBGATE_HOME;
  const prevDir = process.env.THUMBGATE_BACKUP_DIR;
  process.env.THUMBGATE_HOME = home;
  process.env.THUMBGATE_BACKUP_DIR = path.join(home, 'backups');
  // The module reads env at require time, so drive it in a child-free way by re-requiring.
  delete require.cache[require.resolve('../scripts/state-backup.js')];
  const mod = require('../scripts/state-backup.js');
  try {
    return fn(mod);
  } finally {
    if (prevHome === undefined) delete process.env.THUMBGATE_HOME; else process.env.THUMBGATE_HOME = prevHome;
    if (prevDir === undefined) delete process.env.THUMBGATE_BACKUP_DIR; else process.env.THUMBGATE_BACKUP_DIR = prevDir;
    delete require.cache[require.resolve('../scripts/state-backup.js')];
  }
}

test('verify fails loudly when no snapshot exists', () => {
  const home = makeHome();
  withEnv(home, (mod) => {
    assert.equal(mod.verify(Date.now()), 1, 'no snapshots must be a non-zero exit, not a silent pass');
  });
});

test('a snapshot captures the irreplaceable state', () => {
  const home = makeHome();
  withEnv(home, (mod) => {
    assert.equal(mod.backup(Date.now()), 0);
    const snaps = mod.listSnapshots();
    assert.equal(snaps.length, 1);
    const files = fs.readdirSync(path.join(home, 'backups', snaps[0]));
    for (const expected of ['gate-stats.json', 'lessons.sqlite', 'lessons-index.jsonl', 'audit-trail.jsonl']) {
      assert.ok(files.includes(expected), `${expected} must be backed up`);
    }
  });
});

test('a snapshot does not copy the reinstallable runtime', () => {
  const home = makeHome();
  withEnv(home, (mod) => {
    mod.backup(Date.now());
    const snap = mod.listSnapshots()[0];
    const files = fs.readdirSync(path.join(home, 'backups', snap));
    assert.ok(!files.includes('runtime'), 'runtime/ is reinstallable from npm and must not bloat snapshots');
  });
});

test('restore recovers state after a total wipe — the 2026-07-26 shape', () => {
  const home = makeHome();
  withEnv(home, (mod) => {
    mod.backup(Date.now());
    const snap = mod.listSnapshots()[0];

    // Reproduce the incident.
    for (const name of ['gate-stats.json', 'lessons.sqlite', 'lessons-index.jsonl', 'audit-trail.jsonl']) {
      fs.rmSync(path.join(home, name), { force: true });
      assert.ok(!fs.existsSync(path.join(home, name)));
    }

    assert.equal(mod.restore(snap), 0);
    const recovered = JSON.parse(fs.readFileSync(path.join(home, 'gate-stats.json'), 'utf8'));
    assert.equal(recovered.blocked, 8892, 'content must round-trip, not just the filename');
    assert.equal(fs.readFileSync(path.join(home, 'lessons.sqlite'), 'utf8'), 'sqlite-bytes');
  });
});

test('an empty snapshot is refused rather than recorded', () => {
  // A snapshot holding nothing looks like protection and provides none — the same
  // "absence read as success" failure that caused the incidents it guards against.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-state-empty-'));
  withEnv(home, (mod) => {
    assert.equal(mod.backup(Date.now()), 2, 'backing up nothing must be an error');
    assert.equal(mod.listSnapshots().length, 0, 'no empty snapshot directory may be left behind');
  });
});

test('verify treats a stale snapshot as a failure', () => {
  const home = makeHome();
  withEnv(home, (mod) => {
    mod.backup(Date.now());
    // Look at it from far in the future: the snapshot is now stale.
    const muchLater = Date.now() + 1000 * 60 * 60 * 24 * 30;
    assert.equal(mod.verify(muchLater), 1, 'a month-old snapshot must not report OK');
  });
});
