const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  GENERIC_PHRASE_RULES,
  detectFeedbackSignal,
  isGenericFeedbackText,
  assessFeedbackActionability,
  buildClarificationMessage,
  deriveRuleFromContext,
  scoreFeedbackReward,
} = require('../scripts/feedback-quality');
const { extractTags } = require('../scripts/feedback-schema');
const {
  inferProjectIdFromCwd,
  resolveCaptureScope,
  evaluateMemoryScopeReadiness,
} = require('../scripts/memory-scope-readiness');
const {
  captureFeedback,
  PRE_PUBLISH_LIVE_READ_RULE,
  buildPreventionRules,
  buildMonthlyFeedbackStats,
  formatMonthlyFeedbackStats,
} = require('../scripts/feedback-loop');
const { getToolDefinitions } = require('../scripts/tool-registry');
const gateTemplates = require('../config/gate-templates.json');

test('GENERIC_PHRASE_RULES has positive and negative lists', () => {
  assert.ok(Array.isArray(GENERIC_PHRASE_RULES.positive));
  assert.ok(Array.isArray(GENERIC_PHRASE_RULES.negative));
  assert.ok(GENERIC_PHRASE_RULES.positive.length > 5);
  assert.ok(GENERIC_PHRASE_RULES.negative.length > 5);
});

test('isGenericFeedbackText detects bare positive phrases', () => {
  assert.equal(isGenericFeedbackText('thumbs up', 'positive'), true);
  assert.equal(isGenericFeedbackText('lgtm', 'positive'), true);
  assert.equal(isGenericFeedbackText('good job', 'positive'), true);
  assert.equal(isGenericFeedbackText('perfect', 'positive'), true);
});

test('isGenericFeedbackText detects bare negative phrases', () => {
  assert.equal(isGenericFeedbackText('thumbs down', 'negative'), true);
  assert.equal(isGenericFeedbackText('bad', 'negative'), true);
  assert.equal(isGenericFeedbackText('wrong', 'negative'), true);
});

test('isGenericFeedbackText rejects detailed feedback', () => {
  assert.equal(isGenericFeedbackText('The API call failed because the token expired', 'negative'), false);
  assert.equal(isGenericFeedbackText('Great fix for the race condition in the auth flow', 'positive'), false);
});

test('detectFeedbackSignal accepts explicit standalone and leading signals', () => {
  const cases = [
    ['thumbs up', 'up'],
    ['thumbs down: reason', 'down'],
    ['thumbss up, evidence was clear', 'up'],
    ['thubs don this skipped verification', 'down'],
    ['thums down: wrong claim', 'down'],
    ['👍 verified before claiming done', 'up'],
    ['👎 claimed published without npm proof', 'down'],
    ['perfect, the verification was clear', 'up'],
    ['great job', 'up'],
    ['great work on the rotation guard', 'up'],
    ['well done', 'up'],
    ['this response is inadequate', 'down'],
    ['that answer was wrong', 'down'],
    ["that didn't work", 'down'],
  ];

  for (const [value, expectedSignal] of cases) {
    assert.equal(detectFeedbackSignal(value)?.signal, expectedSignal, value);
  }
});

test('detectFeedbackSignal rejects quoted, descriptive, negated, and mid-sentence mentions', () => {
  const cases = [
    'This is not perfect',
    'I just gave you a thumbs up; did it work?',
    'Did ThumbGate capture my 👎?',
    'the text says "thumbs up"',
    'I will fix this bug',
    'fix this bug before closing the task',
    'the operator typed thumbss up in the transcript',
    'the example contains 👎 but is not feedback',
    '"thumbs down: reason"',
    'please update the docs',
    'I think great job postings need work',
    'the answer is inadequate documentation of the API',
  ];

  for (const value of cases) {
    assert.equal(detectFeedbackSignal(value), null, value);
  }
});

test('assessFeedbackActionability returns promotable for detailed negative', () => {
  const result = assessFeedbackActionability({
    signal: 'negative',
    context: 'The test suite was skipped before pushing',
    whatWentWrong: 'Tests were not run',
    whatToChange: 'Always run tests before push',
  });
  assert.equal(result.promotable, true);
  assert.equal(result.signal, 'negative');
  assert.deepEqual(result.missingFields, []);
});

test('assessFeedbackActionability returns non-promotable for bare signal', () => {
  const result = assessFeedbackActionability({
    signal: 'negative',
    context: 'bad',
  });
  assert.equal(result.promotable, false);
  assert.equal(result.isGenericContext, true);
});

test('buildClarificationMessage returns message for vague negative', () => {
  const result = buildClarificationMessage({
    signal: 'negative',
    context: 'bad',
  });
  assert.ok(result);
  assert.ok(result.message);
  assert.ok(result.message.length > 10);
});

test('buildClarificationMessage returns null for detailed feedback', () => {
  const result = buildClarificationMessage({
    signal: 'negative',
    context: 'The deploy script failed because NODE_ENV was not set',
    whatWentWrong: 'Missing environment variable',
    whatToChange: 'Add NODE_ENV check to deploy script',
  });
  assert.equal(result, null);
});

test('scoreFeedbackReward surfaces failedCheck and failedChecks when passed is false', () => {
  const low = scoreFeedbackReward({
    signal: 'negative',
    context: 'Agent updated the header layout',
  });
  assert.equal(low.passed, false);
  assert.ok(typeof low.failedCheck === 'string' && low.failedCheck.length > 0);
  assert.ok(Array.isArray(low.failedChecks) && low.failedChecks.length > 0);
});

