'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execSync, execFileSync, execFile } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'bin', 'cli.js');
const {
  appendHostedAuditEvents,
  exportHostedLessonBundle,
  importHostedLessonsIntoFeedbackDir,
  mergeLessonsIntoHostedStore,
  readHostedAuditEvents,
} = require('../scripts/hosted-team-sync');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-team-sync-'));
}

function removeTmpDir(tmp) {
  fs.rmSync(tmp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

test('team-sync commits local prevention rules and pulls/pushes successfully', () => {
  const tmp = makeTmpDir();
  const remoteDir = path.join(tmp, 'remote.git');
  const clientDir = path.join(tmp, 'client');
  
  try {
    // 1. Setup local bare remote repo
    fs.mkdirSync(remoteDir, { recursive: true });
    execSync('git init --bare', { cwd: remoteDir, stdio: 'ignore' });
    
    // 2. Setup client repo
    fs.mkdirSync(clientDir, { recursive: true });
    execSync('git init', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config user.email "sync-test@example.com"', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config user.name "Sync Test"', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config commit.gpgsign false', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config core.hooksPath /dev/null', { cwd: clientDir, stdio: 'ignore' });
    
    // Create initial commit so we have a branch (main/master)
    fs.writeFileSync(path.join(clientDir, 'README.md'), '# Test Project');
    execSync('git add README.md', { cwd: clientDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: clientDir, stdio: 'ignore' });
    
    // Set origin to our bare repo
    execSync(`git remote add origin "${remoteDir}"`, { cwd: clientDir, stdio: 'ignore' });
    execSync('git push -u origin HEAD', { cwd: clientDir, stdio: 'ignore' });
    
    // 3. Create .thumbgate directory and local prevention rules
    const tgDir = path.join(clientDir, '.thumbgate');
    fs.mkdirSync(tgDir, { recursive: true });
    fs.writeFileSync(path.join(tgDir, 'prevention-rules.md'), '# Prevention Rules\n\n## Never drop production\n- Action: block\n- Pattern: DROP.*production\n');
    
    // Verify local changes are uncommitted
    const statusBefore = execSync('git status --porcelain', { cwd: clientDir, encoding: 'utf8' });
    assert.ok(statusBefore.includes('.thumbgate/'), 'should show .thumbgate/ as modified or untracked');
    
    // 4. Run npx thumbgate team-sync in the client repo
    const env = {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_NO_TELEMETRY: '1',
    };
    
    const output = execFileSync(process.execPath, [CLI_PATH, 'team-sync'], {
      cwd: clientDir,
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
    
    // Verify stdout tells us it committed, pulled and pushed
    assert.match(output, /Checking shared prevention rules status/);
    assert.match(output, /Local changes detected/);
    assert.match(output, /Local rules committed successfully/);
    assert.match(output, /Pulling rules/);
    assert.match(output, /Pushing rules/);
    assert.match(output, /Rebuilding local context brain/);
    assert.match(output, /Team rules synchronization complete/);
    
    // Verify prevention-rules.md is committed and clean (BRAIN.md may remain untracked)
    const statusAfter = execSync('git status --porcelain', { cwd: clientDir, encoding: 'utf8' }).trim();
    const cleanStatus = statusAfter
      .split('\n')
      .filter(line => line && !line.includes('BRAIN.md') && !line.includes('graphify-out/'))
      .join('\n')
      .trim();
    assert.equal(cleanStatus, '', 'Workspace should be clean (except for auto-generated BRAIN.md and graphify hook output) after team-sync');
    
    // Verify BRAIN.md was auto-built
    assert.ok(fs.existsSync(path.join(tgDir, 'BRAIN.md')), 'BRAIN.md should have been automatically rebuilt');
    
  } finally {
    removeTmpDir(tmp);
  }
});

test('hosted team sync store dedupes lessons and redacts key-like text', () => {
  const tmp = makeTmpDir();
  const fakeManualKey = 'tg_pro_redactabletestkey1234567890';

  try {
    const first = mergeLessonsIntoHostedStore('cus_hosted_team_sync', {
      source: { project: 'factory-agent' },
      lessons: [
        {
          id: 'lesson-1',
          signal: 'down',
          title: `Do not print ${fakeManualKey}`,
          context: `The agent exposed ${fakeManualKey} in a customer reply.`,
          whatToChange: `Replace ${fakeManualKey} with a redaction marker.`,
          structuredRule: { pattern: fakeManualKey },
        },
      ],
    }, { baseDir: tmp });

    const second = mergeLessonsIntoHostedStore('cus_hosted_team_sync', {
      lessons: [
        {
          id: 'lesson-1',
          signal: 'down',
          title: `Do not print ${fakeManualKey}`,
        },
      ],
    }, { baseDir: tmp });

    assert.equal(first.imported, 1);
    assert.equal(second.imported, 0);
    assert.equal(second.skippedDuplicate, 1);

    const bundle = exportHostedLessonBundle('cus_hosted_team_sync', { baseDir: tmp });
    const serialized = JSON.stringify(bundle);
    assert.equal(bundle.lessonCount, 1);
    assert.doesNotMatch(serialized, new RegExp(fakeManualKey));
    assert.match(serialized, /\[redacted:thumbgate-key\]/);
  } finally {
    removeTmpDir(tmp);
  }
});

test('hosted shared audit trail sanitizes tool input and aggregates decisions', () => {
  const tmp = makeTmpDir();
  const fakeGithubToken = 'ghp_abcdefghijklmnopqrstuvwxyz123456';

  try {
    const write = appendHostedAuditEvents('cus_hosted_audit', [
      {
        id: 'audit-1',
        timestamp: '2026-07-09T12:00:00.000Z',
        toolName: 'exec_command',
        toolInput: {
          command: `curl -H "Authorization: Bearer ${fakeGithubToken}" https://example.com`,
          content: 'private file contents',
        },
        decision: 'deny',
        gateId: 'secret-exposure',
        message: `Blocked ${fakeGithubToken}`,
        source: 'test',
      },
    ], { baseDir: tmp });

    assert.equal(write.accepted, 1);
    const audit = readHostedAuditEvents('cus_hosted_audit', { baseDir: tmp });
    const serialized = JSON.stringify(audit);
    assert.equal(audit.stats.total, 1);
    assert.equal(audit.stats.deny, 1);
    assert.equal(audit.stats.byGate['secret-exposure'].deny, 1);
    assert.doesNotMatch(serialized, new RegExp(fakeGithubToken));
    assert.match(serialized, /\[redacted:github-token\]/);
    assert.match(audit.events[0].toolInput.content, /^\[redacted:\d+ chars\]$/);
  } finally {
    removeTmpDir(tmp);
  }
});

test('hosted lesson imports write provenance and skip duplicates', () => {
  const tmp = makeTmpDir();

  try {
    const bundle = {
      source: { project: 'shared-team' },
      lessons: [
        {
          id: 'hosted_lesson_one',
          stableKey: 'id:lesson-one',
          signal: 'up',
          title: 'Good escalation pattern',
          context: 'Agent asked before risky deploy.',
          tags: ['deploy'],
        },
      ],
    };

    const first = importHostedLessonsIntoFeedbackDir(tmp, bundle);
    const second = importHostedLessonsIntoFeedbackDir(tmp, bundle);
    const imported = fs.readFileSync(path.join(tmp, 'feedback-log.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.equal(first.imported, 1);
    assert.equal(second.imported, 0);
    assert.equal(second.skippedDuplicate, 1);
    assert.equal(imported.length, 1);
    assert.ok(imported[0].tags.includes('hosted-team-import'));
    assert.equal(imported[0].provenance.hostedStableKey, 'id:lesson-one');
  } finally {
    removeTmpDir(tmp);
  }
});

test('team-sync --hosted pushes lessons and audit events then imports shared lessons', async () => {
  const tmp = makeTmpDir();
  const feedbackDir = path.join(tmp, 'feedback');
  const requests = [];
  let server;

  try {
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), `${JSON.stringify({
      id: 'local-feedback-1',
      signal: 'down',
      title: 'Local lesson to share',
      context: 'Agent should not skip customer-facing verification.',
      tags: ['verification'],
    })}\n`);
    fs.writeFileSync(path.join(feedbackDir, 'audit-trail.jsonl'), `${JSON.stringify({
      id: 'local-audit-1',
      timestamp: '2026-07-09T13:00:00.000Z',
      toolName: 'exec_command',
      toolInput: { command: 'npm test' },
      decision: 'allow',
      gateId: 'verification',
      message: 'Allowed test command',
      source: 'cli-test',
    })}\n`);

    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const body = bodyText ? JSON.parse(bodyText) : {};
        requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        res.setHeader('content-type', 'application/json');
        res.setHeader('connection', 'close');
        if (req.headers.authorization !== 'Bearer tg_hostedclitestkey1234567890') {
          res.statusCode = 401;
          res.end(JSON.stringify({ detail: 'unauthorized' }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/team/sync/push') {
          res.end(JSON.stringify({
            ok: true,
            imported: body.bundle.lessons.length,
            skippedDuplicate: 0,
            totalHostedLessons: body.bundle.lessons.length,
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/team/audit') {
          res.end(JSON.stringify({
            ok: true,
            accepted: body.events.length,
            skippedDuplicate: 0,
            received: body.events.length,
          }));
          return;
        }
        if (req.method === 'GET' && req.url.startsWith('/v1/team/sync/pull')) {
          res.end(JSON.stringify({
            ok: true,
            bundle: {
              lessonCount: 1,
              lessons: [{
                id: 'hosted-shared-lesson-1',
                stableKey: 'id:hosted-shared-lesson-1',
                signal: 'up',
                title: 'Shared lesson from teammate',
                context: 'Ask for evidence before claiming deployment success.',
                tags: ['shared'],
              }],
            },
          }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: 'not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const output = await new Promise((resolve, reject) => {
      execFile(process.execPath, [CLI_PATH, 'team-sync', '--hosted', '--json'], {
        cwd: tmp,
        env: {
          ...process.env,
          THUMBGATE_API_BASE_URL: `http://127.0.0.1:${port}`,
          THUMBGATE_API_KEY: 'tg_hostedclitestkey1234567890',
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
          THUMBGATE_NO_TELEMETRY: '1',
        },
        encoding: 'utf8',
        timeout: 15000,
      }, (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve(stdout);
      });
    });

    const body = JSON.parse(output);
    assert.equal(body.ok, true);
    assert.equal(body.pushedLessons.imported, 1);
    assert.equal(body.pushedAudit.accepted, 1);
    assert.equal(body.importedLessons.imported, 1);
    assert.ok(requests.some((request) => request.method === 'POST' && request.url === '/v1/team/sync/push'));
    assert.ok(requests.some((request) => request.method === 'POST' && request.url === '/v1/team/audit'));
    assert.ok(requests.some((request) => request.method === 'GET' && request.url.startsWith('/v1/team/sync/pull')));

    const imported = fs.readFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), 'utf8');
    assert.match(imported, /Shared lesson from teammate/);
    assert.match(imported, /hosted-team-import/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    removeTmpDir(tmp);
  }
});
