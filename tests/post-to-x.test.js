'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  percentEncode,
  generateOAuthSignature,
  buildOAuthHeader,
  formatSearchResult,
  postTweet,
  postThread,
  searchTweets,
  parseTweetsFromThread,
  safeLogValue,
} = require('../scripts/post-to-x');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'post-to-x.js');
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;
const ORIGINAL_CONSOLE_ERROR = console.error;

function stubFetch(impl) {
  globalThis.fetch = impl;
}

function silenceConsole() {
  console.log = () => {};
  console.error = () => {};
}

function restoreGlobals() {
  if (typeof ORIGINAL_FETCH === 'undefined') {
    delete globalThis.fetch;
  } else {
    globalThis.fetch = ORIGINAL_FETCH;
  }
  console.log = ORIGINAL_CONSOLE_LOG;
  console.error = ORIGINAL_CONSOLE_ERROR;
}

describe('percentEncode', () => {
  it('encodes special chars (!, *, \', (, ))', () => {
    assert.equal(percentEncode('!'), '%21');
    assert.equal(percentEncode('*'), '%2A');
    assert.equal(percentEncode("'"), '%27');
    assert.equal(percentEncode('('), '%28');
    assert.equal(percentEncode(')'), '%29');
  });

  it('passes through alphanumeric and standard URI-safe chars', () => {
    assert.equal(percentEncode('hello'), 'hello');
    assert.equal(percentEncode('a-b_c.d~e'), 'a-b_c.d~e');
  });
});

describe('safeLogValue', () => {
  it('strips control characters that can forge log lines', () => {
    assert.equal(safeLogValue('abc\r\nINJECT\tdef'), 'abc  INJECT def');
  });

  it('truncates long log values', () => {
    assert.equal(safeLogValue('abcdef', 3), 'abc');
  });

  it('normalizes nullish log values to an empty string', () => {
    assert.equal(safeLogValue(null), '');
    assert.equal(safeLogValue(undefined), '');
  });
});

describe('generateOAuthSignature', () => {
  it('produces a valid HMAC-SHA1 base64 signature', () => {
    const sig = generateOAuthSignature(
      'POST',
      'https://api.twitter.com/2/tweets',
      { oauth_consumer_key: 'testkey', oauth_nonce: 'abc123' },
      'consumer-secret',
      'token-secret'
    );
    assert.ok(typeof sig === 'string');
    assert.ok(sig.length > 0);
    // base64 characters only
    assert.match(sig, /^[A-Za-z0-9+/=]+$/);
  });

  it('is deterministic for the same inputs', () => {
    const args = [
      'GET',
      'https://api.twitter.com/2/tweets',
      { key: 'val' },
      'secret1',
      'secret2',
    ];
    assert.equal(generateOAuthSignature(...args), generateOAuthSignature(...args));
  });

  it('keeps OAuth 1.0a signing on HMAC-SHA1 for protocol compatibility', () => {
    const signature = generateOAuthSignature(
      'POST',
      'https://api.twitter.com/2/tweets',
      { oauth_consumer_key: 'testkey', oauth_nonce: 'abc123' },
      'consumer-secret',
      'token-secret'
    );
    assert.match(signature, /^[A-Za-z0-9+/=]+$/);
  });
});

describe('buildOAuthHeader', () => {
  beforeEach(() => {
    process.env.X_API_KEY = 'test-api-key';
    process.env.X_API_SECRET = 'test-api-secret';
    process.env.X_ACCESS_TOKEN = 'test-access-token';
    process.env.X_ACCESS_TOKEN_SECRET = 'test-access-token-secret';
  });

  afterEach(() => {
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_ACCESS_TOKEN_SECRET;
  });

  it('returns a string starting with "OAuth " with all required params', () => {
    const header = buildOAuthHeader('POST', 'https://api.twitter.com/2/tweets', {});
    assert.ok(header.startsWith('OAuth '));
    assert.ok(header.includes('oauth_consumer_key='));
    assert.ok(header.includes('oauth_nonce='));
    assert.ok(header.includes('oauth_signature='));
    assert.ok(header.includes('oauth_signature_method='));
    assert.ok(header.includes('oauth_timestamp='));
    assert.ok(header.includes('oauth_token='));
    assert.ok(header.includes('oauth_version='));
  });
});

describe('postTweet', () => {
  beforeEach(() => {
    process.env.X_API_KEY = 'test-api-key';
    process.env.X_API_SECRET = 'test-api-secret';
    process.env.X_ACCESS_TOKEN = 'test-access-token';
    process.env.X_ACCESS_TOKEN_SECRET = 'test-access-token-secret';
    silenceConsole();
  });

  afterEach(() => {
    restoreGlobals();
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_ACCESS_TOKEN_SECRET;
  });

  it('returns tweet ID on 201', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: '123456789' } }),
    }));

    const id = await postTweet('Hello world');
    assert.equal(id, '123456789');
  });

  it('returns null on error status', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Forbidden' }),
    }));

    const id = await postTweet('Bad tweet');
    assert.equal(id, null);
  });

  it('handles 429 rate limit and eventually returns null', async () => {
    const headers = { get: (key) => key === 'retry-after' ? '0' : null };
    stubFetch(async () => ({
      ok: false,
      status: 429,
      headers,
      json: async () => ({ detail: 'Too Many Requests' }),
    }));

    const id = await postTweet('Rate limited tweet');
    assert.equal(id, null);
  });
});

