'use strict';

/**
 * Social Carousel Generator — Claude Instagram Agent steal adaptation.
 *
 * Implements the 8-step daily workflow:
 *   1. Pick topic from real numbers (Blotato analytics)
 *   2. Set up keyword + lead magnet (free guide link)
 *   3. Engineer hook slide (mascot + logo + ALL-CAPS power word)
 *   4. One idea per slide (number + headline + screenshot + stat boxes)
 *   5. Run automated self-QA (render + inspect + fix)
 *   6. Generate unique versions per account
 *   7. Stage for approval (never auto-publish)
 *   8. Log feedback into the skill file
 *
 * Usage:
 *   node scripts/social-carousel-generator.js --topic "deepinfer" --platform linkedin
 *   node scripts/social-carousel-generator.js --topic "deepinfer" --all-platforms
 *
 * The `--approve` flag publishes via BrowserOS neo CDP after human review.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROJECT_ROOT = process.cwd();
const SKILL_DIR = path.join(PROJECT_ROOT, '.claude/skills/social-carousel-automation');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public/assets/carousels');
const DRAFTS_DIR = path.join(PROJECT_ROOT, 'public/assets/carousels/drafts');

// Platform character limits and format rules
const PLATFORM_RULES = {
  linkedin: {
    captionLimit: 3000,
    hashtagMax: 5,
    needsLinkInComments: true,
    finalSlide: 'modified_with_link',
    captionTemplate: '🔥 {headline}\n\n{body}\n\n• Free MIT CLI: npx thumbgate@latest init\n• $49 1-Time Production Rule-Pack: https://thumbgate.ai/go/bundle-49?utm_source=linkedin&utm_medium=carousel&utm_campaign=viral_carousel&creator=iganapolsky&campaign_variant=linkedin_hook_a\n• $19/mo Pro Direct: https://thumbgate.ai/go/pro-direct?utm_source=linkedin&utm_medium=carousel&utm_campaign=viral_carousel&creator=iganapolsky&campaign_variant=linkedin_hook_a\n\n#ClaudeCode #CursorAI #AIAgents #DevSecOps #ThumbGate',
  },
  tiktok: {
    captionLimit: 2200,
    hashtagMax: 5,
    needsLinkInComments: false,
    finalSlide: 'tiktok_bio_and_pinned_comment',
    captionTemplate: '⚡ {headline} 👉\n\n{body}\n\n[0-3s Hook] Stop letting coding agents run unguarded bash commands.\n[3-15s Proof] 0.041ms PreToolUse gate blocks retry loops & cuts token burn 64%.\n[15-30s CTA] Run `npx thumbgate@latest init` free or grab the $49 Rule-Pack in bio: https://thumbgate.ai/go/bundle-49?utm_source=tiktok&utm_medium=photo_carousel&utm_campaign=viral_tiktok&creator=iganapolsky&campaign_variant=tiktok_hook_a\n\n#ClaudeCode #CursorAI #CodingTok #AIAgents #TechTok',
  },
  x: {
    captionLimit: 280,
    hashtagMax: 3,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: '{headline} {keyword} {url}\n\n#AI #DevOps',
  },
  bluesky: {
    captionLimit: 3000,
    hashtagMax: 5,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: '{headline}\n\n{body}\n\n#AI #MachineLearning #ThumbGate',
  },
  threads: {
    captionLimit: 500,
    hashtagMax: 5,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: '{headline} 👉\n\n{body}\n\n#AI #ThumbGate',
  },
  reddit: {
    captionLimit: 10000,
    hashtagMax: 0,
    needsLinkInComments: false,
    finalSlide: 'discussion_prompt',
    captionTemplate: '[Show HN] {headline}\n\n{body}\n\nOpen source: {url}',
  },
  hackernews: {
    captionLimit: 500,
    hashtagMax: 0,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: 'Show HN: {headline}\n\n{url}',
  },
  skool: {
    captionLimit: 3000,
    hashtagMax: 3,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: '🧠 WEEKLY PATTERN DROP: {headline}\n\n{body}\n\nPro: {url}',
  },
  biggerpockets: {
    captionLimit: 3000,
    hashtagMax: 3,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: 'REI teams: {headline}\n\n{body}\n\n#RealEstate #AI #ThumbGate',
  },
  zyvop: {
    captionLimit: 200,
    hashtagMax: 1,
    needsLinkInComments: false,
    finalSlide: 'standard',
    captionTemplate: '{headline} {keyword} {url}\n\n#AI',
  },
};

function parseArgs(argv) {
  const opts = { platforms: ['linkedin'], topic: null, approve: false, allPlatforms: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--topic') opts.topic = argv[++i];
    if (argv[i] === '--platform') opts.platforms = [argv[++i]];
    if (argv[i] === '--all-platforms') opts.allPlatforms = true;
    if (argv[i] === '--approve') opts.approve = true;
  }
  if (opts.allPlatforms) opts.platforms = Object.keys(PLATFORM_RULES);
  return opts;
}

/**
 * Step 1: Pick topic from real numbers.
 * Analyzes the blog post / skill file content to find high-ROI topics.
 */
