'use strict';

// AGENT-3667, 24 Nov 2026 (faults brief, item D): the status line shows repeat misses per 100 injections.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { computeLessonEffect, specificTags } = require('../scripts/lesson-effect');

const T0 = Date.parse('2026-11-24T10:00:00Z');
const inj = (minutes, tags) => ({ at: T0 + minutes * 60000, sessionId: 's', lessonId: 'mem_1', tags: specificTags(tags) });

test('a later thumbs-down that shares a specific tag is a repeat miss; generic tags never match', () => {
  const effect = computeLessonEffect(
    [inj(0, ['dotloop', 'thumbs-down']), inj(1, ['dotloop']), inj(2, ['railway']), inj(3, ['thumbs-down'])],
    [{ at: T0 + 30 * 60000, tags: ['dotloop', 'user-prompt-thumbs', 'thumbs-down'] }],
  );
  assert.deepEqual(effect, { injections: 4, repeatMisses: 2, repeatMissesPer100: 50 });
});

test('a thumbs-down before the injection does not count, and no injections gives no number', () => {
  assert.equal(computeLessonEffect([inj(10, ['dotloop'])], [{ at: T0, tags: ['dotloop'] }]).repeatMisses, 0);
  assert.equal(computeLessonEffect([], [{ at: T0, tags: ['dotloop'] }]).repeatMissesPer100, null);
});

test('the real status line prints the number from the counter output', () => {
  const json = JSON.stringify({ up: 3, down: 2, label: 'this project', lessonEffect: { injections: 8, repeatMisses: 1, repeatMissesPer100: 12.5 } });
  const out = execFileSync('bash', [path.join(__dirname, '..', 'scripts', 'statusline.sh')], {
    input: '{}', encoding: 'utf8', env: { ...process.env, _TEST_THUMBGATE_STATUSLINE_HUMAN_JSON: json, NO_COLOR: '1' },
  });
  assert.match(out, /12\.5 repeat misses\/100 injections \(8\)/);
});

test('readInjections reads the injection log file and the number follows from it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-effect-'));
  try {
    const env = { ...process.env, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_RATE_LIMIT: '1', PWD: dir };
    const log = [
      { injectedAt: new Date(T0).toISOString(), sessionId: 'a', lessonId: 'mem_x', tags: ['dotloop'] },
      { injectedAt: new Date(T0 + 1000).toISOString(), sessionId: 'a', lessonId: 'mem_y', tags: ['railway'] },
    ];
    fs.writeFileSync(path.join(dir, 'lesson-injections.jsonl'), `${log.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const { readInjections } = require('../scripts/lesson-effect');
    const rows = readInjections([dir]);
    assert.equal(rows.length, 2);
    assert.deepEqual(computeLessonEffect(rows, [{ at: T0 + 5000, tags: ['dotloop'] }]), { injections: 2, repeatMisses: 1, repeatMissesPer100: 50 });
    assert.ok(env.THUMBGATE_FEEDBACK_DIR);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
