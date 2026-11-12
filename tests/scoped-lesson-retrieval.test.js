'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const {
  isTranscriptShaped,
  resolveProjectFromCwd,
  inferProjectFromLesson,
  isLessonRelevantForProject,
  normalizeProjectName,
  backfillLessonScopes,
  clearCwdCache,
} = require('../scripts/project-scope');
const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
const { captureFeedback } = require('../scripts/feedback-loop');
const { backfillMemoryLog } = require('../scripts/backfill-lesson-scopes');

function createTempFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-scope-test-'));
}

test('isTranscriptShaped flags XML task runner tokens', () => {
  assert.equal(isTranscriptShaped('<task-notification> <task-id>bhtcgw8vh</task-id>'), true);
  assert.equal(isTranscriptShaped('<tool-use-id>toolu_013MzqUa66F5eLHWC5WbBx7W</tool-use-id>'), true);
  assert.equal(isTranscriptShaped('<output-file>/private/tmp/claude</output-file>'), true);
  assert.equal(isTranscriptShaped({
    title: 'MISTAKE: It ignored a prior instruction: <task-notification> <task-id>bhtcgw8vh</task-id>',
    whatWentWrong: 'Follow the earlier instruction: <task-notification>',
  }), true);
  assert.equal(isTranscriptShaped({
    title: 'MISTAKE: Ordinary clean lesson',
    whatWentWrong: 'Did not check tests before pushing to main',
  }), false);
});

test('inferProjectFromLesson recognizes scope, metadata, tags, and global rules', () => {
  // 1. Explicit scope
  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: API gateway route mismatch',
    scope: { projectId: 'gateway-service' },
  }), 'gateway-service');

  // 2. Metadata repo tag
  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: Build failed on cache miss',
    metadata: { repo: 'frontend-web' },
  }), 'frontend-web');

  // 3. Tag-based project annotation
  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: Migration failed',
    tags: ['database', 'project:billing-engine'],
  }), 'billing-engine');

  // 4. Global safety rules
  assert.equal(inferProjectFromLesson({
    title: 'RULE: Never kill processes you did not start',
    content: 'Processes belong to the sessions that launched them; never killall or pkill',
  }), 'global');

  assert.equal(inferProjectFromLesson({
    title: 'RULE: branch protection on main',
    content: 'Never force-push or bypass rulesets',
    shared: true,
  }), 'global');

  // 5. Unknown/unscoped lesson returns null (no private hardcoded fallback)
  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: Generic error happened',
    content: 'Something went wrong during execution',
  }), null);
});

test('isLessonRelevantForProject excludes foreign project lessons, transcript junk, and unscoped lessons', () => {
  const repoALesson = {
    title: 'RepoA migration error',
    content: 'Check schema before running migration in repo-a',
    scope: { projectId: 'repo-a' },
  };
  const repoBLesson = {
    title: 'RepoB build failure',
    content: 'Vite config missing base path in repo-b',
    scope: { projectId: 'repo-b' },
  };
  const globalLesson = {
    title: 'Never kill processes you did not start',
    content: 'Fail-closed process boundary across all repositories',
    shared: true,
  };
  const transcriptLesson = {
    title: 'It ignored instruction: <task-notification> <task-id>abc</task-id>',
    content: 'What went wrong: <output-file>/tmp/foo</output-file>',
    scope: { projectId: 'repo-a' },
  };
  const unknownLesson = {
    title: 'Generic mistake with no scope',
    content: 'Failed to handle error',
  };

  // From repo-a:
  assert.equal(isLessonRelevantForProject(repoALesson, 'repo-a'), true);
  assert.equal(isLessonRelevantForProject(repoBLesson, 'repo-a'), false);
  assert.equal(isLessonRelevantForProject(transcriptLesson, 'repo-a'), false);
  assert.equal(isLessonRelevantForProject(globalLesson, 'repo-a'), true);
  // Unknown unscoped lessons are excluded from repo-a
  assert.equal(isLessonRelevantForProject(unknownLesson, 'repo-a'), false);

  // From repo-b:
  assert.equal(isLessonRelevantForProject(repoALesson, 'repo-b'), false);
  assert.equal(isLessonRelevantForProject(repoBLesson, 'repo-b'), true);
});