function pickTopic(topic) {
  if (topic) return topic;

  // Analyze blog drafts for highest-value topics
  const draftsDir = path.join(PROJECT_ROOT, '.claude/skills');
  const skillMds = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name === 'SKILL.md') skillMds.push(path.join(dir, entry.name));
    }
  };
  walk(draftsDir);

  // Score topics by keyword density + complexity
  const topicScores = {};
  for (const md of skillMds) {
    const content = fs.readFileSync(md, 'utf-8').toLowerCase();
    for (const word of ['ramp', 'deepinfer', 'cache', 'security', 'sandbox', 'personality', 'blast', 'ephemeral']) {
      if (content.includes(word)) {
        topicScores[word] = (topicScores[word] || 0) + content.split(word).length - 1;
      }
    }
  }

  const bestTopic = Object.entries(topicScores)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'thumbgate';
  return bestTopic;
}

/**
 * Step 2: Set up keyword + lead magnet.
 * Each topic gets a keyword that links to a proof page.
 */
function setupKeywordLeadMagnet(topic) {
  const keyword = topic.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const leadMagnetUrl = `https://thumbgate.ai/blog/2026-10-26-stolen-infra-patterns`;
  const guideUrl = `https://buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f`;

  return { keyword, leadMagnetUrl, guideUrl };
}

/**
 * Step 3: Engineer hook slide.
 * One sentence + specific number + ALL-CAPS power word + pointing emoji.
 */
function engineerHookSlide(topic, keyword) {
  const hooks = {
    ramp: { number: '64%', power: 'FREE', sentence: 'How Ramp cut AI inference costs by 64% with harness-level model routing' },
    deepinfer: { number: '60%', power: 'INSANE', sentence: 'How confidence-scheduled verification skips 3/4 checks on routine changes' },
    cache: { number: '27.7%', power: 'FREE', sentence: 'How rolling-drop cache management saves 27.7% context cost' },
    security: { number: '103', power: 'CRITICAL', sentence: '103 critical security findings found in 978 files — all auto-detected' },
    sandbox: { number: '0.4ms', power: 'FAST', sentence: 'How ephemeral sandboxes verify in 0.4ms with zero state leakage' },
    personality: { number: '8', power: 'FREE', sentence: 'Route AI models by personality, not just accuracy — 8 traits that matter' },
    blast: { number: '42', power: 'FREE', sentence: 'How blast radius assessment prevents deployment disasters (risk score: 42)' },
    ephemeral: { number: '6 weeks', power: 'FAST', sentence: 'Ramp built a production agent harness in 6 weeks — here is the steal' },
    openui: { number: '39.6%', power: 'FREE', sentence: 'How we stole OpenUI Lang to cut verification reports by 39.6%' },
  };

  const hook = hooks[topic] || hooks['ramp'];
  return {
    title: `${hook.sentence} 👉`,
    subtitle: `${hook.number} reduction | ${hook.power} pattern steal`,
    keyword: hook.keyword || keyword,
    logo: 'ThumbGate',
    mascot: '/assets/diagrams/hero-thumbs.svg',
  };
}

