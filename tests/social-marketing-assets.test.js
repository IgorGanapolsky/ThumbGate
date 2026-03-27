const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('cursor plugin launch kit leads with repeated-mistake prevention and proof', () => {
  const cursorLaunch = read('docs/marketing/cursor-plugin-launch.md');
  const socialKit = read('docs/marketing/social-posts.md');

  assert.match(cursorLaunch, /Thumbs down a mistake|thumbs up.*good work/i);
  assert.match(cursorLaunch, /thumbs|feedback|mistake/i);
  assert.match(cursorLaunch, /Cursor Directory/i);
  assert.match(cursorLaunch, /Cursor Marketplace/i);
  assert.match(socialKit, /\[cursor-plugin-launch\.md\]/);
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
  const htmlPath = path.join(repoRoot, 'docs', 'marketing', 'assets', 'pre-action-gates-instagram-carousel.html');
  const captionPath = path.join(repoRoot, 'docs', 'marketing', 'assets', 'pre-action-gates-caption.txt');

  assert.match(socialKit, /\[social-automation\.md\]/);
  assert.match(automationDoc, /social:prepare/);
  assert.match(automationDoc, /social:publish:queue/);
  assert.match(automationDoc, /launchd/i);
  assert.match(assetReadme, /pre-action-gates-instagram-carousel\.html/);
  assert.equal(fs.existsSync(htmlPath), true);
  assert.equal(fs.existsSync(captionPath), true);
  assert.match(fs.readFileSync(htmlPath, 'utf8'), /15 Memory Tools\./);
  assert.match(fs.readFileSync(captionPath, 'utf8'), /Pre-Action Gates don't ask - they enforce\./);
});
