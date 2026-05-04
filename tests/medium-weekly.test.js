'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ARTICLE_TOPICS,
  CONVERSATIONAL_AI_WEEKLY_TARGET,
  CONVERSATIONAL_AI_WEEKLY_URL,
  buildEngagementQueue,
  buildMediumDraft,
  buildSubmissionPitch,
  buildTrackedUrl,
  buildVisibilityPlan,
  isCliInvocation,
  renderDraftMarkdown,
  renderQueueCsv,
  renderSubmissionPitchMarkdown,
  runCli,
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
  const beforeStart = topicForDate(new Date('2026-04-27T12:00:00Z'));
  assert.equal(beforeStart.slug, first.slug);
  assert.notEqual(first.slug, second.slug);
});

test('buildTrackedUrl keeps Medium attribution machine-readable', () => {
  const url = new URL(buildTrackedUrl('/guides/pre-action-checks', ARTICLE_TOPICS[2]));
  assert.equal(url.origin, 'https://thumbgate-production.up.railway.app');
  assert.equal(url.searchParams.get('utm_source'), 'medium');
  assert.equal(url.searchParams.get('utm_content'), ARTICLE_TOPICS[2].slug);
  assert.equal(url.searchParams.get('cta_id'), 'medium_weekly_article');
});

test('buildMediumDraft creates a manual-publish article with tracked CTAs', () => {
  const draft = buildMediumDraft({
    date: new Date('2026-05-04T12:00:00Z'),
    topic: ARTICLE_TOPICS[0],
  });

  assert.equal(draft.platform, 'medium');
  assert.equal(draft.status, 'draft_ready_manual_publish_required');
  assert.equal(draft.publicationUrl, CONVERSATIONAL_AI_WEEKLY_URL);
  assert.equal(draft.publicationTarget.name, CONVERSATIONAL_AI_WEEKLY_TARGET.name);
  assert.match(draft.body, /passive observability becomes active enforcement/i);
  assert.match(draft.body, /utm_source=medium/);
  assert.match(draft.body, /Workflow Hardening Sprint intake/);
  assert.ok(draft.publishChecklist.some((item) => /canonical link/i.test(item)));
  assert.ok(draft.publishChecklist.some((item) => /publish|Medium/i.test(item)));
});

test('submission pitch and visibility plan target Conversational AI Weekly every week', () => {
  const date = new Date('2026-05-04T12:00:00Z');
  const topic = ARTICLE_TOPICS[0];
  const pitch = buildSubmissionPitch({ date, topic });
  const plan = buildVisibilityPlan({ date, topic });

  assert.equal(pitch.target.url, CONVERSATIONAL_AI_WEEKLY_URL);
  assert.match(pitch.subject, /Conversational AI Weekly/);
  assert.match(pitch.body, /deterministic pre-action checks/i);
  assert.equal(plan.cadence, 'weekly');
  assert.equal(plan.targetPublication.followerSignal, '165 followers observed on Medium');
  assert.equal(plan.artifacts.submissionPitchMarkdown, '2026-05-04-pre-action-gates-for-tool-using-ai-agents-pitch.md');
  assert.ok(plan.publishOrchestration.some((step) => step.step === 'measure'));
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
  const pitch = renderSubmissionPitchMarkdown(buildSubmissionPitch({ topic: ARTICLE_TOPICS[0] }));

  assert.match(markdown, /^---\nplatform: medium/m);
  assert.match(markdown, /publication_name: "Conversational AI Weekly"/);
  assert.match(markdown, /Manual publish checklist/);
  assert.match(csv, /^channel,target,priority,reason,prompt,draft/);
  assert.match(csv, /medium_comment/);
  assert.match(pitch, /Submission idea for Conversational AI Weekly/);
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
    assert.ok(fs.existsSync(result.pitchPath));
    assert.ok(fs.existsSync(result.visibilityPlanPath));
    assert.match(fs.readFileSync(result.draftPath, 'utf8'), /Pre-Action Gates/);
    assert.match(fs.readFileSync(result.queuePath, 'utf8'), /medium\.com\/conversational-ai-weekly/);
    assert.match(fs.readFileSync(result.pitchPath, 'utf8'), /production AI-agent builders/);
    assert.match(fs.readFileSync(result.visibilityPlanPath, 'utf8'), /ready_for_visible_publish_or_submission/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runCli writes drafts by default and schedules only when requested', () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const draftResult = runCli([], {
      writeMediumWeeklyDraft: () => ({ draftPath: '/tmp/draft.md', queuePath: '/tmp/queue.csv' }),
    });
    assert.equal(draftResult.draftPath, '/tmp/draft.md');
    assert.match(writes.join(''), /draft\.md/);

    writes.length = 0;
    const scheduleResult = runCli(['--schedule'], {
      createMediumWeeklySchedule: () => ({ ok: true, id: 'thumbgate-medium-weekly-draft' }),
    });
    assert.equal(scheduleResult.id, 'thumbgate-medium-weekly-draft');
    assert.match(writes.join(''), /thumbgate-medium-weekly-draft/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('isCliInvocation identifies only the Medium weekly script path', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'medium-weekly.js');
  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
  assert.equal(isCliInvocation(['node']), false);
});

test('GitHub workflow generates Medium visibility kit without claiming publication', () => {
  const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'medium-weekly-visibility.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /medium-weekly-visibility/);
  assert.match(workflow, /npm run medium:weekly:draft/);
  assert.match(workflow, /npm run test:medium-weekly/);
  assert.match(workflow, /docs\/marketing\/medium\/published\.csv/);
  assert.doesNotMatch(workflow, /MEDIUM_API_TOKEN|medium publish/i);
});
