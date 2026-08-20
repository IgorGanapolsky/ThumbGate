const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  runInfoqDoctor,
  scanInfoqArticles,
  stageCommentDrafts,
  DEFAULT_TRACKED_ARTICLES,
  parseArgs,
  mainCli,
} = require('../scripts/infoq-engage.js');

test('runInfoqDoctor returns healthy engine status and topic support', () => {
  const doctor = runInfoqDoctor();
  assert.equal(doctor.status, 'HEALTHY');
  assert.ok(doctor.trackedArticlesCount >= 1);
  assert.ok(doctor.supportedTopics.includes('Agentic AI Architecture'));
});

test('scanInfoqArticles returns tracked articles list with Netflix OCI article', () => {
  const scan = scanInfoqArticles();
  assert.ok(scan.total >= 1);
  const netflixArticle = scan.articles.find((a) => a.slug === 'netflix-oci-agent');
  assert.ok(netflixArticle, 'Netflix OCI article should be present');
  assert.equal(netflixArticle.category, 'Agentic AI Architecture');
  assert.ok(netflixArticle.keyThemes.includes('Actor-Critic process audits'));
});

test('stageCommentDrafts creates clean markdown drafts in coordination/ready-to-post', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infoq-test-'));

  const staged = stageCommentDrafts(tempDir);
  assert.equal(staged.stagedCount, DEFAULT_TRACKED_ARTICLES.length);

  for (const item of staged.stagedFiles) {
    assert.ok(fs.existsSync(item.path), `Staged file should exist: ${item.path}`);
    const content = fs.readFileSync(item.path, 'utf8');
    assert.ok(content.includes('platform: infoq'));
    assert.ok(content.includes('Technical Engagement Draft'));
    assert.ok(content.includes('Actor-Critic') || content.includes('actor-critic'));
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('parseArgs parses CLI flags accurately', () => {
  const flags = parseArgs(['--doctor', '--json', '--scan', '--draft']);
  assert.equal(flags.doctor, true);
  assert.equal(flags.json, true);
  assert.equal(flags.scan, true);
  assert.equal(flags.draft, true);
});

test('mainCli executes all CLI modes cleanly', () => {
  const origStdoutWrite = process.stdout.write;
  let stdoutData = '';
  process.stdout.write = (chunk) => {
    stdoutData += chunk;
    return true;
  };

  try {
    assert.equal(mainCli(['--doctor']), 0);
    assert.ok(stdoutData.includes('InfoQ Community Engagement Engine'));

    stdoutData = '';
    assert.equal(mainCli(['--doctor', '--json']), 0);
    assert.ok(stdoutData.includes('"status": "HEALTHY"'));

    stdoutData = '';
    assert.equal(mainCli(['--scan']), 0);
    assert.ok(stdoutData.includes('Scanned'));

    stdoutData = '';
    assert.equal(mainCli(['--scan', '--json']), 0);
    assert.ok(stdoutData.includes('"total"'));

    stdoutData = '';
    assert.equal(mainCli(['--draft']), 0);
    assert.ok(stdoutData.includes('Staged'));

    stdoutData = '';
    assert.equal(mainCli(['--draft', '--json']), 0);
    assert.ok(stdoutData.includes('"stagedCount"'));

    stdoutData = '';
    assert.equal(mainCli([]), 0);
    assert.ok(stdoutData.includes('InfoQ Community Engagement Engine'));
  } finally {
    process.stdout.write = origStdoutWrite;
  }
});
