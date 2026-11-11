'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isTranscriptShaped,
  resolveProjectFromCwd,
  inferProjectFromLesson,
  isLessonRelevantForProject,
  normalizeProjectName,
  backfillLessonScopes,
} = require('../scripts/project-scope');
const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
const { captureFeedback } = require('../scripts/feedback-loop');
const { backfillMemoryLog } = require('../scripts/backfill-lesson-scopes');

function createTempFeedbackDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-scope-test-'));
  return dir;
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

test('inferProjectFromLesson recognizes distinct project signatures', () => {
  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: Created PR via bare ADO REST without workItemRefs/AB# — did not check epic context (DIST03-1755)',
    content: 'StockService epic work with OPDX dealer path',
  }), 'StockService');

  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: Dayglass daemon crashed',
    content: 'com.iganapolsky.dayglass-server port 3333 bound by screenpipe',
  }), 'Dayglass');

  assert.equal(inferProjectFromLesson({
    title: 'MISTAKE: PreToolUse hook blocked legitimate read',
    content: 'ThumbGate gate-check false positive on read tool call',
  }), 'ThumbGate');

  assert.equal(inferProjectFromLesson({
    title: 'RULE: Never kill processes you did not start',
    content: 'Processes belong to the sessions that launched them; never killall or pkill',
  }), 'global');
});

test('isLessonRelevantForProject excludes foreign project lessons and transcript junk', () => {
  const stockLesson = {
    title: 'StockService OPDX error',
    content: 'DIST03-1755 work items must be linked to ADO PR',
  };
  const dayglassLesson = {
    title: 'Dayglass hud layout',
    content: 'Screenpipe frame buffer timing on macOS',
  };
  const thumbgateLesson = {
    title: 'ThumbGate pretooluse check',
    content: 'Verify file exists before calling edit tool',
  };
  const globalLesson = {
    title: 'Never kill processes you did not start',
    content: 'Fail-closed process boundary across all repositories',
    shared: true,
  };
  const transcriptLesson = {
    title: 'It ignored instruction: <task-notification> <task-id>abc</task-id>',
    content: 'What went wrong: <output-file>/tmp/foo</output-file>',
  };

  // From a ThumbGate cwd
  assert.equal(isLessonRelevantForProject(stockLesson, 'ThumbGate'), false);
  assert.equal(isLessonRelevantForProject(dayglassLesson, 'ThumbGate'), false);
  assert.equal(isLessonRelevantForProject(transcriptLesson, 'ThumbGate'), false);
  assert.equal(isLessonRelevantForProject(thumbgateLesson, 'ThumbGate'), true);
  assert.equal(isLessonRelevantForProject(globalLesson, 'ThumbGate'), true);

  // From a StockService cwd
  assert.equal(isLessonRelevantForProject(stockLesson, 'StockService'), true);
  assert.equal(isLessonRelevantForProject(dayglassLesson, 'StockService'), false);
  assert.equal(isLessonRelevantForProject(thumbgateLesson, 'StockService'), false);
});

