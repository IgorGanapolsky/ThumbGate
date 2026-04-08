const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scanForSlop,
  gateContextualReply,
  gatePost,
  BOT_SLOP_PATTERNS,
} = require('../scripts/social-quality-gate');
test('has 9+ patterns', () => { assert.ok(BOT_SLOP_PATTERNS.length >= 9); });
test('allows genuine post', () => { assert.equal(scanForSlop('I built an MCP server that stops coding agents from repeating mistakes. Every thumbs-down becomes a prevention rule.\nnpx thumbgate init\nhttps://github.com/IgorGanapolsky/ThumbGate').allowed, true); });
test('blocks emoji spam', () => { assert.equal(scanForSlop('Check out! 🚀🚀🚀🔥🔥🔥 Amazing!').allowed, false); });
test('blocks generic opener', () => { assert.equal(scanForSlop('Excited to announce we just shipped our new product!').allowed, false); });
test('blocks hashtag spam', () => { assert.equal(scanForSlop('Great! #AI #ML #Dev #Code #Agent #MCP #LLM #Open').allowed, false); });
test('blocks engagement bait', () => { assert.equal(scanForSlop('Like if you agree that AI agents need better safety!').allowed, false); });
test('blocks AI phrasing', () => { assert.equal(scanForSlop("In today's rapidly evolving AI landscape we present a novel approach.").allowed, false); });
test('blocks fake urgency', () => { assert.equal(scanForSlop("Don't miss out on our latest release — limited time!").allowed, false); });
test('blocks hype', () => { assert.equal(scanForSlop('Our revolutionary game-changer disrupts the space.').allowed, false); });
test('blocks too short', () => { assert.equal(scanForSlop('Check this!').allowed, false); });
test('allows few hashtags', () => { assert.equal(scanForSlop('Built a pre-action gate system for AI agents. Thompson Sampling adapts which rules fire.\n#ThumbGate #AIAgents #MCP').allowed, true); });
test('our tweet passes', () => { assert.equal(scanForSlop('I built an open-source MCP server that stops AI coding agents from repeating mistakes.\n\nEvery 👎 → prevention rule → gate → blocked.\n\nMore errors = stronger gates.\n\nnpx thumbgate init\nhttps://github.com/IgorGanapolsky/ThumbGate\n\n#ThumbGate #ClaudeCode #AIAgents').allowed, true); });
test('gatePost works same as scanForSlop', () => { assert.equal(gatePost('Good genuine post about work.').allowed, scanForSlop('Good genuine post about work.').allowed); });
test('blocks unsolicited reddit CTA replies', () => {
  const result = gateContextualReply(
    'I have found that smaller skills and less conflicting context works better.',
    'I built ThumbGate. Try it: npx thumbgate init https://github.com/IgorGanapolsky/ThumbGate',
    { platform: 'reddit' }
  );
  assert.equal(result.allowed, false);
  assert.ok(result.findings.some((finding) => finding.id === 'unsolicited_link'));
});
test('blocks reply that ignores the commenter point', () => {
  const result = gateContextualReply(
    'The biggest issue for me is conflicting context docs and too many review steps.',
    'The short version is that gates block bad actions before execution.',
    { platform: 'reddit' }
  );
  assert.equal(result.allowed, false);
  assert.ok(result.findings.some((finding) => finding.id === 'not_contextual'));
});
test('allows contextual reddit reply without promo', () => {
  const result = gateContextualReply(
    'I have found that having skills that define specific processes works better, especially when context docs do not conflict.',
    'That matches what I have seen too. Smaller review and implement phases hold up much better than one giant instruction blob, and conflicting context docs are where things usually start drifting.',
    { platform: 'reddit' }
  );
  assert.equal(result.allowed, true);
});
