'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { literalCommandPaths, pathCandidates } = require('../scripts/project-evidence');
const { buildProjectCatalog, readProjectRows, accountDirectories, readRows } = require('../scripts/project-catalog');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-catalog-'));
  fs.writeFileSync(path.join(root, 'feedback-log.jsonl'), [
    JSON.stringify({ id: 'a', timestamp: '2026-01-01T00:00:00Z', projectKey: 'alpha', projectName: 'alpha' }),
    JSON.stringify({ id: 'a', timestamp: '2026-01-01T00:00:00Z', projectKey: 'alpha', projectName: 'alpha' }),
    'not json',
    JSON.stringify({ id: 'b', timestamp: '2026-01-02T00:00:00Z', projectKey: 'beta', projectName: 'beta' }),
  ].join('\n') + '\n');
  return root;
}

test('literalCommandPaths extracts only literal absolute operands', () => {
  assert.deepEqual(literalCommandPaths('cd /work/repo && cat /work/repo/a.txt'), [
    { value: '/work/repo', kind: 'command_directory' },
    { value: '/work/repo/a.txt', kind: 'command_file' },
  ]);
  assert.deepEqual(literalCommandPaths('git -C /work/repo status'), [{ value: '/work/repo', kind: 'command_directory' }]);
  assert.deepEqual(literalCommandPaths('head -n 5 /work/a.txt'), [{ value: '/work/a.txt', kind: 'command_file' }]);
  for (const unsafe of ['cat $HOME/x', 'cat "/a/b', 'cat /a/b...', 'cat /a | wc', 'cat \\x', 'a & b', null]) {
    assert.deepEqual(literalCommandPaths(unsafe), [], String(unsafe));
  }
  assert.deepEqual(literalCommandPaths('cat -Z /a/b'), []);
});

test('pathCandidates collects directories, files and commands from a record', () => {
  const found = pathCandidates({ cwd: '/w', toolInput: { file_path: '/w/f.js', command: 'cd /w/sub' }, scope: { projectId: '/w/p' } });
  assert.deepEqual(found.map((item) => item.value).sort(), ['/w', '/w/f.js', '/w/p', '/w/sub']);
  const preset = [{ value: '/x', kind: 'file' }];
  assert.equal(pathCandidates({ pathCandidates: preset }), preset);
});

test('catalog groups rows per project and dedupes by id', () => {
  const root = fixture();
  try {
    const catalog = buildProjectCatalog(root);
    assert.equal(catalog.projects.length, 1);
    assert.equal(catalog.projects[0].projectKey, 'unassigned');
    assert.equal(catalog.projects[0].counts.feedback, 2);
    assert.equal(readProjectRows(root, 'feedback-log.jsonl', { projectKey: 'unassigned' }).length, 2);
    assert.equal(readProjectRows(root, 'feedback-log.jsonl', { dedupe: false }).length, 3);
    assert.equal(readProjectRows(root, 'feedback-log.jsonl', { projectKey: 'beta' }).length, 0);
    assert.equal(readRows(path.join(root, 'feedback-log.jsonl')).length, 3);
    assert.equal(accountDirectories(path.join(root, 'missing')).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('catalog refuses symlinked project directories', () => {
  const root = fixture();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-elsewhere-'));
  try {
    fs.symlinkSync(elsewhere, path.join(root, 'projects'));
    assert.throws(() => accountDirectories(root), /Symlink/);
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
