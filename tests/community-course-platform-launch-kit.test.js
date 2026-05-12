const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('community course platform launch kit covers requested course and community surfaces', () => {
  const kit = read('docs/marketing/community-course-platform-launch-kit.md');
  const requiredPlatforms = [
    'Skool',
    'Kajabi',
    'Thinkific',
    'Teachable',
    'Podia',
    'Mighty Networks',
    'Circle',
    'LearnWorlds',
    'Udemy',
    'Skillshare',
    'YouTube paid/subscribe',
  ];

  for (const platform of requiredPlatforms) {
    assert.match(kit, new RegExp(platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  assert.match(kit, /utm_medium=community_course/);
  assert.match(kit, /operator_lab_launch/);
  assert.match(kit, /10 useful repeated-failure posts or 3 qualified sprint conversations/i);
});

test('community course platform launch kit keeps paid expansion claim-safe', () => {
  const kit = read('docs/marketing/community-course-platform-launch-kit.md');

  assert.match(kit, /Do not publish or schedule public posts without explicit operator confirmation/i);
  assert.match(kit, /Do not claim revenue, users, installs, or customer outcomes unless the current evidence files prove them/i);
  assert.match(kit, /Pricing and eligibility are volatile/i);
  assert.match(kit, /re-check the linked source before entering a card, buying ads, or publishing a paid listing/i);
  assert.doesNotMatch(kit, /guaranteed revenue|guaranteed students|guaranteed members|guaranteed installs/i);
});