describe('searchTweets', () => {
  beforeEach(() => {
    process.env.X_API_KEY = 'test-api-key';
    process.env.X_API_SECRET = 'test-api-secret';
    process.env.X_ACCESS_TOKEN = 'test-access-token';
    process.env.X_ACCESS_TOKEN_SECRET = 'test-access-token-secret';
    silenceConsole();
  });

  afterEach(() => {
    restoreGlobals();
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_ACCESS_TOKEN_SECRET;
  });

  it('returns array of tweets on success', async () => {
    const fakeTweets = [
      { id: '1', text: 'tweet one' },
      { id: '2', text: 'tweet two' },
    ];
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: fakeTweets }),
    }));

    const results = await searchTweets('mcp memory');
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 2);
    assert.equal(results[0].id, '1');
  });

  it('returns empty array on error', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Internal error' }),
    }));

    const results = await searchTweets('mcp memory');
    assert.deepEqual(results, []);
  });
});

describe('formatSearchResult', () => {
  it('sanitizes tweet ids and text for console output', () => {
    const line = formatSearchResult({
      id: '123\nforged',
      text: 'hello\r\nworld',
    });

    assert.equal(line, '  [123 forged] hello  world...');
  });
});

describe('postThread', () => {
  beforeEach(() => {
    process.env.X_API_KEY = 'test-api-key';
    process.env.X_API_SECRET = 'test-api-secret';
    process.env.X_ACCESS_TOKEN = 'test-access-token';
    process.env.X_ACCESS_TOKEN_SECRET = 'test-access-token-secret';
    silenceConsole();
  });

  afterEach(() => {
    restoreGlobals();
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_ACCESS_TOKEN_SECRET;
  });

  it('posts multiple tweets in sequence with reply threading', async () => {
    let callCount = 0;
    stubFetch(async (_url, opts) => {
      callCount++;
      const body = JSON.parse(opts.body);
      if (callCount === 1) {
        assert.equal(body.reply, undefined);
      } else {
        assert.ok(body.reply);
        assert.ok(body.reply.in_reply_to_tweet_id);
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { id: `id-${callCount}` } }),
      };
    });

    await postThread(['First tweet', 'Second tweet', 'Third tweet']);
    assert.equal(callCount, 3);
  });

  it('stops thread when a tweet fails', async () => {
    let callCount = 0;
    stubFetch(async () => {
      callCount++;
      if (callCount === 2) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Server error' }),
        };
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { id: `id-${callCount}` } }),
      };
    });

    await postThread(['Tweet 1', 'Tweet 2', 'Tweet 3']);
    assert.equal(callCount, 2);
  });
});

describe('--dry-run mode', () => {
  function runDryRun(args) {
    return spawnSync(process.execPath, [SCRIPT, '--dry-run', ...args], {
      encoding: 'utf8',
    });
  }

  it('parseTweetsFromThread extracts tweets without posting', () => {
    const threadContent = [
      '1/3: First tweet of the thread',
      '2/3: Second tweet continues',
      '3/3: Final tweet wraps up',
    ].join('\n');

    const tweets = parseTweetsFromThread(threadContent);
    assert.ok(Array.isArray(tweets));
    assert.equal(tweets.length, 3);
    assert.ok(tweets[0].includes('First tweet'));
    assert.ok(tweets[2].includes('Final tweet'));
  });

  it('sanitizes reply previews and printed reply URLs', () => {
    const result = runDryRun(['--reply', '123\r\nforged', 'Reply with\nnewline']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would post \(reply to 123  forged\): Reply with newline/);
    assert.doesNotMatch(result.stdout, /\nforged/);
    assert.match(result.stdout, /Reply posted: https:\/\/x\.com\/IgorGanapolsky\/status\/dry-run-/);
  });

  it('sanitizes search previews without hitting the network', () => {
    const result = runDryRun(['--search', 'ThumbGate\nforged']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would search: "ThumbGate forged"/);
    assert.match(result.stdout, /No results found/);
  });

  it('prints sanitized direct, scheduled, default, and thread dry-run previews', () => {
    const direct = runDryRun(['Direct post\nforged']);
    assert.equal(direct.status, 0, direct.stderr);
    assert.match(direct.stdout, /Would post: Direct post forged/);
    assert.match(direct.stdout, /https:\/\/x\.com\/IgorGanapolsky\/status\/dry-run-/);

    const scheduled = runDryRun(['--scheduled']);
    assert.equal(scheduled.status, 0, scheduled.stderr);
    assert.match(scheduled.stdout, /Scheduled tweet/);
    assert.match(scheduled.stdout, /https:\/\/x\.com\/IgorGanapolsky\/status\/dry-run-/);

    const defaultPost = runDryRun([]);
    assert.equal(defaultPost.status, 0, defaultPost.stderr);
    assert.match(defaultPost.stdout, /Would post: .*Launched ThumbGate/s);
    assert.match(defaultPost.stdout, /https:\/\/x\.com\/IgorGanapolsky\/status\/dry-run-/);

    const thread = runDryRun(['--thread']);
    assert.equal(thread.status, 0, thread.stderr);
    assert.match(thread.stdout, /Parsed \d+ tweets/);
    assert.match(thread.stdout, /Thread preview!/);
  });
});
