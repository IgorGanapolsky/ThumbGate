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
const MIN_POST_LENGTH = 30;
const MAX_POST_LENGTH = 2000;
function scanForSlop(postText) { const text = String(postText || ''); const findings = []; if (text.length < MIN_POST_LENGTH) findings.push({ id: 'too_short', reason: 'Too short' }); if (text.length > MAX_POST_LENGTH) findings.push({ id: 'too_long', reason: 'Too long' }); for (const p of BOT_SLOP_PATTERNS) { p.pattern.lastIndex = 0; if (p.pattern.test(text)) findings.push({ id: p.id, reason: p.reason }); } const words = text.split(/\s+/).filter(w => w.length > 3); const capsWords = words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w)); if (words.length > 5 && capsWords.length / words.length > 0.3) findings.push({ id: 'caps_shouting', reason: 'Too many ALL CAPS' }); return { allowed: findings.length === 0, findings, findingCount: findings.length, postLength: text.length }; }
function gatePost(postText) { const scan = scanForSlop(postText); if (!scan.allowed) { console.error('[social-quality-gate] BLOCKED:'); for (const f of scan.findings) console.error('  -', f.id, f.reason); } return scan; }
module.exports = { scanForSlop, gatePost, BOT_SLOP_PATTERNS, MIN_POST_LENGTH, MAX_POST_LENGTH };
