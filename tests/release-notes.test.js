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
  isSafeChangesetPath,
  parseArgs,
  resolveInside,
  runCli,
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

  const bracketedEntry = extractChangelogEntry('## [1.4.5]\n\n- Bracketed release.\n', '1.4.5');
  assert.match(bracketedEntry, /Bracketed release/);
});

test('extractChangelogEntry treats version input as a literal heading value', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 1.4.4|1.4.3',
    '',
    '- Literal version text.',
    '',
    '## 1.4.3',
    '',
    '- Previous release.',
  ].join('\n');

  const entry = extractChangelogEntry(changelog, '1.4.4|1.4.3');

  assert.match(entry, /Literal version text/);
  assert.doesNotMatch(entry, /Previous release/);
  assert.equal(extractChangelogEntry(changelog, '1.4.4.*'), '');
});

test('release note file paths stay inside the expected project boundaries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-release-notes-paths-'));

  try {
    assert.equal(isSafeChangesetPath('.changeset/release-notes-email.md'), true);
    assert.equal(isSafeChangesetPath('.changeset/../release-notes-email.md'), false);
    assert.equal(isSafeChangesetPath('scripts/release-notes-email.md'), false);
    assert.throws(
      () => resolveInside(tempDir, '../outside.md', 'output path'),
      /output path must stay inside/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('parseArgs accepts npm publish receipt metadata flags', () => {
  const options = parseArgs([
    '--version=1.4.6',
    '--npm-shasum=118f7abfbaba942195bc2d62219a9fd28cd52ffd',
    '--npm-tarball-url=https://registry.npmjs.org/thumbgate/-/thumbgate-1.4.6.tgz',
    '--npm-published-at=2026-04-14T16:20:49.754Z',
  ]);

  assert.equal(options.version, '1.4.6');
  assert.equal(options.npmShasum, '118f7abfbaba942195bc2d62219a9fd28cd52ffd');
  assert.equal(options.npmTarballUrl, 'https://registry.npmjs.org/thumbgate/-/thumbgate-1.4.6.tgz');
  assert.equal(options.npmPublishedAt, '2026-04-14T16:20:49.754Z');
});

test('formatReleaseNotes includes full changeset summaries and verification links', () => {
  const markdown = formatReleaseNotes({
    version: '1.4.4',
    previousTag: 'v1.4.3',
    currentTag: 'v1.4.4',
    currentRef: 'abc123',
    githubRunUrl: 'https://github.com/IgorGanapolsky/ThumbGate/actions/runs/1',
    npmShasum: '118f7abfbaba942195bc2d62219a9fd28cd52ffd',
    npmTarballUrl: 'https://registry.npmjs.org/thumbgate/-/thumbgate-1.4.4.tgz',
    npmPublishedAt: '2026-04-14T16:20:49.754Z',
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
  assert.match(markdown, /npm Email Companion/);
  assert.match(markdown, /Successfully published/);
  assert.match(markdown, /118f7abfbaba942195bc2d62219a9fd28cd52ffd/);
  assert.match(markdown, /thumbgate-1\.4\.4\.tgz/);
  assert.match(markdown, /2026-04-14T16:20:49\.754Z/);
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
      npmShasum: '118f7abfbaba942195bc2d62219a9fd28cd52ffd',
      npmTarballUrl: 'https://registry.npmjs.org/thumbgate/-/thumbgate-1.4.4.tgz',
      npmPublishedAt: '2026-04-14T16:20:49.754Z',
      runner,
    });

    assert.equal(result.version, '1.4.4');
    assert.equal(result.previousTag, 'v1.4.3');
    assert.deepEqual(result.changedChangesetFiles, ['.changeset/slim-npm-package-boundary.md']);
    assert.match(result.markdown, /Slim the npm package boundary/);
    assert.match(result.markdown, /118f7abfbaba942195bc2d62219a9fd28cd52ffd/);
    assert.match(result.markdown, /thumbgate-1\.4\.4\.tgz/);
    assert.match(result.markdown, /2026-04-14T16:20:49\.754Z/);
    assert.match(result.markdown, /No `CHANGELOG\.md` section was found for 1\.4\.4/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCli writes npm email companion notes from environment metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-release-notes-cli-'));
  fs.mkdirSync(path.join(tempDir, '.changeset'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ version: '1.4.6' }));
  fs.writeFileSync(path.join(tempDir, 'CHANGELOG.md'), '# Changelog\n');
  fs.writeFileSync(path.join(tempDir, '.changeset', 'release-email-companion.md'), [
    '---',
    '"thumbgate": patch',
    '---',
    '',
    'Publish full release notes beside npm email receipts.',
  ].join('\n'));

  const runner = (command, args) => {
    assert.equal(command, 'git');
    if (args[0] === 'tag') return 'v1.4.6\nv1.4.5\n';
    if (args[0] === 'diff') return '.changeset/release-email-companion.md\n';
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    process.stdout.write = (chunk, encoding, callback) => {
      stdout += String(chunk);
      if (typeof callback === 'function') callback();
      return true;
    };
    const result = runCli({
      argv: ['--output=release-notes.md'],
      cwd: tempDir,
      env: {
        VERSION: '1.4.6',
        GITHUB_SHA: 'abc123',
        GITHUB_RUN_URL: 'https://github.com/IgorGanapolsky/ThumbGate/actions/runs/24410268228',
        NPM_SHASUM: '118f7abfbaba942195bc2d62219a9fd28cd52ffd',
        NPM_TARBALL_URL: 'https://registry.npmjs.org/thumbgate/-/thumbgate-1.4.6.tgz',
        NPM_PUBLISHED_AT: '2026-04-14T16:20:49.754Z',
      },
      runner,
    });
    const written = fs.readFileSync(path.join(tempDir, 'release-notes.md'), 'utf8');

    assert.match(result.markdown, /npm Email Companion/);
    assert.equal(stdout, result.markdown);
    assert.match(written, /Publish full release notes beside npm email receipts/);
    assert.match(written, /actions\/runs\/24410268228/);
    assert.match(written, /118f7abfbaba942195bc2d62219a9fd28cd52ffd/);
    assert.match(written, /thumbgate-1\.4\.6\.tgz/);
  } finally {
    process.stdout.write = originalWrite;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('publish workflow writes full release notes instead of GitHub generated notes only', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-npm.yml'), 'utf8');

  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /Build full changeset release notes/);
  assert.match(workflow, /scripts\/release-notes\.js/);
  assert.match(workflow, /Resolve npm publish receipt/);
  assert.match(workflow, /npm'\s*,\s*\[\s*'view'/);
  assert.match(workflow, /--npm-shasum="\$\{NPM_SHASUM\}"/);
  assert.match(workflow, /--npm-tarball-url="\$\{NPM_TARBALL_URL\}"/);
  assert.match(workflow, /--npm-published-at="\$\{NPM_PUBLISHED_AT\}"/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /Upload full release notes artifact/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /gh release create "v\$\{VERSION\}" --title "thumbgate@\$\{VERSION\}" --notes-file "\$\{notes_file\}"/);
  assert.match(workflow, /gh release edit "v\$\{VERSION\}" --title "thumbgate@\$\{VERSION\}" --notes-file "\$\{notes_file\}"/);
  assert.match(workflow, /gh release upload "v\$\{VERSION\}" "\$\{notes_file\}" --clobber/);
  assert.doesNotMatch(workflow, /gh release create "v\$\{VERSION\}".*--generate-notes/);
});