test('retrieveRelevantLessons with project scoping strictly filters out foreign project lessons and transcript noise', () => {
  const tempDir = createTempFeedbackDir();
  const memoryFile = path.join(tempDir, 'memory-log.jsonl');

  const corpus = [
    {
      id: 'mem_stock_1',
      title: 'MISTAKE: StockService ADO work items not linked on PR',
      content: 'What went wrong: Bare ADO REST call without workItemRefs on StockService DIST03-1755.\nHow to avoid: Always pass workItemRefs for StockService PRs.',
      category: 'error',
      tags: ['git-workflow', 'ado', 'stockservice'],
      scope: { projectId: 'StockService', entityId: 'test', processId: 'agent', sessionId: 's1' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_dayglass_1',
      title: 'MISTAKE: Dayglass daemon port 3333 collision',
      content: 'What went wrong: Port 3333 killed by agent; dayglass server died.\nHow to avoid: Never kill processes on port 3333 in Dayglass.',
      category: 'error',
      tags: ['git-workflow', 'dayglass', 'bash'],
      scope: { projectId: 'Dayglass', entityId: 'test', processId: 'agent', sessionId: 's2' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_transcript_junk',
      title: 'MISTAKE: It ignored a prior instruction: <task-notification> <task-id>bhtcgw8vh</task-id>...',
      content: 'What went wrong: <task-notification> <task-id>bhtcgw8vh</task-id> <tool-use-id>toolu_123</tool-use-id> <output-file>/tmp/foo</output-file>',
      whatWentWrong: 'It ignored a prior instruction: <task-notification>',
      category: 'error',
      tags: ['git-workflow', 'bash'],
      scope: { projectId: 'ThumbGate', entityId: 'test', processId: 'agent', sessionId: 's3' },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_thumbgate_1',
      title: 'MISTAKE: ThumbGate git commit without running changeset:check',
      content: 'What went wrong: Committed release files in ThumbGate without adding a changeset entry.\nHow to avoid: Always run npm run changeset:check before committing in ThumbGate.',
      category: 'error',
      tags: ['git-workflow', 'changeset', 'thumbgate'],
      scope: { projectId: 'ThumbGate', entityId: 'test', processId: 'agent', sessionId: 's4' },
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
  ];

  fs.writeFileSync(memoryFile, corpus.map((c) => JSON.stringify(c)).join('\n') + '\n');

  // Querying from ThumbGate project with an action matching the lesson topic
  const thumbgateResults = retrieveRelevantLessons('Bash', 'git commit without changeset', {
    feedbackDir: tempDir,
    project: 'ThumbGate',
  });

  const ids = thumbgateResults.map((r) => r.id);
  // ThumbGate and global lessons are retrievable
  assert.ok(ids.includes('mem_thumbgate_1'), 'ThumbGate lesson must be retrieved');
  // StockService and Dayglass lessons MUST NOT be returned in ThumbGate
  assert.ok(!ids.includes('mem_stock_1'), 'StockService lesson must be excluded in ThumbGate');
  assert.ok(!ids.includes('mem_dayglass_1'), 'Dayglass lesson must be excluded in ThumbGate');
  // Raw transcript junk must NEVER be returned
  assert.ok(!ids.includes('mem_transcript_junk'), 'Transcript junk must be dropped');
});

test('captureFeedback enriches fixed-schema scope and rejects transcript-shaped feedback', () => {
  const tempDir = createTempFeedbackDir();

  // Reject transcript junk
  const badResult = captureFeedback({
    signal: 'down',
    context: '<task-notification> <task-id>xyz</task-id> error occurred',
  }, { feedbackDir: tempDir });

  assert.equal(badResult.accepted, false);
  assert.match(badResult.reason, /transport transcript tokens/i);

  // Accept clean feedback and auto-populate scope
  const goodResult = captureFeedback({
    signal: 'down',
    context: 'ThumbGate pretooluse check false positive on read',
    whatWentWrong: 'Read tool call was misclassified as write',
    whatToChange: 'Distinguish read from write tools accurately',
    tags: ['testing', 'thumbgate'],
  }, { feedbackDir: tempDir, cwd: '/Users/test/workspace/ThumbGate' });

  assert.equal(goodResult.accepted, true);
  assert.ok(goodResult.feedbackEvent.scope);
  assert.equal(goodResult.feedbackEvent.scope.projectId, 'ThumbGate');
  assert.equal(goodResult.feedbackEvent.metadata.project, 'ThumbGate');
  assert.ok(goodResult.feedbackEvent.metadata.tool);
});

test('backfillMemoryLog infers project and demotes existing transcript-shaped lessons', () => {
  const tempDir = createTempFeedbackDir();
  const memoryFile = path.join(tempDir, 'memory-log.jsonl');

  const rawCorpus = [
    {
      id: 'm1',
      title: 'MISTAKE: Bare ADO REST call on StockService DIST03-1755',
      content: 'Created PR via bare ADO REST without workItemRefs for StockService',
      category: 'error',
      tags: ['ado', 'pr-linking'],
      timestamp: '2026-09-09T16:29:07.886Z',
    },
    {
      id: 'm2',
      title: 'MISTAKE: Dayglass screenpipe buffer crash',
      content: 'Dayglass server crashed on port 3333',
      category: 'error',
      tags: ['dayglass'],
      timestamp: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 'm3',
      title: 'MISTAKE: It ignored a prior instruction: <task-notification> <task-id>bhtcgw8vh</task-id>',
      content: 'What went wrong: <output-file>/tmp/foo</output-file>',
      category: 'error',
      tags: ['git-workflow'],
      timestamp: '2026-11-11T03:13:00.641Z',
    },
  ];

  fs.writeFileSync(memoryFile, rawCorpus.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const res = backfillMemoryLog(memoryFile);
  assert.equal(res.ok, true);
  assert.equal(res.demotedTranscripts, 1);
  assert.equal(res.projectCounts['StockService'], 1);
  assert.equal(res.projectCounts['Dayglass'], 1);

  const updated = fs.readFileSync(memoryFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const m1 = updated.find((r) => r.id === 'm1');
  assert.equal(m1.scope.projectId, 'StockService');
  assert.equal(m1.metadata.project, 'StockService');

  const m3 = updated.find((r) => r.id === 'm3');
  assert.equal(m3.demoted, true);
  assert.equal(m3.demoteReason, 'transcript_shaped_transport_blob');
});
