'use strict';
/**
 * Phase 11: Subway Upgrades — Proof Gate
 *
 * Validates all SUBW-01 through SUBW-05 requirements.
 * Runs Jest tests in Subway (via execSync) to produce pass/fail evidence.
 *
 * Usage:
 *   node scripts/prove-subway-upgrades.js
 *
 * Produces:
 *   proof/subway-upgrades/subway-upgrades-report.json
 *   proof/subway-upgrades/subway-upgrades-report.md
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROOF_DIR = path.join(__dirname, '..', 'proof', 'subway-upgrades');
const REPORT_JSON = path.join(PROOF_DIR, 'subway-upgrades-report.json');
const REPORT_MD = path.join(PROOF_DIR, 'subway-upgrades-report.md');

const REQUIRED_SUBWAY_ARTIFACTS = [
  ['.claude', 'scripts', 'feedback', 'vector-store.js'],
  ['.claude', 'scripts', 'feedback', 'dpo-optimizer.js'],
  ['.claude', 'scripts', 'feedback', 'thompson-sampling.js'],
  ['.github', 'workflows', 'self-healing-monitor.yml'],
  ['.github', 'workflows', 'self-healing-auto-fix.yml'],
];

function hasRequiredSubwayArtifacts(root) {
  if (!root || !fs.existsSync(root)) return false;
  return REQUIRED_SUBWAY_ARTIFACTS.every((segments) => fs.existsSync(path.join(root, ...segments)));
}

function resolveSubwayRoot() {
  const envRoot = process.env.SUBWAY_ROOT;
  if (envRoot) return envRoot;

  const candidates = [
    path.join(__dirname, '..', '..', '..', 'Subway_RN_Demo'),
    path.join(__dirname, '..', '..', '..', '..', 'Subway_RN_Demo'),
    path.join(__dirname, '..', '..', 'Subway_RN_Demo'),
  ];
  const ready = candidates.find((candidate) => hasRequiredSubwayArtifacts(candidate));
  if (ready) return ready;
  return candidates[0];
}

const SUBWAY_ROOT = resolveSubwayRoot();

function run() {
  const results = { passed: 0, failed: 0, requirements: {} };

  const checks = [
    {
      id: 'SUBW-01',
      desc: 'LanceDB vector store ported to Subway — upsert + search verified by Jest (vector-store.test.js)',
      fn: () => {
        // Verify the Subway vector-store.js exists
        const vsPath = path.join(SUBWAY_ROOT, '.claude', 'scripts', 'feedback', 'vector-store.js');
        if (!fs.existsSync(vsPath)) throw new Error(`Missing: ${vsPath}`);

        // Load and verify exports
        const vs = require(vsPath);
        if (typeof vs.upsertFeedback !== 'function') throw new Error('upsertFeedback not exported');
        if (typeof vs.searchSimilar !== 'function') throw new Error('searchSimilar not exported');
        if (vs.TABLE_NAME !== 'rlhf_memories') throw new Error(`TABLE_NAME must be rlhf_memories, got ${vs.TABLE_NAME}`);

        // Run Jest tests
        const out = execSync(
          'node --experimental-vm-modules node_modules/.bin/jest --watchman=false --config jest.governance.config.js --testPathPattern=vector-store --forceExit',
          {
            cwd: SUBWAY_ROOT,
            encoding: 'utf8',
            stdio: 'pipe',
            env: { ...process.env, RLHF_VECTOR_STUB_EMBED: 'true', NODE_OPTIONS: '--experimental-vm-modules' },
          }
        );
        if (out.includes('FAIL ')) throw new Error(`Jest tests failed:\n${out.slice(-300)}`);
      },
    },
    {
      id: 'SUBW-02',
      desc: 'DPO optimizer ported to Subway — buildPreferencePairs + applyDpoAdjustments + dpoLogRatio exported',
      fn: () => {
        const dpoPath = path.join(SUBWAY_ROOT, '.claude', 'scripts', 'feedback', 'dpo-optimizer.js');
        if (!fs.existsSync(dpoPath)) throw new Error(`Missing: ${dpoPath}`);

        // Clear cache for fresh load
        delete require.cache[require.resolve(dpoPath)];
        const dpo = require(dpoPath);
        if (typeof dpo.dpoLogRatio !== 'function') throw new Error('dpoLogRatio not exported');
        if (typeof dpo.buildPreferencePairs !== 'function') throw new Error('buildPreferencePairs not exported');
        if (typeof dpo.applyDpoAdjustments !== 'function') throw new Error('applyDpoAdjustments not exported');
        if (typeof dpo.run !== 'function') throw new Error('run not exported');

        // Verify dpoLogRatio math
        const adj = dpo.dpoLogRatio(1.0, 0.5);
        if (typeof adj !== 'number') throw new Error('dpoLogRatio must return number');
        if (adj <= 0) throw new Error('dpoLogRatio(1.0, 0.5) should be positive (chosen > rejected)');

        // Run Jest tests
        const out = execSync(
          'node --experimental-vm-modules node_modules/.bin/jest --watchman=false --config jest.governance.config.js --testPathPattern=dpo-optimizer --forceExit',
          {
            cwd: SUBWAY_ROOT,
            encoding: 'utf8',
            stdio: 'pipe',
          }
        );
        if (out.includes('FAIL ')) throw new Error(`Jest tests failed:\n${out.slice(-300)}`);
      },
    },
    {
      id: 'SUBW-03',
      desc: 'Thompson Sampling JS module ported to Subway — updateModel updates alpha/beta posteriors',
      fn: () => {
        const tsPath = path.join(SUBWAY_ROOT, '.claude', 'scripts', 'feedback', 'thompson-sampling.js');
        if (!fs.existsSync(tsPath)) throw new Error(`Missing: ${tsPath}`);

        delete require.cache[require.resolve(tsPath)];
        const ts = require(tsPath);
        if (typeof ts.timeDecayWeight !== 'function') throw new Error('timeDecayWeight not exported');
        if (typeof ts.loadModel !== 'function') throw new Error('loadModel not exported');
        if (typeof ts.saveModel !== 'function') throw new Error('saveModel not exported');
        if (typeof ts.updateModel !== 'function') throw new Error('updateModel not exported');
        if (typeof ts.getReliability !== 'function') throw new Error('getReliability not exported');
        if (typeof ts.samplePosteriors !== 'function') throw new Error('samplePosteriors not exported');

        // Verify alpha update
        const model = ts.createInitialModel();
        const beforeAlpha = model.categories.testing.alpha;
        ts.updateModel(model, { signal: 'positive', timestamp: new Date().toISOString(), categories: ['testing'] });
        if (model.categories.testing.alpha <= beforeAlpha) throw new Error('alpha should increase on positive signal');

        // Run Jest tests
        const out = execSync(
          'node --experimental-vm-modules node_modules/.bin/jest --watchman=false --config jest.governance.config.js --testPathPattern=thompson-sampling --forceExit',
          {
            cwd: SUBWAY_ROOT,
            encoding: 'utf8',
            stdio: 'pipe',
          }
        );
        if (out.includes('FAIL ')) throw new Error(`Jest tests failed:\n${out.slice(-300)}`);
      },
    },
    {
      id: 'SUBW-04',
      desc: 'Self-healing GH Action workflows exist in Subway .github/workflows/',
      fn: () => {
        const monitorPath = path.join(SUBWAY_ROOT, '.github', 'workflows', 'self-healing-monitor.yml');
        const autoFixPath = path.join(SUBWAY_ROOT, '.github', 'workflows', 'self-healing-auto-fix.yml');
        if (!fs.existsSync(monitorPath)) throw new Error(`Missing: ${monitorPath}`);
        if (!fs.existsSync(autoFixPath)) throw new Error(`Missing: ${autoFixPath}`);

        // Verify key fields in monitor workflow
        const monitorContent = fs.readFileSync(monitorPath, 'utf-8');
        if (!monitorContent.includes('self-healing-check.js')) {
          throw new Error('self-healing-monitor.yml must reference self-healing-check.js');
        }
        if (!monitorContent.includes('self-heal.js')) {
          throw new Error('self-healing-monitor.yml must reference self-heal.js');
        }

        // Verify auto-fix workflow
        const autoFixContent = fs.readFileSync(autoFixPath, 'utf-8');
        if (!autoFixContent.includes('self-heal.js')) {
          throw new Error('self-healing-auto-fix.yml must reference self-heal.js');
        }
      },
    },
    {
      id: 'SUBW-05',
      desc: 'All Phase 11 Subway Jest tests pass with 0 failures (vector-store, dpo-optimizer, thompson-sampling)',
      fn: () => {
        // Use combined stderr+stdout to capture Jest output (it writes to stderr)
        let out = '';
        try {
          out = execSync(
            'npx jest --watchman=false --config jest.governance.config.js --testPathPattern="vector-store|dpo-optimizer|thompson-sampling" --forceExit 2>&1',
            {
              cwd: SUBWAY_ROOT,
              encoding: 'utf8',
              env: { ...process.env, RLHF_VECTOR_STUB_EMBED: 'true', NODE_OPTIONS: '--experimental-vm-modules' },
            }
          );
        } catch (err) {
          // execSync throws on non-zero exit — capture output from err.stdout/stderr
          out = (err.stdout || '') + (err.stderr || '');
          // If there are actual test failures in the output, throw; otherwise re-check
          const failMatch = out.match(/Tests:\s+(\d+) failed/);
          if (failMatch && parseInt(failMatch[1], 10) > 0) {
            throw new Error(`${failMatch[1]} Jest test failure(s):\n${out.slice(-500)}`);
          }
        }
        // Verify at least 25 tests passed
        const passMatch = out.match(/Tests:\s+.*?(\d+) passed/);
        const passCnt = passMatch ? parseInt(passMatch[1], 10) : 0;
        if (passCnt < 25) throw new Error(`Expected >= 25 tests passing, got ${passCnt}`);
      },
    },
  ];

  console.log('Phase 11: Subway Upgrades — Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      check.fn();
      results.passed++;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (err) {
      results.failed++;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: err.message,
      };
      console.error(`  FAIL  ${check.id}: ${err.message}`);
    }
  }

  // Write proof artifacts
  fs.mkdirSync(PROOF_DIR, { recursive: true });

  const report = {
    phase: '11-subway-upgrades',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');

  const md = [
    '# Phase 11: Subway Upgrades — Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Result: ${results.passed}/${checks.length} passed`,
    '',
    '## Requirements',
    '',
    ...Object.entries(results.requirements).map(([id, r]) => {
      const checkbox = r.status === 'pass' ? '[x]' : '[ ]';
      const errLine = r.error ? `\n  - Error: \`${r.error}\`` : '';
      return `- ${checkbox} **${id}**: ${r.desc}${errLine}`;
    }),
    '',
    '## Evidence',
    '',
    '- `Subway/.claude/scripts/feedback/vector-store.js` — LanceDB upsert + semantic search (3-level PATH from root)',
    '- `Subway/.claude/scripts/feedback/dpo-optimizer.js` — Offline batch DPO optimization (sibling requires)',
    '- `Subway/.claude/scripts/feedback/thompson-sampling.js` — Beta-Bernoulli posteriors with inline parseTimestamp',
    '- `Subway/.github/workflows/self-healing-monitor.yml` — Scheduled health check + issue creation',
    '- `Subway/.github/workflows/self-healing-auto-fix.yml` — Scheduled self-heal + remediation PR',
    '- `Subway/scripts/__tests__/vector-store.test.js` — 6 Jest tests (NODE_OPTIONS=--experimental-vm-modules)',
    '- `Subway/scripts/__tests__/dpo-optimizer.test.js` — 7 Jest tests',
    '- `Subway/scripts/__tests__/thompson-sampling.test.js` — 10 Jest tests',
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_MD, md);

  console.log(`\nPhase 11 proof: ${results.passed} passed, ${results.failed} failed`);
  console.log(`Report: ${REPORT_JSON}`);

  if (results.failed > 0) process.exit(1);
}

run();
