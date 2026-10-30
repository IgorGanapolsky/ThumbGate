const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  GENERIC_PHRASE_RULES,
  detectFeedbackSignal,
  reactionLessonLine,
  isGenericFeedbackText,
  assessFeedbackActionability,
  buildClarificationMessage,
} = require('../scripts/feedback-quality');
const { captureFeedback } = require('../scripts/feedback-loop');

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
  assert.equal(isGenericFeedbackText('yes, thumbs down, that broke it', 'negative'), false);
});

test('isGenericFeedbackText treats a prefixed bare reaction as empty', () => {
  assert.equal(isGenericFeedbackText('yes, thumbs down', 'negative'), true);
  assert.equal(isGenericFeedbackText('yes, great', 'positive'), true);
  assert.equal(isGenericFeedbackText('ok, bad', 'negative'), true);
  assert.equal(assessFeedbackActionability({
    signal: 'negative',
    context: 'yes, thumbs down',
  }).promotable, false);
  assert.equal(assessFeedbackActionability({
    signal: 'positive',
    context: 'yes, great',
  }).promotable, false);
});

test('capture keeps a prefixed bare reaction and does not promote it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-prefixed-bare-'));
  const previous = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const down = captureFeedback({
      signal: 'down',
      context: 'yes, thumbs down',
      reviewOrigin: 'human',
    });
    assert.equal(down.promoted, false);
    assert.equal(down.feedbackEvent.actionType, 'no-action');
    assert.equal(down.feedbackEvent.context, 'yes, thumbs down');

    const up = captureFeedback({
      signal: 'up',
      context: 'yes, great',
      reviewOrigin: 'human',
    });
    assert.equal(up.promoted, false);
    assert.equal(up.feedbackEvent.actionType, 'no-action');

    const detailed = captureFeedback({
      signal: 'down',
      context: 'yes, thumbs down, that broke it',
      whatWentWrong: 'that broke it',
      whatToChange: 'that broke it',
      reviewOrigin: 'human',
    });
    assert.equal(detailed.promoted, true);
    assert.equal(detailed.feedbackEvent.actionType, 'store-mistake');
    assert.equal(detailed.feedbackEvent.whatWentWrong, 'that broke it');
    assert.doesNotMatch(detailed.memory?.title || '', /^MISTAKE: yes, thumbs down$/);
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    ['great', 'up'],
    ['great, the receipt check passed', 'up'],
    ['bad', 'down'],
    ['bad, the deploy skipped the test', 'down'],
    ['yes, thumbs down, that broke it', 'down'],
    ['great work on the rotation guard', 'up'],
    ['well done', 'up'],
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
    'Yes, fix it',
    'i gave you a thumbs up, did you use thumbgate?',
    'this response is inadequate',
    'that answer was wrong',
    'great documentation of the API',
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

test('reactionLessonLine keeps one clause and drops the reaction token', () => {
  assert.equal(reactionLessonLine('thumbs down: the deploy skipped the test'), 'the deploy skipped the test');
  assert.equal(reactionLessonLine('yes, thumbs down, that broke it'), 'that broke it');
  assert.equal(reactionLessonLine('👍 verified before claiming done'), 'verified before claiming done');
  assert.equal(reactionLessonLine('bad'), null);
  assert.equal(reactionLessonLine('great'), null);
  assert.equal(reactionLessonLine('Yes, fix it'), null);
  assert.equal(reactionLessonLine('i gave you a thumbs up, did you use thumbgate?'), null);
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

test('shell hook ignores ordinary replies and stores one lesson line for a short reaction', () => {
  const hook = path.join(__dirname, '..', 'scripts', 'hook-auto-capture.sh');
  function runHook(prompt) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reaction-'));
    const result = spawnSync('bash', [hook], {
      env: {
        ...process.env,
        CLAUDE_USER_PROMPT: prompt,
        CLAUDE_PROJECT_DIR: dir,
        THUMBGATE_FEEDBACK_DIR: dir,
      },
      encoding: 'utf8',
    });
    const logPath = path.join(dir, 'feedback-log.jsonl');
    const rows = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: result.status, rows };
  }

  const question = runHook('i gave you a thumbs up, did you use thumbgate?');
  assert.equal(question.status, 0);
  assert.equal(question.rows.length, 0);

  const reply = runHook('Yes, fix it');
  assert.equal(reply.status, 0);
  assert.equal(reply.rows.length, 0);

  const reaction = runHook('thumbs down: the deploy skipped the test');
  assert.equal(reaction.status, 0);
  assert.equal(reaction.rows.length, 1);
  assert.equal(reaction.rows[0].signal, 'negative');
  assert.equal(reaction.rows[0].whatWentWrong, 'the deploy skipped the test');
  assert.equal(reaction.rows[0].whatToChange, 'the deploy skipped the test');
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
