const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PRODUCTHUNT_URL,
  getClaudePluginLatestDownloadUrl,
} = require('../scripts/distribution-surfaces');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('canonical social launch kit uses workflow-hardening positioning and links channel docs', () => {
  const content = read('docs/marketing/social-posts.md');
  assert.match(content, /Claude workflow hardening/i);
  assert.match(content, /one workflow, one owner, one proof pack/i);
  assert.match(content, /feedback -> retrieval -> prevention rules -> verification/i);
  assert.match(content, /\[linkedin-ai-reliability-post\.md\]/);
  assert.match(content, /\[x-launch-thread\.md\]/);
  assert.match(content, /\[reddit-posts\.md\]/);
});

test('channel docs carry the current workflow-hardening messaging', () => {
  const linkedin = read('docs/marketing/linkedin-ai-reliability-post.md');
  const xThread = read('docs/marketing/x-launch-thread.md');
  const reddit = read('docs/marketing/reddit-posts.md');
  assert.match(linkedin, /Workflow Hardening Sprint/i);
  assert.match(linkedin, /workflow-sprint-intake/i);
  assert.match(linkedin, /one workflow safe enough to ship/i);
  assert.match(xThread, /Claude workflow hardening/i);
  assert.match(xThread, /Workflow Hardening Sprint/i);
  assert.match(xThread, /workflow-sprint-intake/i);
  assert.match(xThread, /Not an "AI employee\."/);
  assert.match(reddit, /workflow hardening/i);
  assert.match(reddit, /workflow-sprint-intake/i);
  assert.match(reddit, /A system changes behavior\./);
});

test('reddit and community comment templates do not instruct canned CTA replies', () => {
  const redditKit = read('docs/marketing/reddit-posts.md');
  const programming = read('docs/marketing/reddit-programming-post.md');
  const localLlama = read('docs/marketing/reddit-locallama-post.md');
  const claudeCode = read('docs/marketing/reddit-claude-code-post.md');
  const cursor = read('docs/marketing/reddit-cursor-post.md');
  const devCommunity = read('docs/marketing/dev-community-comments.md');

  assert.match(redditKit, /Do not post a canned first comment/i);
  assert.match(programming, /Do not add a generic product comment/i);
  assert.match(localLlama, /Do not post a canned implementation comment/i);
  assert.match(claudeCode, /Do not drop a promo comment/i);
  assert.match(cursor, /Do not add a generic promo comment/i);
  assert.doesNotMatch(devCommunity, /https:\/\/github\.com\/IgorGanapolsky\/ThumbGate/i);
  assert.doesNotMatch(devCommunity, /Disclosure: I built this/i);
  assert.doesNotMatch(devCommunity, /Try free for 7 days/i);
});

test('cursor plugin launch kit leads with repeated-mistake prevention and proof', () => {
  const cursorLaunch = read('docs/marketing/cursor-plugin-launch.md');
  const socialKit = read('docs/marketing/social-posts.md');

  assert.match(cursorLaunch, /Thumbs down a mistake|thumbs up.*good work/i);
  assert.match(cursorLaunch, /thumbs|feedback|mistake/i);
  assert.match(cursorLaunch, /Cursor Directory/i);
  assert.match(cursorLaunch, /Cursor Marketplace/i);
  assert.match(socialKit, /\[cursor-plugin-launch\.md\]/);
});

test('product hunt launch kit links the live listing and the Claude plugin bundle', () => {
  const productHuntKit = read('docs/marketing/product-hunt-launch.md');

  assert.ok(productHuntKit.includes(PRODUCTHUNT_URL));
  assert.match(productHuntKit, /thumbs[\s-]?up|👍/i);
  assert.match(productHuntKit, /thumbs[\s-]?down|👎/i);
  assert.match(productHuntKit, new RegExp(getClaudePluginLatestDownloadUrl(repoRoot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(productHuntKit, /Claude plugin guide/i);
});

test('active launch playbooks retire X and route the operator to current channels', () => {
  const launchPlan = read('LAUNCH.md');
  const launchPosts = read('LAUNCH_POSTS.md');
  const battlePlan = read('FIRST_CUSTOMER_BATTLE_PLAN.md');

  assert.match(launchPlan, /X\/Twitter is retired from active distribution/i);
  assert.match(launchPlan, /utm_source=bluesky/i);
  assert.doesNotMatch(launchPosts, /utm_source=x/i);
  assert.match(launchPosts, /LinkedIn Founder Post/i);
  assert.match(launchPosts, /utm_source=linkedin/i);
  assert.match(battlePlan, /Do not use X\/Twitter/i);
  assert.match(battlePlan, /LinkedIn Founder Post/i);
  assert.match(battlePlan, /Deep_Ad1959/i);
});

test('private local SVG assets exist for LinkedIn carousel and X card', () => {
  const assetDir = path.join(repoRoot, 'docs/marketing/assets');
  const assetFiles = [
    'ai-reliability-system-linkedin-slide-01.svg',
    'ai-reliability-system-linkedin-slide-02.svg',
    'ai-reliability-system-linkedin-slide-03.svg',
    'ai-reliability-system-linkedin-slide-04.svg',
    'ai-reliability-system-linkedin-slide-05.svg',
    'ai-reliability-system-linkedin-slide-06.svg',
    'ai-reliability-system-x-card.svg'
  ];

  for (const assetFile of assetFiles) {
    const assetPath = path.join(assetDir, assetFile);
    assert.equal(fs.existsSync(assetPath), true, `${assetFile} should exist`);
    assert.match(fs.readFileSync(assetPath, 'utf8'), /<svg/);
  }
});

test('zero-filming automation docs and canonical IG/TikTok assets exist', () => {
  const socialKit = read('docs/marketing/social-posts.md');
  const automationDoc = read('docs/marketing/social-automation.md');
  const assetReadme = read('docs/marketing/assets/README.md');
  const htmlPath = path.join(repoRoot, 'docs', 'marketing', 'assets', 'pre-action-checks-instagram-carousel.html');
  const captionPath = path.join(repoRoot, 'docs', 'marketing', 'assets', 'pre-action-checks-caption.txt');

  assert.match(socialKit, /\[social-automation\.md\]/);
  assert.match(automationDoc, /social:prepare/);
  assert.match(automationDoc, /social:publish:queue/);
  assert.match(automationDoc, /launchd/i);
  assert.match(assetReadme, /pre-action-checks-instagram-carousel\.html/);
  assert.equal(fs.existsSync(htmlPath), true);
  assert.equal(fs.existsSync(captionPath), true);
  assert.match(fs.readFileSync(htmlPath, 'utf8'), /15 Memory Tools\./);
  assert.match(fs.readFileSync(captionPath, 'utf8'), /Pre-Action Checks don't ask - they enforce\./);
});
