'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildReleaseNotes,
  extractChangelogEntry,
  formatReleaseNotes,
} = require('../scripts/release-notes');

const PROJECT_ROOT = path.join(__dirname, '..');

test('extractChangelogEntry returns the exact version section', () => {
  const entry = extractChangelogEntry([
    '# Changelog',
    '',
    '## 1.4.4',
    '',
    '### Patch Changes',
    '',
    '- Slim package boundary.',
    '',
    '## 1.4.3',
    '',
    '- Previous release.',
  ].join('\n'), '1.4.4');

  assert.match(entry, /## 1\.4\.4/);
  assert.match(entry, /Slim package boundary/);
  assert.doesNotMatch(entry, /Previous release/);
});

test('formatReleaseNotes includes full changeset summaries and verification links', () => {
  const markdown = formatReleaseNotes({
    version: '1.4.4',
    previousTag: 'v1.4.3',
    currentTag: 'v1.4.4',
    currentRef: 'abc123',
    githubRunUrl: 'https://github.com/IgorGanapolsky/ThumbGate/actions/runs/1',
    changesets: [{
      file: '.changeset/slim-npm-package-boundary.md',
      releaseType: 'patch',
      summary: 'Harden npm package boundaries so generated runtime state cannot leak into published tarballs.',
    }],
    changelogEntry: '## 1.4.4\n\n- Changelog copy.',
  });

  assert.match(markdown, /^# thumbgate@1\.4\.4/m);
  assert.match(markdown, /Full Changeset Release Notes/);
  assert.match(markdown, /slim-npm-package-boundary\.md/);
  assert.match(markdown, /generated runtime state cannot leak/);
  assert.match(markdown, /actions\/runs\/1/);
  assert.match(markdown, /CHANGELOG\.md Entry/);
  assert.match(markdown, /Changelog copy/);
});

test('buildReleaseNotes uses changed changeset files from the previous release tag', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-release-notes-'));
  fs.mkdirSync(path.join(tempDir, '.changeset'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ version: '1.4.4' }));
  fs.writeFileSync(path.join(tempDir, 'CHANGELOG.md'), '# Changelog\n');
  fs.writeFileSync(path.join(tempDir, '.changeset', 'slim-npm-package-boundary.md'), [
    '---',
    '"thumbgate": patch',
    '---',
    '',
    'Slim the npm package boundary and keep release emails traceable to full Changeset notes.',
  ].join('\n'));

  const runner = (command, args) => {
    assert.equal(command, 'git');
    if (args[0] === 'tag') return 'v1.4.4\nv1.4.3\n';
    if (args[0] === 'diff') return '.changeset/slim-npm-package-boundary.md\n';
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  try {
    const result = buildReleaseNotes({
      cwd: tempDir,
      currentRef: 'abc123',
      runner,
    });

    assert.equal(result.version, '1.4.4');
    assert.equal(result.previousTag, 'v1.4.3');
    assert.deepEqual(result.changedChangesetFiles, ['.changeset/slim-npm-package-boundary.md']);
    assert.match(result.markdown, /Slim the npm package boundary/);
    assert.match(result.markdown, /No `CHANGELOG\.md` section was found for 1\.4\.4/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('publish workflow writes full release notes instead of GitHub generated notes only', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-npm.yml'), 'utf8');

  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /Build full changeset release notes/);
  assert.match(workflow, /scripts\/release-notes\.js/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /gh release create "v\$\{VERSION\}" --title "thumbgate@\$\{VERSION\}" --notes-file "\$\{notes_file\}"/);
  assert.match(workflow, /gh release edit "v\$\{VERSION\}" --title "thumbgate@\$\{VERSION\}" --notes-file "\$\{notes_file\}"/);
  assert.match(workflow, /gh release upload "v\$\{VERSION\}" "\$\{notes_file\}" --clobber/);
  assert.doesNotMatch(workflow, /gh release create "v\$\{VERSION\}".*--generate-notes/);
});