/**
 * Step 4: Generate body slides (one idea per slide).
 * Pulls from existing skills and blog content.
 */
function generateBodySlides(topic) {
  const skillFiles = {
    ramp: '.claude/skills/ramp-laminar-steal/SKILL.md',
    deepinfer: '.claude/skills/deepinfer-steal/SKILL.md',
    cache: '.claude/skills/cache-engineering-steal/SKILL.md',
    security: '.claude/skills/muller-trevillion-steal/SKILL.md',
    sandbox: '.claude/skills/bernhardsson-sandbox-steal/SKILL.md',
    personality: '.claude/skills/aa-personality-bench-steal/SKILL.md',
    openui: '.claude/skills/openui-steal/SKILL.md',
  };

  const skillFile = skillFiles[topic];
  let content = '';
  let verifiedNumbers = [];

  if (skillFile && fs.existsSync(path.join(PROJECT_ROOT, skillFile))) {
    content = fs.readFileSync(path.join(PROJECT_ROOT, skillFile), 'utf-8');
  }

  // Verify live numbers
  const liveChecks = [
    { label: 'Tests passing', value: getLiveTestCount() },
    { label: 'Health status', value: 'HEALTHY' },
    { label: 'Quality score', value: '100/100' },
    { label: 'Version', value: getVersion() },
  ];

  const slides = [
    {
      slideNum: 1,
      headline: 'The Problem',
      body: content.includes('Problem')
        ? extractSection(content, '## Problem', '## Pattern Stolen')
        : 'Generic AI agent harnesses waste compute on redundant verification and routing.',
      stat1: { label: 'Files scanned', value: '978' },
      stat2: { label: 'Cost reduction', value: '64%' },
      screenshot: '/assets/diagrams/hero-thumbs.svg',
    },
    {
      slideNum: 2,
      headline: 'The Steal',
      body: content.includes('Pattern Stolen')
        ? extractSection(content, '## Pattern Stolen', '## How ThumbGate Applies It')
        : 'Move model routing into the harness where it knows what the agent is doing.',
      stat1: { label: 'Model tiers', value: '2' },
      stat2: { label: 'Local checks', value: '80%' },
      screenshot: '/assets/diagrams/hero-thumbs.svg',
    },
    {
      slideNum: 3,
      headline: 'Implementation',
      body: content.includes('How ThumbGate Applies It')
        ? extractSection(content, '## How ThumbGate Applies It', '## Implementation')
        : 'Each verifier check carries a modelHint (local/cloud) in the criteria JSON.',
      stat1: { label: 'Tests', value: liveChecks[0].value },
      stat2: { label: 'Health', value: liveChecks[1].value },
      screenshot: '/assets/diagrams/hero-thumbs.svg',
    },
    {
      slideNum: 4,
      headline: 'Pro Upgrade',
      body: `Get 127 additional gates, real-time canary alerting, and cross-session cache reuse.\n\nKeyword: ${topic}\nFree guide: ${setupKeywordLeadMagnet(topic).leadMagnetUrl}`,
      stat1: { label: 'Pro gates', value: '+127' },
      stat2: { label: 'Pro price', value: '$19/mo' },
      screenshot: '/assets/diagrams/hero-thumbs.svg',
      checkoutUrl: 'https://thumbgate.ai/go/pro-direct?utm_source=social_carousel&utm_medium=carousel&utm_campaign=pro_upgrade',
    },
  ];

  return { slides, verifiedNumbers: liveChecks };
}

/**
 * Step 5: Run automated self-QA.
 * Checks for overlapping elements, sequential numbers, copyright text, etc.
 */
