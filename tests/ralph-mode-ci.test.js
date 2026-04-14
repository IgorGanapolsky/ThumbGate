'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ralphModePath = require.resolve('../scripts/ralph-mode-ci');

function loadRalphMode(env = {}) {
  const previousEnv = { ...process.env };
  delete require.cache[ralphModePath];
  Object.assign(process.env, {
    X_API_KEY: 'key',
    X_API_SECRET: 'secret',
    X_ACCESS_TOKEN: 'token',
    X_ACCESS_TOKEN_SECRET: 'token-secret',
    ...env,
  });
  const subject = require('../scripts/ralph-mode-ci');
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) delete process.env[key];
  }
  Object.assign(process.env, previousEnv);
  return subject;
}

test('postTweet returns a skipped result instead of fabricating success on X 401', async () => {
  const subject = loadRalphMode();
  const originalFetch = global.fetch;
  const logs = [];
  const originalLog = console.log;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ title: 'Unauthorized', detail: 'Unauthorized' }),
  });
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const result = await subject.postTweet('hello');
    assert.equal(result.ok, false);
    assert.equal(result.id, '');
    assert.equal(result.status, 401);
    assert.equal(result.error, 'Unauthorized');
    assert.ok(logs.some((line) => line.includes('X error detail')));
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
  }
});

test('replyTweet reports only real reply ids as success', async () => {
  const subject = loadRalphMode();
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return {
        ok: false,
        status: 403,
        json: async () => ({ errors: [{ message: 'Forbidden by policy' }] }),
      };
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 'reply_456' } }),
    };
  };

  try {
    const blocked = await subject.replyTweet('blocked reply', 'tweet_1');
    assert.deepEqual(blocked, {
      id: '',
      ok: false,
      status: 403,
      error: 'Forbidden by policy',
    });
    assert.deepEqual(requests[0].reply, { in_reply_to_tweet_id: 'tweet_1' });

    const posted = await subject.replyTweet('posted reply', 'tweet_2');
    assert.deepEqual(posted, {
      id: 'reply_456',
      ok: true,
      status: 201,
      error: '',
    });
    assert.deepEqual(requests[1].reply, { in_reply_to_tweet_id: 'tweet_2' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('parseJsonResponse and extractApiError keep API failures readable', async () => {
  const subject = loadRalphMode();

  const parsed = await subject.parseJsonResponse({
    json: async () => {
      throw new Error('invalid json');
    },
  });
  assert.deepEqual(parsed, {});

  assert.equal(subject.extractApiError({ title: 'Rate limited' }, 429), 'Rate limited');
  assert.equal(subject.extractApiError({ errors: [{ detail: 'Token expired' }] }, 401), 'Token expired');
  assert.equal(subject.extractApiError({}, 502), 'HTTP 502');
  assert.equal(subject.extractApiError({}, 0), 'HTTP unknown');
});

test('entrypoint detection stays false when Ralph Mode is imported by tests', () => {
  const subject = loadRalphMode();

  assert.equal(subject.isDirectInvocation(), false);
  assert.equal(subject.isDirectInvocation({ filename: ralphModePath }), true);
});

test('recordTweetPost increments only when X returns a real tweet id', () => {
  const subject = loadRalphMode();
  const report = { tweets: 0 };
  const logs = [];

  const skipped = subject.recordTweetPost(report, {
    ok: false,
    status: 401,
    error: 'Unauthorized',
  }, (line) => logs.push(line));
  assert.equal(skipped, false);
  assert.equal(report.tweets, 0);
  assert.match(logs[0], /Tweet skipped: Unauthorized/);

  const posted = subject.recordTweetPost(report, {
    ok: true,
    status: 201,
    id: 'tweet_123',
  }, (line) => logs.push(line));
  assert.equal(posted, true);
  assert.equal(report.tweets, 1);
  assert.match(logs[1], /Tweet posted: tweet_123/);
});

test('recordTweetReply increments only on successful reply creation', () => {
  const subject = loadRalphMode();
  const report = { replies: 0 };
  const logs = [];

  const skipped = subject.recordTweetReply(report, 'somebody', {
    ok: false,
    status: 403,
    error: 'Forbidden',
  }, (line) => logs.push(line));
  assert.equal(skipped, false);
  assert.equal(report.replies, 0);
  assert.match(logs[0], /Reply skipped for @somebody: Forbidden/);

  const replied = subject.recordTweetReply(report, 'somebody', {
    ok: true,
    status: 201,
    id: 'reply_123',
  }, (line) => logs.push(line));
  assert.equal(replied, true);
  assert.equal(report.replies, 1);
  assert.match(logs[1], /Replied to @somebody: reply_123/);
});

test('Ralph Mode tweet angles advertise current Pro and Team pricing', () => {
  const subject = loadRalphMode();
  const joined = subject.TWEET_ANGLES.join('\n');

  assert.match(joined, /\$19\/mo/);
  assert.match(joined, /\$149\/yr/);
  assert.match(joined, /\$99\/seat\/mo/);
  assert.doesNotMatch(joined, /\$49 once/);
});

test('Ralph Mode GitHub outreach uses canonical ThumbGate install copy', async () => {
  const previousCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-mode-ci-'));
  process.chdir(tmpDir);

  const subject = loadRalphMode({
    DEVTO_API_KEY: '',
    GH_TOKEN: 'gh-token',
    LINKEDIN_ACCESS_TOKEN: '',
    LINKEDIN_PERSON_URN: '',
    PERPLEXITY_API_KEY: '',
    X_ACCESS_TOKEN: '',
    X_ACCESS_TOKEN_SECRET: '',
    X_API_KEY: '',
    X_API_SECRET: '',
    X_BEARER_TOKEN: '',
  });

  const originalFetch = global.fetch;
  const originalLog = console.log;
  const issueBodies = [];
  console.log = () => {};
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const pathname = new URL(url).pathname;

    if (options.method === 'POST' && pathname.endsWith('/comments')) {
      issueBodies.push(body.body);
      return { json: async () => ({ id: 1 }) };
    }

    if (options.method === 'POST' && pathname.endsWith('/issues')) {
      issueBodies.push(body.body);
      return { json: async () => ({ number: 2 }) };
    }

    if (pathname === '/repos/leogodin217/leos_claude_starter/issues/1') {
      return { json: async () => ({ comments: 1 }) };
    }

    if (pathname === '/repos/leogodin217/leos_claude_starter/issues/1/comments') {
      return { json: async () => ([{ user: { login: 'builder' } }]) };
    }

    if (pathname.endsWith('/search/repositories')) {
      return { json: async () => ({ items: [{ full_name: 'somebody/agent-safety', name: 'agent-safety', stargazers_count: 9 }] }) };
    }

    if (pathname.endsWith('/repos/IgorGanapolsky/ThumbGate')) {
      return { json: async () => ({ stargazers_count: 42, forks_count: 7 }) };
    }

    if (pathname.endsWith('/pulls/4474')) {
      return { json: async () => ({ state: 'open', merged: false }) };
    }

    return { json: async () => ({ comments: 0 }) };
  };

  try {
    await subject.main();
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.equal(issueBodies.length, 2);
  assert.ok(issueBodies.every((body) => body.includes('Install with `npx thumbgate init`')));
  assert.ok(issueBodies.every((body) => body.includes('https://github.com/IgorGanapolsky/ThumbGate')));
  assert.ok(issueBodies.every((body) => !body.includes('smithery.ai')));
  assert.ok(issueBodies.every((body) => !body.includes('rlhf-loop')));
});
