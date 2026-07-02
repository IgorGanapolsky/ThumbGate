'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');

const {
  classifyRequester,
  isProbablyBot,
  classifyVisitor,
  shouldExcludeFromAnalytics,
  getOwnerEmails,
  BOT_PATTERNS,
} = require('../scripts/bot-detection');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';

describe('bot-detection', () => {
  describe('browsers should not be flagged', () => {
    const cases = [
      { name: 'desktop safari', ua: BROWSER_UA },
      {
        name: 'chrome',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      {
        name: 'firefox',
        ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      },
      {
        name: 'iphone safari',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    ];
    for (const c of cases) {
      it(`classifies ${c.name} as human`, () => {
        const result = classifyRequester({
          'user-agent': c.ua,
          accept: BROWSER_ACCEPT,
        });
        assert.equal(result.isBot, false, `expected human, got bot (${result.reason})`);
      });
    }
  });

  describe('known bots are flagged', () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)',
      'Twitterbot/1.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'WhatsApp/2.23.0',
      'curl/8.4.0',
      'Wget/1.21.4',
      'python-requests/2.31.0',
      'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
      'axios/1.6.2',
      'PostmanRuntime/7.36.0',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
      'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
      'HeadlessChrome/119.0.0.0',
    ];
    for (const ua of bots) {
      it(`flags ${ua.split(/[/\s]/)[0]}`, () => {
        const result = classifyRequester({
          'user-agent': ua,
          accept: BROWSER_ACCEPT,
        });
        assert.equal(result.isBot, true, `expected bot for ${ua}`);
        assert.ok(result.reason, 'reason should be populated');
      });
    }
  });

  it('missing user-agent is treated as bot', () => {
    const result = classifyRequester({ accept: BROWSER_ACCEPT });
    assert.equal(result.isBot, true);
    assert.equal(result.reason, 'missing_user_agent');
  });

  it('prefetch Sec-Purpose is treated as bot', () => {
    const result = classifyRequester({
      'user-agent': BROWSER_UA,
      accept: BROWSER_ACCEPT,
      'sec-purpose': 'prefetch;prerender',
    });
    assert.equal(result.isBot, true);
    assert.equal(result.reason, 'prefetch_purpose');
  });

  it('Accept header without text/html flagged', () => {
    const result = classifyRequester({
      'user-agent': BROWSER_UA,
      accept: 'application/json',
    });
    assert.equal(result.isBot, true);
    assert.equal(result.reason, 'accept_no_html');
  });

  it('isProbablyBot convenience matches classifyRequester', () => {
    assert.equal(isProbablyBot({ 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT }), false);
    assert.equal(isProbablyBot({ 'user-agent': 'curl/8.0' }), true);
  });
});

describe('classifyVisitor (analytics filtering)', () => {
  const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  function withOwnerEmails(value, fn) {
    const prev = process.env.THUMBGATE_OWNER_EMAILS;
    if (value === undefined) delete process.env.THUMBGATE_OWNER_EMAILS;
    else process.env.THUMBGATE_OWNER_EMAILS = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.THUMBGATE_OWNER_EMAILS;
      else process.env.THUMBGATE_OWNER_EMAILS = prev;
    }
  }

  it('classifies Googlebot as bot', () => {
    const result = classifyVisitor({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
    assert.equal(result.type, 'bot');
  });

  it('classifies GPTBot as bot', () => {
    const result = classifyVisitor({ headers: { 'user-agent': 'GPTBot/1.0' } });
    assert.equal(result.type, 'bot');
  });

  it('classifies real Chrome as real_user', () => {
    withOwnerEmails(undefined, () => {
      const result = classifyVisitor({ headers: { 'user-agent': CHROME_UA } });
      assert.equal(result.type, 'real_user');
    });
  });

  it('classifies a configured owner email as owner', () => {
    withOwnerEmails('Owner@Example.com, second@example.com', () => {
      const result = classifyVisitor({ headers: { 'user-agent': CHROME_UA }, email: 'owner@example.com' });
      assert.equal(result.type, 'owner');
      assert.ok(!result.reason.includes('owner@example.com'), 'reason must not echo the owner email');
    });
  });

  it('classifies nobody as owner when THUMBGATE_OWNER_EMAILS is unset', () => {
    withOwnerEmails(undefined, () => {
      assert.deepEqual(getOwnerEmails(), []);
      const result = classifyVisitor({ headers: { 'user-agent': CHROME_UA }, email: 'owner@example.com' });
      assert.equal(result.type, 'real_user');
    });
  });

  it('shouldExcludeFromAnalytics filters bots only', () => {
    assert.equal(shouldExcludeFromAnalytics({ headers: { 'user-agent': 'Googlebot/2.1' } }), true);
    assert.equal(shouldExcludeFromAnalytics({ headers: { 'user-agent': CHROME_UA } }), false);
  });

  it('bot patterns list covers key categories', () => {
    assert.ok(BOT_PATTERNS.length >= 20);
  });

  it('shipped module source contains no email address literals', () => {
    const source = fs.readFileSync(require.resolve('../scripts/bot-detection'), 'utf8');
    assert.ok(
      !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(source),
      'bot-detection.js is published to npm and must not hardcode personal emails',
    );
  });
});
