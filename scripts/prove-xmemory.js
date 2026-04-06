'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'xmemory-report.json'),
    reportMd: path.join(proofDir, 'xmemory-report.md'),
  };
}

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

function setupTempFeedbackDir() {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-xmemory-proof-'));
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  return feedbackDir;
}

async function run() {
  const feedbackDir = setupTempFeedbackDir();
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'XMEM-01',
      desc: 'xmemory hierarchy groups correlated memories into themes and semantic clusters',
      fn: () => {
        const { buildXMemoryHierarchy } = loadFresh('./xmemory-lite');
        const docs = [
          {
            id: 'doc_1',
            title: 'Verification miss before claiming done',
            content: 'Skipped tests before claiming done on checkout fix.',
            tags: ['verification', 'testing'],
            namespace: 'memory/error',
            metadata: { semanticKey: 'verification-miss', theme: 'verification' },
            createdAt: '2026-03-30T12:00:00.000Z',
          },
          {
            id: 'doc_2',
            title: 'Verification miss before claiming done',
            content: 'Skipped proof before claiming done on webhook fix.',
            tags: ['verification', 'testing'],
            namespace: 'memory/error',
            metadata: { semanticKey: 'verification-miss', theme: 'verification' },
            createdAt: '2026-03-30T12:05:00.000Z',
          },
          {
            id: 'doc_3',
            title: 'Railway deploy health drift',
            content: 'Verify deployment health and build SHA after Railway deploy.',
            tags: ['deployment', 'railway'],
            namespace: 'memory/learning',
            metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
            createdAt: '2026-03-30T12:10:00.000Z',
          },
        ];
        const hierarchy = buildXMemoryHierarchy(docs, { query: 'verification railway deploy' });

        if (hierarchy.themeCount !== 2) throw new Error('Expected 2 themes');
        if (hierarchy.semanticCount !== 2) throw new Error('Expected 2 semantic groups');
      },
    },
    {
      id: 'XMEM-02',
      desc: 'context packs use hierarchical retrieval for memory namespaces and pick diverse themes first',
      fn: () => {
        const {
          upsertContextObject,
          constructContextPack,
          NAMESPACES,
        } = loadFresh('./contextfs');

        upsertContextObject({
          namespace: NAMESPACES.memoryError,
          title: 'Verification miss before claiming done',
          content: 'Skipped tests before claiming done on checkout fix.',
          tags: ['verification', 'testing'],
          source: 'feedback-memory',
          metadata: { semanticKey: 'verification-miss', theme: 'verification' },
        });
        upsertContextObject({
          namespace: NAMESPACES.memoryError,
          title: 'Verification miss before claiming done',
          content: 'Skipped proof before claiming done on webhook fix.',
          tags: ['verification', 'testing'],
          source: 'feedback-memory',
          metadata: { semanticKey: 'verification-miss', theme: 'verification' },
        });
        upsertContextObject({
          namespace: NAMESPACES.memoryLearning,
          title: 'Railway deploy health drift',
          content: 'Verify deployment health and build SHA after Railway deploy.',
          tags: ['deployment', 'railway'],
          source: 'feedback-memory',
          metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
        });

        const pack = constructContextPack({
          query: 'verification railway deploy',
          maxItems: 2,
          maxChars: 4000,
          namespaces: ['memoryError', 'memoryLearning'],
        });

        if (pack.retrieval.strategy !== 'hierarchical') {
          throw new Error('Expected hierarchical retrieval');
        }
        const themes = [...pack.retrieval.selectedThemes].sort();
        if (JSON.stringify(themes) !== JSON.stringify(['deployment', 'verification'])) {
          throw new Error('Expected diverse theme selection');
        }
      },
    },
    {
      id: 'XMEM-03',
      desc: 'uncertainty gating expands raw episode evidence only when representative coverage is insufficient',
      fn: () => {
        const { retrieveHierarchicalDocuments } = loadFresh('./xmemory-lite');
        const docs = [
          {
            id: 'doc_1',
            title: 'Deploy health mismatch',
            content: 'Verify deployment health after Railway rollout.',
            tags: ['deployment', 'railway'],
            namespace: 'memory/error',
            metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
            createdAt: '2026-03-30T12:00:00.000Z',
          },
          {
            id: 'doc_2',
            title: 'Deploy health mismatch',
            content: 'Compare rollback evidence and build SHA during deploy failures.',
            tags: ['deployment', 'rollback'],
            namespace: 'memory/error',
            metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
            createdAt: '2026-03-30T12:01:00.000Z',
          },
        ];

        const result = retrieveHierarchicalDocuments({
          documents: docs,
          query: 'railway rollback build',
          maxItems: 2,
          maxChars: 4000,
          coverageTarget: 0.8,
        });

        if (result.retrieval.expandedEpisodes < 1) {
          throw new Error('Expected at least one gated expansion');
        }
        if (result.retrieval.queryCoverage < result.retrieval.initialCoverage) {
          throw new Error('Coverage regressed after expansion');
        }
      },
    },
    {
      id: 'XMEM-04',
      desc: 'research-only context packs stay flat to avoid overengineering static corpora',
      fn: () => {
        const {
          upsertContextObject,
          constructContextPack,
          NAMESPACES,
        } = loadFresh('./contextfs');

        upsertContextObject({
          namespace: NAMESPACES.research,
          title: 'Paper: Retrieval by Decomposition',
          content: 'Semantic decomposition and hierarchical retrieval for agent memory.',
          tags: ['research', 'paper'],
          source: 'hf-papers',
        });

        const pack = constructContextPack({
          query: 'hierarchical retrieval',
          maxItems: 2,
          maxChars: 4000,
          namespaces: ['research'],
        });

        if (pack.retrieval.strategy !== 'flat') {
          throw new Error('Research-only packs must stay flat');
        }
      },
    },
    {
      id: 'XMEM-05',
      desc: 'MemAlign working memory consumes hierarchical episodic packs and surfaces selected themes',
      fn: () => {
        const {
          upsertContextObject,
          NAMESPACES,
        } = loadFresh('./contextfs');
        const {
          constructWorkingMemory,
          formatWorkingMemoryForContext,
        } = loadFresh('./memalign-recall');

        upsertContextObject({
          namespace: NAMESPACES.memoryLearning,
          title: 'Railway deploy health drift',
          content: 'Verify deployment health and build SHA after Railway deploy.',
          tags: ['deployment', 'railway'],
          source: 'feedback-memory',
          metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
        });

        const wm = constructWorkingMemory({
          query: 'railway deploy health',
          maxChars: 1200,
        });
        const formatted = formatWorkingMemoryForContext(wm);

        if (wm.episodes.retrieval.strategy !== 'hierarchical') {
          throw new Error('MemAlign must use hierarchical episodic retrieval');
        }
        if (!formatted.includes('Themes: deployment')) {
          throw new Error('Working memory summary must surface selected themes');
        }
      },
    },
    {
      id: 'XMEM-06',
      desc: 'verify-run full includes the xmemory proof lane and artifact',
      fn: () => {
        const { buildVerifyPlan, recordVerifyWorkflowRun } = loadFresh('./verify-run');
        const plan = buildVerifyPlan('full');
        const commands = plan.map((step) => [step.command, ...(step.args || [])].join(' ')).join('\n');
        if (!commands.includes('prove:xmemory')) {
          throw new Error('verify:full is missing prove:xmemory');
        }

        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-xmemory-proof-cwd-'));
        try {
          const entry = recordVerifyWorkflowRun('full', cwd, feedbackDir);
          if (!entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'xmemory-report.json')))) {
            throw new Error('verify workflow run is missing xmemory proof artifact');
          }
        } finally {
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
  ];

  console.log('xMemory Lite - Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed += 1;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (error) {
      results.failed += 1;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: error.message,
      };
      console.error(`  FAIL  ${check.id}: ${error.message}`);
    }
  }

  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '11-xmemory-lite',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);

  const markdown = [
    '# xMemory Lite Proof Report',
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

  fs.rmSync(feedbackDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;

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
