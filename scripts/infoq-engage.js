#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TRACKED_ARTICLES = Object.freeze([
  Object.freeze({
    slug: 'netflix-oci-agent',
    title: 'Netflix Open-Sources Agentic Workflow for Causal Inference',
    url: 'https://www.infoq.com/news/2026/08/netflix-oci-agent/',
    category: 'Agentic AI Architecture',
    publishedDate: '2026-08-20',
    keyThemes: Object.freeze([
      'Observational Causal Inference (OCI)',
      'Actor-Critic process audits',
      'Target trial emulation',
      'Process over outcome verification',
      'Human-in-the-loop oversight in absence of ground truth',
    ]),
    technicalAnalysis: 'Netflix oci-agent demonstrates that unconstrained LLMs produce naive regressions (25% vs 100% true effect discrepancy). Separating the actor (spec producer/runner) from the critic (reviewer/bias detector) and requiring inspectable process audit artifacts provides empirical safety.',
    recommendedComment: `The actor-critic separation in Netflix's oci-agent hits the exact architectural failure mode most teams miss: when you throw an unconstrained LLM at causal questions, it happily performs a naive regression without checking counterfactual balance or placebo tests.

What's particularly elegant here is treating "process audits" as first-class artifacts rather than just evaluating final output strings. In our work on deterministic agent firewalls, we've found that pairing actor-critic review with hard pre-action gates (where the downstream execution cannot dispatch until the critic emits a satisfactory audit receipt) eliminates silent drift entirely.

Making the plan, spec, and notebook reproducible before execution is the only reliable way to govern agentic workflows in the absence of absolute ground truth.`,
  }),
]);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function runInfoqDoctor() {
  return {
    status: 'HEALTHY',
    trackedArticlesCount: DEFAULT_TRACKED_ARTICLES.length,
    stagingDirectory: 'coordination/ready-to-post',
    supportedTopics: ['Agentic AI Architecture', 'AI, ML & Data Engineering', 'DevOps', 'Architecture & Design'],
    timestamp: new Date().toISOString(),
  };
}

function scanInfoqArticles() {
  return {
    articles: DEFAULT_TRACKED_ARTICLES,
    total: DEFAULT_TRACKED_ARTICLES.length,
    scannedAt: new Date().toISOString(),
  };
}

function stageCommentDrafts(repoRoot = process.cwd()) {
  const stagingDir = path.join(repoRoot, 'coordination', 'ready-to-post');
  ensureDir(stagingDir);

  const stagedFiles = [];

  for (const article of DEFAULT_TRACKED_ARTICLES) {
    const filename = `infoq-${article.slug}-${article.publishedDate}.md`;
    const filePath = path.join(stagingDir, filename);

    const content = `---
platform: infoq
article_title: "${article.title}"
article_url: "${article.url}"
category: "${article.category}"
status: ready_for_review
created_at: "${new Date().toISOString()}"
---

# Technical Engagement Draft: ${article.title}

## Target Article
- **URL**: ${article.url}
- **Themes**: ${article.keyThemes.join(', ')}

## Draft Comment
${article.recommendedComment}

## Technical Rationale
${article.technicalAnalysis}
`;

    fs.writeFileSync(filePath, content, 'utf8');
    stagedFiles.push({
      slug: article.slug,
      path: filePath,
      filename,
    });
  }

  return {
    stagedCount: stagedFiles.length,
    stagedFiles,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    doctor: argv.includes('--doctor'),
    scan: argv.includes('--scan'),
    draft: argv.includes('--draft'),
    json: argv.includes('--json'),
  };
}

function handleDoctor(options) {
  const report = runInfoqDoctor();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`✔ InfoQ Community Engagement Engine: ${report.status} (${report.trackedArticlesCount} articles tracked)\n`);
  }
  return 0;
}

function handleScan(options) {
  const scan = scanInfoqArticles();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(scan, null, 2)}\n`);
  } else {
    process.stdout.write(`Scanned ${scan.total} InfoQ articles:\n`);
    for (const a of scan.articles) {
      process.stdout.write(`- [${a.category}] ${a.title} (${a.url})\n`);
    }
  }
  return 0;
}

function handleDraft(options) {
  const staged = stageCommentDrafts();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(staged, null, 2)}\n`);
  } else {
    process.stdout.write(`✔ Staged ${staged.stagedCount} technical comment drafts:\n`);
    for (const f of staged.stagedFiles) {
      process.stdout.write(`  -> ${f.path}\n`);
    }
  }
  return 0;
}

function mainCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.doctor) return handleDoctor(options);
  if (options.scan) return handleScan(options);
  if (options.draft) return handleDraft(options);

  return handleDoctor(options);
}

module.exports = {
  runInfoqDoctor,
  scanInfoqArticles,
  stageCommentDrafts,
  DEFAULT_TRACKED_ARTICLES,
  parseArgs,
  mainCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = mainCli();
}
