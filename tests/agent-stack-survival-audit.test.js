'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildStackSurvivalAudit,
  formatStackSurvivalReport,
} = require('../scripts/agent-stack-survival-audit');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'ok\n', 'utf8');
}

test('buildStackSurvivalAudit rewards context, adapters, sandboxing, and thin scaffolding', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-stack-audit-'));
  writeJson(path.join(tempDir, 'package.json'), {
    dependencies: {},
    devDependencies: {},
  });
  writeJson(path.join(tempDir, 'config/model-candidates.json'), {
    candidates: {
      fast: {},
      long: {},
      cheap: {},
      verifier: {},
    },
  });
  for (const adapter of ['claude', 'codex', 'cursor', 'gemini', 'mcp', 'opencode']) {
    fs.mkdirSync(path.join(tempDir, 'adapters', adapter), { recursive: true });
  }
  for (const file of [
    'scripts/document-intake.js',
    'scripts/contextfs.js',
    'scripts/context-engine.js',
    'scripts/lesson-retrieval.js',
    'scripts/memalign.js',
    'config/mcp-allowlists.json',
    'scripts/cloudflare-dynamic-sandbox.js',
    'scripts/docker-sandbox-planner.js',
    'config/gates/computer-use.json',
    'config/gates/code-edit.json',
  ]) {
    touch(path.join(tempDir, file));
  }
  for (let index = 0; index < 8; index += 1) {
    touch(path.join(tempDir, 'public/guides', `agent-context-guardrail-${index}.html`));
  }

  const audit = buildStackSurvivalAudit({ root: tempDir });

  assert.equal(audit.verdict, 'survives');
  assert.equal(audit.categories.scaffoldingThinness.status, 'strong');
  assert.equal(audit.categories.contextMoat.status, 'strong');
  assert.equal(audit.categories.modularity.status, 'strong');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('buildStackSurvivalAudit flags heavy orchestration dependencies', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-stack-risk-'));
  writeJson(path.join(tempDir, 'package.json'), {
    dependencies: {
      langchain: '1.0.0',
      llamaindex: '1.0.0',
    },
  });
  writeJson(path.join(tempDir, 'config/model-candidates.json'), {});

  const audit = buildStackSurvivalAudit({ root: tempDir });

  assert.equal(audit.categories.scaffoldingThinness.status, 'weak');
  assert.ok(audit.highRoiActions.some((action) => /framework lock-in|context\/gates/.test(action.action)));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('formatStackSurvivalReport produces positioning-ready markdown', () => {
  const audit = buildStackSurvivalAudit();
  const markdown = formatStackSurvivalReport(audit);

  assert.match(markdown, /Agent Stack Survival Audit/);
  assert.match(markdown, /context, evidence, and pre-action gates/);
});