test('captureFeedback surfaces failedCheck when rewardScore fails and blocks promotion in strict mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-strict-'));
  const prevDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    const strictResult = captureFeedback({
      feedback: 'down',
      context: 'Updated the header component without checking',
      strictRewardGate: true,
      cwd: '/Users/iganapolsky/workspace/ThumbGate',
    });
    assert.equal(strictResult.rewardScore.passed, false);
    assert.equal(strictResult.accepted, false);
    assert.ok(strictResult.failedCheck);
    assert.ok(Array.isArray(strictResult.failedChecks) && strictResult.failedChecks.length > 0);
    assert.match(strictResult.reason, /Reward score failed check/);
  } finally {
    if (prevDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('inferProjectIdFromCwd and captureFeedback populate scope.projectId from caller cwd', () => {
  assert.equal(inferProjectIdFromCwd('/Users/iganapolsky/workspace/ThumbGate.worktrees/feat-feedback-quality-2026-11-05'), 'thumbgate');
  const scope = resolveCaptureScope({ cwd: '/Users/iganapolsky/workspace/dayglass' });
  assert.equal(scope.projectId, 'dayglass');
  assert.equal(scope.tenantId, 'default');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-scope-'));
  const prevDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    const res = captureFeedback({
      signal: 'down',
      context: 'Published shared landing page without re-reading the live version first',
      whatWentWrong: 'Overwrote header padding from concurrent session',
      whatToChange: 'Re-read the live version before publishing a shared artifact',
      cwd: '/Users/iganapolsky/workspace/ThumbGate',
    });
    assert.equal(res.feedbackEvent.scope.projectId, 'thumbgate');
    if (res.memoryRecord) {
      assert.equal(res.memoryRecord.scope.projectId, 'thumbgate');
    }
    const readiness = evaluateMemoryScopeReadiness({ feedbackDir: tmpDir });
    assert.ok(readiness.Project.scopedFeedbackRecords >= 1);
  } finally {
    if (prevDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('deriveRuleFromContext strips filler prefixes and stays <= 80 characters', () => {
  const raw = 'Never fixed: When fixing the shared landing page header padding during testing, always re-read the live version before publishing a shared artifact because otherwise layout changes get overwritten across sessions';
  const rule = deriveRuleFromContext(raw);
  assert.ok(rule.length > 0 && rule.length <= 80, `Rule length ${rule.length} > 80: ${rule}`);
  assert.equal(/^never\s+fixed:/i.test(rule), false);
  assert.equal(/^when\s+fixing\b/i.test(rule), false);
});

test('extractTags classifies CSS header padding and alignment as ui-components instead of api-design', () => {
  const tags = extractTags('Fixed CSS header padding and alignment on the pricing card', []);
  assert.ok(tags.includes('ui-components'), `Expected ui-components in ${JSON.stringify(tags)}`);
  assert.equal(tags.includes('api-design'), false, `Did not expect api-design in ${JSON.stringify(tags)}`);
});

test('capture_feedback tool definition puts signal first in description', () => {
  const defs = getToolDefinitions();
  const captureDef = defs.find((d) => d.name === 'capture_feedback');
  assert.ok(captureDef);
  assert.match(captureDef.description, /^Capture a thumbs up\/down signal\. Required: signal \("up" \| "down"\) and context/);
});

test('PRE_PUBLISH_LIVE_READ_RULE is included in prevention rules and gate-templates.json', () => {
  assert.equal(
    PRE_PUBLISH_LIVE_READ_RULE.rule,
    'Re-read the live version before publishing a shared artifact'
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-rules-'));
  const prevDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    const markdown = buildPreventionRules(2);
    assert.match(markdown, /Re-read the live version before publishing a shared artifact/);
  } finally {
    if (prevDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const gate = (gateTemplates.gates || gateTemplates.templates || []).find((g) => g.id === 'reread-live-before-publish-shared-artifact');
  assert.ok(gate);
  assert.equal(gate.name, 'Re-read the live version before publishing a shared artifact');
});

test('buildMonthlyFeedbackStats reports lessons retrieved, repeated corrections after lesson, and capture token cost', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-monthly-'));
  const prevDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    captureFeedback({
      signal: 'down',
      context: 'Published shared artifact without re-reading the live version first',
      whatWentWrong: 'Header padding regressed on republish',
      whatToChange: 'Re-read the live version before publishing a shared artifact',
      tags: ['ui-components'],
    });
    captureFeedback({
      signal: 'down',
      context: 'Published shared artifact again without re-reading live CSS padding',
      whatWentWrong: 'Repeated header padding regression after lesson existed',
      whatToChange: 'Re-read the live version before publishing a shared artifact',
      tags: ['ui-components'],
    });
    fs.writeFileSync(
      path.join(tmpDir, 'telemetry-pings.jsonl'),
      `${JSON.stringify({ timestamp: new Date().toISOString(), tool: 'retrieve_lessons', retrievedCount: 3 })}\n`
    );
    const stats = buildMonthlyFeedbackStats({ windowDays: 30 });
    assert.equal(stats.captureCalls, 2);
    assert.equal(stats.lessonsRetrieved, 3);
    assert.ok(stats.repeatedCorrectionsAfterLesson >= 1);
    assert.ok(stats.tokenCost.totalCaptureTokens > 0);
    const formatted = formatMonthlyFeedbackStats(stats);
    assert.match(formatted, /Lessons retrieved: 3/);
    assert.match(formatted, /Corrections repeated after lesson existed: [1-9]/);
    assert.match(formatted, /Capture token cost: \d+ tokens/);
  } finally {
    if (prevDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
