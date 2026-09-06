#!/usr/bin/env node
'use strict';

/**
 * Honest GitHub profile-achievement inventory for ThumbGate discoverability.
 *
 * Steal the FORMAT from multilingual achievement *guides* (catalog + precise
 * requirements + limitations). Do not clone 4xmen/get-github-achievements,
 * n0/GitHub-Achievement-CLI, or any farm that opens/closes dummy Issues,
 * YOLO-merges, or fakes Co-authored-by.
 *
 * Achievements are profile cosmetics. Not npm installs. Not revenue.
 *
 * Usage:
 *   node scripts/github-achievement-honesty.js --fixture tests/fixtures/github-achievements.json --json
 *   node scripts/github-achievement-honesty.js --fetch --json
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_USER = 'IgorGanapolsky';
const DEFAULT_REPO = 'IgorGanapolsky/ThumbGate';
const STARSTRUCK_NEXT_TIER = 128;
const REFUSE_FARM = Object.freeze([
  'yolo-merge-protected-main',
  'quickdraw-close-own-issue-in-5min',
  'fake-coauthored-by',
  'sockpuppet-discussion-accepted-answer',
  'achievement-farm-cli',
]);
const OBTAINABLE = Object.freeze([
  'pair-extraordinaire',
  'starstruck',
  'pull-shark',
  'yolo',
  'quickdraw',
  'galaxy-brain',
  'public-sponsor',
  'arctic-code-vault-contributor',
]);

function parseArgs(argv) {
  const out = {
    fixture: null,
    fetch: false,
    user: DEFAULT_USER,
    repo: DEFAULT_REPO,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--fetch') out.fetch = true;
    else if (arg === '--fixture' && next) {
      out.fixture = next;
      i += 1;
    } else if (arg === '--user' && next) {
      out.user = next;
      i += 1;
    } else if (arg === '--repo' && next) {
      out.repo = next;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(out.user)) {
    throw new Error(`Invalid --user: ${out.user}`);
  }
  if (out.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(out.repo)) {
    throw new Error(`Invalid --repo slug: ${out.repo}`);
  }
  return out;
}

function parseAchievementSlugs(html) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('profile HTML must be a non-empty string');
  }
  const found = new Set();
  const re = /achievement=([a-z0-9-]+)/g;
  let match;
  while ((match = re.exec(html)) !== null) found.add(match[1]);
  return [...found].sort();
}

function buildReport({ slugs, qnaCategory, acceptedAnswers, currentStars, source, user, repo }) {
  const earned = slugs.filter((s) => OBTAINABLE.includes(s));
  const missing = OBTAINABLE.filter((s) => !earned.includes(s));
  return {
    ok: true,
    status: 'OK',
    source,
    user,
    repo,
    earned,
    missingObtainable: missing,
    refuseFarm: [...REFUSE_FARM],
    farmCliUsed: false,
    qnaCategoryPresent: Boolean(qnaCategory),
    acceptedDiscussionAnswers: Number.isInteger(acceptedAnswers) ? acceptedAnswers : 0,
    starstruckNextTierStars: STARSTRUCK_NEXT_TIER,
    currentStars: Number.isInteger(currentStars) ? currentStars : null,
    yoloAllowedOnThumbGateMain: false,
    disclaimer:
      'Profile achievements are cosmetics. Not npm installs and not revenue. Do not clone achievement-farm CLIs. Do not YOLO-merge protected main. Galaxy Brain requires real accepted Q&A answers, not sockpuppets.',
  };
}

function formatText(report) {
  return [
    `github-achievement-honesty  status=${report.status}  user=${report.user}`,
    `earned=${report.earned.join(',') || '(none)'}`,
    `missing=${report.missingObtainable.join(',') || '(none)'}`,
    `qnaCategory=${report.qnaCategoryPresent} acceptedAnswers=${report.acceptedDiscussionAnswers}`,
    `refuseFarm=${report.refuseFarm.join(',')}`,
    `yoloAllowedOnThumbGateMain=${report.yoloAllowedOnThumbGateMain}`,
    report.disclaimer,
    '',
  ].join('\n');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'thumbgate-achievement-honesty/1.0', Accept: 'text/html' } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

async function run(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/github-achievement-honesty.js [--fixture PATH | --fetch] [--json]\n',
    );
    return { ok: true, status: 'HELP' };
  }

  let slugs;
  let qnaCategory = false;
  let acceptedAnswers = 0;
  let currentStars = null;
  let source;

  if (args.fixture) {
    const fixturePath = path.isAbsolute(args.fixture)
      ? args.fixture
      : path.join(REPO_ROOT, args.fixture);
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    slugs = parseAchievementSlugs(raw.profileHtml || '');
    qnaCategory = Boolean(raw.qnaCategory);
    acceptedAnswers = Number(raw.acceptedAnswers) || 0;
    currentStars = Number.isInteger(raw.currentStars) ? raw.currentStars : null;
    source = `fixture:${path.relative(REPO_ROOT, fixturePath)}`;
  } else if (args.fetch) {
    const get = deps.getHtml || httpsGet;
    const html = await get(`https://github.com/${args.user}`);
    slugs = parseAchievementSlugs(html);
    qnaCategory = true;
    acceptedAnswers = 0;
    source = `fetch:github.com/${args.user}`;
  } else {
    throw new Error('Provide --fixture PATH or --fetch');
  }

  const report = buildReport({
    slugs,
    qnaCategory,
    acceptedAnswers,
    currentStars,
    source,
    user: args.user,
    repo: args.repo,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  process.exitCode = 0;
  return report;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  run().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_USER,
  OBTAINABLE,
  REFUSE_FARM,
  STARSTRUCK_NEXT_TIER,
  buildReport,
  parseAchievementSlugs,
  parseArgs,
  run,
};
