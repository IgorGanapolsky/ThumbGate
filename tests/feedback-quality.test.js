const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERIC_PHRASE_RULES,
  detectFeedbackSignal,
  isGenericFeedbackText,
  isLowSpecificityText,
  assessFeedbackActionability,
  assessPromotionQuality,
  buildClarificationMessage,
} = require('../scripts/feedback-quality');

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

test('isLowSpecificityText rejects empty and tiny corrective phrases', () => {
  assert.equal(isLowSpecificityText('be better'), true);
  assert.equal(isLowSpecificityText('fix it'), true);
  assert.equal(isLowSpecificityText('try harder'), true);
  assert.equal(
    isLowSpecificityText('Always run npm test and paste the green output before claiming done'),
    false,
  );
});

test('assessPromotionQuality blocks when all corrective fields are low-spec', () => {
  const result = assessPromotionQuality({
    signal: 'negative',
    context: 'bad',
    whatWentWrong: 'fix it',
    whatToChange: 'be better',
  });
  assert.equal(result.promotable, false);
  assert.ok(['specificity', 'actionability'].includes(result.qualityGate));
});

test('assessPromotionQuality keeps strong whatWentWrong even if whatToChange is vague', () => {
  const result = assessPromotionQuality({
    signal: 'negative',
    context: 'Agent broke production deploy pipeline',
    whatWentWrong: 'Deployed without running the integration test suite first',
    whatToChange: 'be better',
  });
  assert.equal(result.promotable, true);
  assert.equal(result.qualityGate, 'passed');
});

test('assessPromotionQuality promotes specific actionable negative', () => {
  const result = assessPromotionQuality({
    signal: 'negative',
    context: 'PreToolUse allowed a force-push to main',
    whatWentWrong: 'Agent ran git push --force origin main without approval',
    whatToChange: 'Block force-push to protected branches and require a PR review',
  });
  assert.equal(result.promotable, true);
  assert.equal(result.qualityGate, 'passed');
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
