'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ARTICLE_TOPICS,
  CONVERSATIONAL_AI_WEEKLY_URL,
  buildEngagementQueue,
  buildMediumDraft,
  renderDraftMarkdown,
  renderQueueCsv,
  topicForDate,
  writeMediumWeeklyDraft,
} = require('../scripts/medium-weekly');

test('Medium weekly topics include active enforcement and agency-adjacent positioning', () => {
  const slugs = ARTICLE_TOPICS.map((topic) => topic.slug);
  assert.ok(slugs.includes('from-passive-observability-to-active-enforcement'));
  assert.ok(slugs.includes('safe-agent-execution-for-ai-automation-agencies'));
});

test('topicForDate rotates weekly from the May 2026 launch week', () => {
  const first = topicForDate(new Date('2026-05-04T12:00:00Z'));
  const second = topicForDate(new Date('2026-05-11T12:00:00Z'));
  assert.notEqual(first.slug, second.slug);
});

test('buildMediumDraft creates a manual-publish article with tracked CTAs', () => {
  const draft = buildMediumDraft({
    date: new Date('2026-05-04T12:00:00Z'),
    topic: ARTICLE_TOPICS[0],
  });

  assert.equal(draft.platform, 'medium');
  assert.equal(draft.status, 'draft_ready_manual_publish_required');
  assert.equal(draft.publicationUrl, CONVERSATIONAL_AI_WEEKLY_URL);
  assert.match(draft.body, /passive observability becomes active enforcement/i);
  assert.match(draft.body, /utm_source=medium/);
  assert.match(draft.body, /Workflow Hardening Sprint intake/);
  assert.ok(draft.publishChecklist.some((item) => /publish|Medium/i.test(item)));
});

test('engagement queue targets Conversational AI Weekly without generic pitch spam', () => {
  const rows = buildEngagementQueue({
    date: new Date('2026-05-04T12:00:00Z'),
    topic: ARTICLE_TOPICS[0],
  });

  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.target === CONVERSATIONAL_AI_WEEKLY_URL));
  assert.match(rows[0].draft, /observability and enforcement/i);
  assert.doesNotMatch(rows[0].draft, /npx thumbgate init/i);
});

test('renderers emit markdown and CSV artifacts for operator use', () => {
  const draft = buildMediumDraft({
    date: new Date('2026-05-04T12:00:00Z'),
    topic: ARTICLE_TOPICS[0],
  });
  const markdown = renderDraftMarkdown(draft);
  const csv = renderQueueCsv(buildEngagementQueue({ topic: ARTICLE_TOPICS[0] }));

  assert.match(markdown, /^---\nplatform: medium/m);
  assert.match(markdown, /Manual publish checklist/);
  assert.match(csv, /^channel,target,priority,reason,prompt,draft/);
  assert.match(csv, /medium_comment/);
});

test('writeMediumWeeklyDraft writes draft and engagement queue to the requested directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-medium-'));
  try {
    const result = writeMediumWeeklyDraft({
      date: new Date('2026-05-04T12:00:00Z'),
      outDir: tmp,
    });
    assert.ok(fs.existsSync(result.draftPath));
    assert.ok(fs.existsSync(result.queuePath));
    assert.match(fs.readFileSync(result.draftPath, 'utf8'), /Pre-Action Gates/);
    assert.match(fs.readFileSync(result.queuePath, 'utf8'), /medium\.com\/conversational-ai-weekly/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
