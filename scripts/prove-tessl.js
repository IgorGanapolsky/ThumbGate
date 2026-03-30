#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  exportTiles,
  loadTileConfig,
  verifyTiles,
} = require('./tessl-export');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.RLHF_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'tessl-report.json'),
    reportMd: path.join(proofDir, 'tessl-report.md'),
  };
}

async function run() {
  const { proofDir, reportJson, reportMd } = resolveProofPaths();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-tessl-proof-'));
  const results = { passed: 0, failed: 0, requirements: {} };

  const checks = [
    {
      id: 'TESSL-01',
      desc: 'tile config tracks only high-ROI first-party skills',
      fn: () => {
        const config = loadTileConfig();
        const tileNames = config.tiles.map((tile) => tile.tileName);

        if (config.defaultWorkspace !== 'thumbgate') {
          throw new Error('Default Tessl workspace must stay thumbgate');
        }
        if (tileNames.length !== 2) {
          throw new Error('Expected exactly two first-party Tessl tiles');
        }
        if (!tileNames.includes('agent-memory') || !tileNames.includes('rlhf-feedback')) {
          throw new Error('High-ROI ThumbGate tiles missing from config');
        }
      },
    },
    {
      id: 'TESSL-02',
      desc: 'export writes tile.json, index.md, and copied skills for every configured tile',
      fn: () => {
        const exported = exportTiles({ outDir: tempDir });

        if (exported.length !== 2) {
          throw new Error('Expected two exported Tessl tiles');
        }

        for (const tile of exported) {
          for (const relativePath of ['tile.json', 'index.md']) {
            const fullPath = path.join(tile.directory, relativePath);
            if (!fs.existsSync(fullPath)) {
              throw new Error(`Missing exported asset ${relativePath} for ${tile.tileName}`);
            }
          }
          for (const skillName of tile.skills) {
            const skillPath = path.join(tile.directory, 'skills', skillName, 'SKILL.md');
            if (!fs.existsSync(skillPath)) {
              throw new Error(`Missing exported skill ${skillName}`);
            }
          }
        }
      },
    },
    {
      id: 'TESSL-03',
      desc: 'workspace override produces publishable workspace/tile names without mutating source config',
      fn: () => {
        const overridden = exportTiles({
          outDir: tempDir,
          workspace: 'igorganapolsky',
        });
        const manifest = JSON.parse(
          fs.readFileSync(path.join(overridden[0].directory, 'tile.json'), 'utf8')
        );

        if (!manifest.name.startsWith('igorganapolsky/')) {
          throw new Error('Workspace override did not flow into tile manifest');
        }

        const config = loadTileConfig();
        if (config.defaultWorkspace !== 'thumbgate') {
          throw new Error('Source config mutated during export');
        }
      },
    },
    {
      id: 'TESSL-04',
      desc: 'generated docs include install guidance plus proof pack links',
      fn: () => {
        exportTiles({ outDir: tempDir });
        const docs = fs.readFileSync(path.join(tempDir, 'agent-memory', 'index.md'), 'utf8');

        if (!docs.includes('tessl install thumbgate/agent-memory')) {
          throw new Error('Install command missing from generated docs');
        }
        if (!docs.includes('VERIFICATION_EVIDENCE.md')) {
          throw new Error('Verification evidence link missing from generated docs');
        }
        if (!docs.includes('proof/compatibility/report.json')) {
          throw new Error('Compatibility proof link missing from generated docs');
        }
      },
    },
    {
      id: 'TESSL-05',
      desc: 'skill verification command succeeds against the canonical skills',
      fn: () => {
        const result = verifyTiles();

        if (!result.ok || result.tileCount !== 2) {
          throw new Error('Tessl skill verification did not pass');
        }
      },
    },
    {
      id: 'TESSL-06',
      desc: 'publish workflow validates and exports before secret-gated Tessl publish',
      fn: () => {
        const workflow = fs.readFileSync(
          path.join(ROOT, '.github', 'workflows', 'publish-tessl.yml'),
          'utf8'
        );

        if (!/npm run tessl:verify/.test(workflow)) {
          throw new Error('Workflow must verify Tessl tiles before publish');
        }
        if (!/npm run tessl:export -- --out-dir=.artifacts\/tessl/.test(workflow)) {
          throw new Error('Workflow must export Tessl tiles before publish');
        }
        if (!/if:\s*\$\{\{\s*secrets\.TESSL_API_TOKEN != ''\s*\}\}/.test(workflow)) {
          throw new Error('Workflow publish job must be gated on TESSL_API_TOKEN');
        }
        if (!/uses:\s*tesslio\/publish@main/.test(workflow)) {
          throw new Error('Workflow must use the official Tessl publish action');
        }
      },
    },
  ];

  console.log('Tessl Distribution - Proof Gate\n');
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

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '12-tessl-distribution',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, JSON.stringify(report, null, 2) + '\n');

  const markdown = [
    '# Tessl Distribution Proof Report',
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
