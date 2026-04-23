#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'seo-gsd-report.json'),
    reportMd: path.join(proofDir, 'seo-gsd-report.md'),
  };
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-seo-gsd-proof-'));
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'SEO-GSD-01',
      desc: 'buildThumbGateSeoPlan returns GSD stages and four high-ROI public pages',
      fn: () => {
        delete require.cache[require.resolve('./seo-gsd')];
        const { buildThumbGateSeoPlan, HIGH_ROI_QUERY_SEEDS } = require('./seo-gsd');
        const plan = buildThumbGateSeoPlan(HIGH_ROI_QUERY_SEEDS);

        if (plan.framework !== 'GSD') throw new Error('Framework must be GSD');
        if (plan.capture.totalKeywords !== HIGH_ROI_QUERY_SEEDS.length) {
          throw new Error('Capture stage keyword count is incorrect');
        }
        if (plan.execute.pages.length < 4) throw new Error('Execute stage must publish at least 4 public pages');
        if (!plan.review.recommendedOrder.includes('/compare/speclock')) {
          throw new Error('Recommended order must include /compare/speclock');
        }
      },
    },
    {
      id: 'SEO-GSD-02',
      desc: 'comparison pages stay prioritized ahead of guide pages for bottom-of-funnel demand',
      fn: () => {
        delete require.cache[require.resolve('./seo-gsd')];
        const { THUMBGATE_SEO_PAGE_SPECS } = require('./seo-gsd');
        const publishOrder = THUMBGATE_SEO_PAGE_SPECS.map((page) => page.path);

        if (publishOrder[0] !== '/compare/speclock') {
          throw new Error('First publish target must be /compare/speclock');
        }
        if (publishOrder[1] !== '/compare/mem0') {
          throw new Error('Second publish target must be /compare/mem0');
        }
        if (new Set(publishOrder).size !== THUMBGATE_SEO_PAGE_SPECS.length) {
          throw new Error('Public SEO paths must be unique');
        }
      },
    },
    {
      id: 'SEO-GSD-03',
      desc: 'renderSeoPageHtml includes schema, thumbs messaging, and proof-backed CTA links',
      fn: () => {
        delete require.cache[require.resolve('./seo-gsd')];
        const { findSeoPageByPath, renderSeoPageHtml } = require('./seo-gsd');
        const page = findSeoPageByPath('/compare/speclock');
        const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

        if (!/"@type": "TechArticle"/.test(html)) throw new Error('TechArticle JSON-LD missing');
        if (!/"@type": "FAQPage"/.test(html)) throw new Error('FAQPage JSON-LD missing');
        if (!/👍 Thumbs up reinforces good behavior/u.test(html)) {
          throw new Error('Thumbs-up proof copy missing');
        }
        if (!/👎 Thumbs down blocks repeated mistakes/u.test(html)) {
          throw new Error('Thumbs-down proof copy missing');
        }
        if (!/Verification evidence/.test(html) || !/Automation proof/.test(html)) {
          throw new Error('Proof CTA links missing');
        }
      },
    },
    {
      id: 'SEO-GSD-04',
      desc: 'seo-gsd CLI writes capture, clarify, organize, execute, review, and page-spec outputs',
      fn: () => {
        execFileSync(process.execPath, [
          'scripts/seo-gsd.js',
          'plan',
          '--write',
          `--out-dir=${tmpDir}`,
        ], {
          cwd: ROOT,
          stdio: 'pipe',
          encoding: 'utf8',
        });

        const expectedFiles = [
          '01-capture.json',
          '02-clarify.json',
          '03-organize.json',
          '04-execute-briefs.md',
          '05-review.json',
          '06-page-specs.json',
        ];
        for (const name of expectedFiles) {
          if (!fs.existsSync(path.join(tmpDir, name))) {
            throw new Error(`Missing generated output ${name}`);
          }
        }
      },
    },
    {
      id: 'SEO-GSD-05',
      desc: 'public sitemap lists the homepage plus every SEO comparison and guide page',
      fn: () => {
        delete require.cache[require.resolve('../src/api/server')];
        const { __test__ } = require('../src/api/server');
        const sitemap = __test__.renderSitemapXml({ appOrigin: 'https://app.example.com' });

        for (const pathname of [
          '/',
          '/compare/speclock',
          '/compare/mem0',
          '/guides/pre-action-checks',
          '/guides/agent-harness-optimization',
          '/guides/browser-automation-safety',
          '/guides/native-messaging-host-security',
          '/guides/ai-search-topical-presence',
          '/guides/relational-knowledge-ai-recommendations',
          '/guides/claude-code-feedback',
          '/guides/autoresearch-agent-safety',
        ]) {
          const loc = pathname === '/'
            ? '<loc>https://app.example.com/</loc>'
            : `<loc>https://app.example.com${pathname}</loc>`;
          if (!sitemap.includes(loc)) {
            throw new Error(`Sitemap missing ${pathname}`);
          }
        }
      },
    },
    {
      id: 'SEO-GSD-06',
      desc: 'landing page internally links to the high-intent comparison and guide pages',
      fn: () => {
        const landingHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

        if (!/id="compare-guides"/.test(landingHtml)) {
          throw new Error('Landing page compare-guides section missing');
        }
        for (const pathname of [
          '/compare/speclock',
          '/compare/mem0',
          '/guides/pre-action-checks',
          '/guides/agent-harness-optimization',
          '/guides/browser-automation-safety',
          '/guides/native-messaging-host-security',
          '/guides/ai-search-topical-presence',
          '/guides/relational-knowledge-ai-recommendations',
          '/guides/claude-code-feedback',
          '/guides/autoresearch-agent-safety',
        ]) {
          if (!landingHtml.includes(`href="${pathname}"`)) {
            throw new Error(`Landing page missing internal link for ${pathname}`);
          }
        }
      },
    },
  ];

  console.log('SEO/GEO GSD - Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed++;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (error) {
      results.failed++;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: error.message,
      };
      console.error(`  FAIL  ${check.id}: ${error.message}`);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '10-seo-gsd',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, JSON.stringify(report, null, 2) + '\n');

  const markdown = [
    '# SEO/GEO GSD Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Result: ${results.passed}/${checks.length} passed`,
    '',
    '## Requirements',
    '',
    ...Object.entries(results.requirements).map(([id, requirement]) => {
      const checkbox = requirement.status === 'pass' ? '[x]' : '[ ]';
      const errorLine = requirement.error ? `\n  - Error: \`${requirement.error}\`` : '';
      return `- ${checkbox} **${id}**: ${requirement.desc}${errorLine}`;
    }),
    '',
    `${results.passed} passed, ${results.failed} failed`,
    '',
  ].join('\n');

  fs.writeFileSync(reportMd, `${markdown}\n`);

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  console.log(`Report: ${reportJson}`);

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  resolveProofPaths,
  run,
};
