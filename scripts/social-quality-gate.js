#!/usr/bin/env node
'use strict';

const BOT_SLOP_PATTERNS = [
  { id: 'emoji_spam', pattern: /(?:🚀|💡|🔥|⚡|🎯|💪|🙌|👀){3,}/g, reason: 'Excessive emoji spam' },
  { id: 'generic_opener', pattern: /^(?:Just|Excited to|Thrilled to|Happy to|Proud to) (?:\w+ )*?(?:launch|ship|release|publish|built|creat|announc)/i, reason: 'Generic shipped opener' },
  { id: 'hashtag_spam', pattern: /#[A-Za-z]+(?:\s+#[A-Za-z]+){5,}/g, reason: 'Too many hashtags' },
  { id: 'engagement_bait', pattern: /(?:Like if you agree|Retweet if|Share this|Follow for more|Drop a .* in the comments|Who else)/i, reason: 'Engagement bait' },
  { id: 'thread_bait', pattern: /^(?:Thread|🧵|A thread on|Here are \d+ (?:ways|tips|tricks|things|reasons))/i, reason: 'Thread bait opener' },
  { id: 'ai_generated_tell', pattern: /(?:In today's rapidly evolving|In this comprehensive|Without further ado|It's worth noting that|At the end of the day)/i, reason: 'AI-generated phrasing' },
  { id: 'fake_urgency', pattern: /(?:Don't miss out|Act now|Limited time|Last chance|You won't believe)/i, reason: 'Fake urgency' },
  { id: 'self_congratulation', pattern: /(?:We're proud to|I'm honored to|Humbled to|Grateful to announce)/i, reason: 'Self-congratulatory opener' },
  { id: 'empty_hype', pattern: /(?:game.?changer|revolutionary|disruptive|next.?gen|cutting.?edge|world.?class|best.?in.?class)/i, reason: 'Empty hype words' },
];

const REPLY_TOPIC_PATTERNS = {
  skills: /\bskill|template|process|workflow|review|sprint|implement|phase/i,
  context: /\bcontext doc|context docs|conflicting|inconsisten|claude\.md|cursorrules|instruction/i,
  memory: /\bmemory|remember|amnesia|across sessions|next session|compaction|persist/i,
  setup: /\binstall|setup|config|init|repo|github|link|tool|open source|built/i,
  gates: /\bgate|hook|block|prevent|pretooluse|mcp/i,
};

const UNSOLICITED_PROMO_PATTERNS = [
  { id: 'unsolicited_link', pattern: /https?:\/\//i, reason: 'Unsolicited link in reply' },
  { id: 'unsolicited_install', pattern: /npx thumbgate init/i, reason: 'Unsolicited install CTA in reply' },
  { id: 'unsolicited_stack_dump', pattern: /\b(?:sqlite\+fts5|thompson sampling|pretooluse|mcp server)\b/i, reason: 'Unsolicited architecture dump in reply' },
];

const MIN_POST_LENGTH = 30;
const MAX_POST_LENGTH = 2000;

function scanForSlop(postText) {
  const text = String(postText || '');
  const findings = [];

  if (text.length < MIN_POST_LENGTH) {
    findings.push({ id: 'too_short', reason: 'Too short' });
  }

  if (text.length > MAX_POST_LENGTH) {
    findings.push({ id: 'too_long', reason: 'Too long' });
  }

  for (const rule of BOT_SLOP_PATTERNS) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      findings.push({ id: rule.id, reason: rule.reason });
    }
  }

  const words = text.split(/\s+/).filter((word) => word.length > 3);
  const capsWords = words.filter((word) => word === word.toUpperCase() && /[A-Z]/.test(word));
  if (words.length > 5 && capsWords.length / words.length > 0.3) {
    findings.push({ id: 'caps_shouting', reason: 'Too many ALL CAPS' });
  }

  return {
    allowed: findings.length === 0,
    findings,
    findingCount: findings.length,
    postLength: text.length,
  };
}

function detectReplyTopics(text) {
  const content = String(text || '');
  return Object.entries(REPLY_TOPIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(content))
    .map(([topic]) => topic);
}

function commentExplicitlyRequestsProduct(commentText) {
  return /\b(?:what tool|what is it|which tool|repo|github|link|where can i find|can you share|how do i install|setup details|what did you build)\b/i.test(
    String(commentText || '')
  );
}

function gateContextualReply(commentText, replyText, options = {}) {
  const scan = scanForSlop(replyText);
  const findings = [...scan.findings];
  const comment = String(commentText || '');
  const reply = String(replyText || '');
  const platform = String(options.platform || '').toLowerCase();
  const commentTopics = detectReplyTopics(comment);
  const replyTopics = detectReplyTopics(reply);

  if (commentTopics.length > 0 && !commentTopics.some((topic) => replyTopics.includes(topic))) {
    findings.push({
      id: 'not_contextual',
      reason: 'Reply does not address the commenter’s actual point',
    });
  }

  if (platform === 'reddit' && !commentExplicitlyRequestsProduct(comment)) {
    for (const rule of UNSOLICITED_PROMO_PATTERNS) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(reply)) {
        findings.push({ id: rule.id, reason: rule.reason });
      }
    }
  }

  return {
    allowed: findings.length === 0,
    findings,
    findingCount: findings.length,
    replyLength: reply.length,
    commentTopics,
    replyTopics,
  };
}

function gatePost(postText) {
  const scan = scanForSlop(postText);
  if (!scan.allowed) {
    console.error('[social-quality-gate] BLOCKED:');
    for (const finding of scan.findings) {
      console.error('  -', finding.id, finding.reason);
    }
  }
  return scan;
}

module.exports = {
  BOT_SLOP_PATTERNS,
  MAX_POST_LENGTH,
  MIN_POST_LENGTH,
  commentExplicitlyRequestsProduct,
  detectReplyTopics,
  gateContextualReply,
  gatePost,
  scanForSlop,
};