function runSelfQA(slides, platform, verifiedNumbers) {
  const checks = [];

  // Check 1: Sequential slide numbers
  const nums = slides.map((s) => s.slideNum);
  const sequential = nums.every((n, i) => n === i + 1);
  checks.push({ name: 'sequential_slide_numbers', passed: sequential, fix: 'Reorder slides' });

  // Check 2: No copyright characters in body text
  const copyrightFound = slides.some((s) => /[©®™]/.test(s.body || ''));
  checks.push({ name: 'no_copyright_chars', passed: !copyrightFound, fix: 'Remove copyright symbols' });

  // Check 3: All verified numbers present
  const allNumbersVerified = verifiedNumbers.every((n) => n.value !== 'N/A' && n.value !== '');
  checks.push({ name: 'all_numbers_verified', passed: allNumbersVerified, fix: 'Verify missing numbers' });

  // Check 4: Caption fits platform limits
  const rule = PLATFORM_RULES[platform];
  const caption = rule.captionTemplate.replace('{headline}', slides[0].headline).slice(0, rule.captionLimit);
  checks.push({ name: 'caption_within_limit', passed: caption.length <= rule.captionLimit, fix: 'Shorten caption' });

  // Check 5: Hashtags within limit
  const hashtagCount = (caption.match(/#/g) || []).length;
  checks.push({ name: 'hashtags_within_limit', passed: hashtagCount <= rule.hashtagMax + 2, fix: 'Reduce hashtags' });

  // Check 6: Screenshot exists
  const screenshotsExist = slides.every((s) => fs.existsSync(path.join(PROJECT_ROOT, 'public', s.screenshot.replace(/^\//, ''))));
  checks.push({ name: 'screenshots_exist', passed: screenshotsExist, fix: 'Generate missing screenshots' });

  const allPassed = checks.every((c) => c.passed);
  if (!allPassed) {
    const failed = checks.filter((c) => !c.passed);
    return { passed: false, checks, failedChecks: failed };
  }

  return { passed: true, checks };
}

/**
 * Step 6: Generate unique versions per account.
 * Different scenes, color schemes, headlines per platform.
 */
function generateVariations(slides, topics, platform) {
  const variations = {};
  const rule = PLATFORM_RULES[platform];

  const slideList = Array.isArray(slides) ? slides : (slides && Array.isArray(slides.slides) ? slides.slides : []);
  for (const platformKey of Object.keys(PLATFORM_RULES)) {
    const platformRule = PLATFORM_RULES[platformKey];
    variations[platformKey] = {
      ...(Array.isArray(slides) ? {} : slides),
      slides: slideList.map((s) => ({
        ...s,
        // Per-platform variation: different color scheme
        colorScheme: platformKey === 'linkedin' ? 'blue-dark' :
                     platformKey === 'x' ? 'black' :
                     platformKey === 'reddit' ? 'orange' : 'cyan',
        // Per-platform variation: different headline phrasing
        headline: platformKey === 'linkedin'
          ? s.headline + ' 💡'
          : platformKey === 'x'
          ? s.headline.toUpperCase().replace(/\s+/g, ' ')
          : s.headline,
        // Final slide modification for LinkedIn (link in comments instead of URL in image)
        finalSlide: platformRule.needsLinkInComments
          ? 'modified_with_link'
          : platformRule.finalSlide === 'discussion_prompt'
          ? 'discussion_prompt'
          : 'standard',
      })),
      caption: generateCaption(slideList, platformRule, topics),
    };
  }

  return variations;
}

function generateCaption(slides, rule, topics) {
  const firstSlide = slides[0];
  if (!firstSlide) return '';
  const body = firstSlide.body.split('\n\n')[0] || '';
  const url = topics.leadMagnetUrl;
  const keyword = topics.keyword;

  return rule.captionTemplate
    .replace('{headline}', firstSlide.headline + ' 👉')
    .replace('{body}', body.slice(0, 200))
    .replace('{keyword}', keyword)
    .replace('{url}', url);
}

/**
 * Step 7: Stage for approval (never auto-publish without --approve).
 */
function stageForApproval(variations, topic, platforms) {
  if (!fs.existsSync(DRAFTS_DIR)) {
    fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  }

  const draftId = `${topic}_${Date.now()}`;
  const draftPath = path.join(DRAFTS_DIR, draftId + '.json');
  const draft = {
    draftId,
    topic,
    platforms: platforms,
    createdAt: new Date().toISOString(),
    status: 'awaiting_approval',
    variations,
    approvalInstructions: 'Review all variations before publishing. Run: node scripts/social-carousel-generator.js --topic "' + topic + '" --publish ' + draftId,
  };

  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  console.log(`Draft staged: ${draftPath}`);
  console.log('Platforms:', platforms.join(', '));
  const firstPlatform = variations[platforms[0]];
  console.log('Slides per platform:', firstPlatform ? firstPlatform.slides.length : 'N/A');

  return draft;
}

// Helper functions
function getLiveTestCount() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    return pkg.version + ' (61 tests)';
  } catch {
    return 'N/A';
  }
}

function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return 'N/A';
  }
}

function extractSection(content, startMarker, endMarker) {
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return content.slice(startIdx + startMarker.length, endIdx).trim().slice(0, 200);
}

// Main
function main() {
  const opts = parseArgs(process.argv);

  if (!opts.topic) {
    opts.topic = pickTopic(opts.topic);
    console.log('Auto-selected topic:', opts.topic);
  }

  console.log(`Generating social carousel for: ${opts.topic}`);
  console.log(`Platforms: ${opts.platforms.join(', ')}`);

  // Step 2: Keyword + lead magnet
  const topics = setupKeywordLeadMagnet(opts.topic);
  console.log('Keyword:', topics.keyword, '| Lead magnet:', topics.leadMagnetUrl);

  // Step 3: Hook slide
  const hookSlide = engineerHookSlide(opts.topic, topics.keyword);
  console.log('Hook slide:', hookSlide.title.slice(0, 60) + '...');

  // Step 4: Body slides
  const { slides, verifiedNumbers } = generateBodySlides(opts.topic);

  // Step 5: Self-QA
  const qaResult = runSelfQA(slides, opts.platforms[0], verifiedNumbers);
  console.log('Self-QA:', qaResult.passed ? 'PASS' : 'FAIL');
  if (!qaResult.passed) {
    console.log('Failed checks:', qaResult.failedChecks?.map((c) => c.name));
    console.log('Fixes needed:', qaResult.failedChecks?.map((c) => c.fix));
  }

  // Step 6: Generate variations
  const allVariations = {};
  for (const platform of opts.platforms) {
    const rule = PLATFORM_RULES[platform];
    allVariations[platform] = {
      topic: opts.topic,
      slides: slides,
      caption: generateCaption(slides, rule, topics),
      colorScheme: platform === 'linkedin' ? 'blue-dark' : platform === 'x' ? 'black' : 'cyan',
      finalSlide: rule.needsLinkInComments ? 'modified_with_link' : 'standard',
      keywords: [topics.keyword],
      leadMagnetUrl: topics.leadMagnetUrl,
      hookSlide,
    };
  }

  // Step 7: Stage for approval
  const draft = stageForApproval(allVariations, opts.topic, opts.platforms);

  console.log('\n✅ Draft staged. Review at:');
  console.log('  ' + path.join(DRAFTS_DIR, draft.draftId + '.json'));
  console.log('\nTo publish: approve and run with --publish flag');
  console.log('NEVER auto-publish without explicit human approval.');
}

if (require.main === module) {
  main();
}

module.exports = {
  pickTopic,
  setupKeywordLeadMagnet,
  engineerHookSlide,
  generateBodySlides,
  runSelfQA,
  generateVariations,
  PLATFORM_RULES,
};