test('resolveProjectFromCwd caches per cwd and provides sub-millisecond warm lookups', () => {
  clearCwdCache();
  const testDir = path.resolve(__dirname, '..');

  // 1. Initial resolution
  const t0 = performance.now();
  const proj1 = resolveProjectFromCwd(testDir);
  const coldDuration = performance.now() - t0;

  assert.equal(proj1, 'thumbgate');

  // 2. Warm cached resolution
  const t1 = performance.now();
  for (let i = 0; i < 50; i++) {
    const proj2 = resolveProjectFromCwd(testDir);
    assert.equal(proj2, 'thumbgate');
  }
  const warmAverage = (performance.now() - t1) / 50;

  // Cached lookup should be well under 0.2ms
  assert.ok(warmAverage < 0.2, `Warm lookup too slow: ${warmAverage}ms`);
});

test('retrieveRelevantLessons with project scoping strictly filters out foreign project lessons and transcript noise', () => {
  const tempDir = createTempFeedbackDir();
  const memoryFile = path.join(tempDir, 'memory-log.jsonl');

  const corpus = [
    {
      id: 'mem_repo_b',
      title: 'MISTAKE: RepoB ADO work items not linked on PR',
      content: 'What went wrong: Bare ADO REST call without workItemRefs on RepoB.\nHow to avoid: Always pass workItemRefs for RepoB PRs.',
      category: 'error',
      tags: ['git-workflow', 'ado', 'repo-b'],
      scope: { projectId: 'repo-b', entityId: 'test', processId: 'agent', sessionId: 's1' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_transcript_junk',
      title: 'MISTAKE: It ignored a prior instruction: <task-notification> <task-id>bhtcgw8vh</task-id>...',
      content: 'What went wrong: <task-notification> <task-id>bhtcgw8vh</task-id> <tool-use-id>toolu_123</tool-use-id> <output-file>/tmp/foo</output-file>',
      whatWentWrong: 'It ignored a prior instruction: <task-notification>',
      category: 'error',
      tags: ['git-workflow', 'bash'],
      scope: { projectId: 'repo-a', entityId: 'test', processId: 'agent', sessionId: 's3' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_repo_a',
      title: 'MISTAKE: repo-a git commit without running changeset:check',
      content: 'What went wrong: Committed release files in repo-a without adding a changeset entry.\nHow to avoid: Always run npm run changeset:check before committing in repo-a.',
      category: 'error',
      tags: ['git-workflow', 'changeset', 'repo-a'],
      scope: { projectId: 'repo-a', entityId: 'test', processId: 'agent', sessionId: 's4' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_global_1',
      title: 'RULE: Never bypass branch protection on main',
      content: 'What went wrong: Attempted git push --force to main.\nHow to avoid: Never push directly to main; always use PRs.',
      category: 'error',
      tags: ['git-workflow', 'branch-protection'],
      shared: true,
      scope: { projectId: 'global', entityId: 'test', processId: 'agent', sessionId: 's5' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_unscoped',
      title: 'MISTAKE: Unscoped generic git commit error',
      content: 'Committed without running checks',
      category: 'error',
      tags: ['git-workflow'],
      timestamp: new Date().toISOString(),
    },
  ];

  fs.writeFileSync(memoryFile, corpus.map((c) => JSON.stringify(c)).join('\n') + '\n');

  // Querying from repo-a
  const repoAResults = retrieveRelevantLessons('Bash', 'git commit without changeset', {
    feedbackDir: tempDir,
    project: 'repo-a',
  });

  const ids = repoAResults.map((r) => r.id);
  // Matching repo-a lesson and global lesson are retrievable
  assert.ok(ids.includes('mem_repo_a'), 'repo-a lesson must be retrieved');
  // Foreign repo lesson (repo-b) must NOT be returned in repo-a
  assert.ok(!ids.includes('mem_repo_b'), 'repo-b lesson must be excluded in repo-a');
  // Raw transcript junk must NEVER be returned
  assert.ok(!ids.includes('mem_transcript_junk'), 'Transcript junk must be dropped');
  // Unscoped lesson must NOT be returned when querying a specific project
  assert.ok(!ids.includes('mem_unscoped'), 'Unscoped lesson must be dropped');
});

test('captureFeedback enriches fixed-schema scope without hardcoding private names', () => {
  const tempDir = createTempFeedbackDir();

  // Reject transcript junk
  const badResult = captureFeedback({
    signal: 'down',
    context: '<task-notification> <task-id>xyz</task-id> error occurred',
  }, { feedbackDir: tempDir });

  assert.equal(badResult.accepted, false);
  assert.match(badResult.reason, /transport transcript tokens/i);

  // Accept clean feedback and auto-populate scope from cwd without hardcoded usernames
  const currentRepoDir = path.resolve(__dirname, '..');
  const goodResult = captureFeedback({
    signal: 'down',
    context: 'Pretooluse check false positive on read',
    whatWentWrong: 'Read tool call was misclassified as write',
    whatToChange: 'Distinguish read from write tools accurately',
    tags: ['testing'],
  }, { feedbackDir: tempDir, cwd: currentRepoDir });

  assert.equal(goodResult.accepted, true);
  assert.ok(goodResult.feedbackEvent.scope);
  assert.equal(goodResult.feedbackEvent.scope.projectId, 'thumbgate');
  assert.equal(goodResult.feedbackEvent.metadata.project, 'thumbgate');
  // entityId must NOT be hardcoded to any personal username
  assert.notEqual(goodResult.feedbackEvent.scope.entityId, 'iganapolsky');
});

test('backfillMemoryLog demotes transcripts and leaves unknown lessons unscoped (null)', () => {
  const tempDir = createTempFeedbackDir();
  const memoryFile = path.join(tempDir, 'memory-log.jsonl');

  const rawCorpus = [
    {
      id: 'm1',
      title: 'MISTAKE: Explicitly scoped repo task',
      content: 'Task in service-api',
      scope: { projectId: 'service-api' },
      category: 'error',
      timestamp: '2026-09-09T16:29:07.886Z',
    },
    {
      id: 'm2',
      title: 'MISTAKE: Generic failure with no repo context',
      content: 'Something timed out',
      category: 'error',
      timestamp: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 'm3',
      title: 'MISTAKE: It ignored a prior instruction: <task-notification> <task-id>bhtcgw8vh</task-id>',
      content: 'What went wrong: <output-file>/tmp/foo</output-file>',
      category: 'error',
      timestamp: '2026-11-11T03:13:00.641Z',
    },
  ];

  fs.writeFileSync(memoryFile, rawCorpus.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const res = backfillMemoryLog(memoryFile);
  assert.equal(res.ok, true);
  assert.equal(res.demotedTranscripts, 1);
  assert.equal(res.projectCounts['service-api'], 1);
  assert.equal(res.projectCounts['unscoped'], 2);

  const updated = fs.readFileSync(memoryFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const m1 = updated.find((r) => r.id === 'm1');
  assert.equal(m1.scope.projectId, 'service-api');

  const m2 = updated.find((r) => r.id === 'm2');
  // Unknown lessons must remain null / unscoped — never defaulted to ThumbGate
  assert.equal(m2.scope.projectId, null);

  const m3 = updated.find((r) => r.id === 'm3');
  assert.equal(m3.demoted, true);
  assert.equal(m3.demoteReason, 'transcript_shaped_transport_blob');
});
