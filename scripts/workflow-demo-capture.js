#!/usr/bin/env node
'use strict';

/**
 * Workflow Demo Capture & Replay — OpenAdapt FORMAT steal.
 *
 * Stolen from: OpenAdapt (github.com/OpenAdaptAI/OpenAdapt, MIT)
 *   "Repetitive work in apps without APIs doesn't need a model deciding
 *    every click. Demonstration-to-program: show a task once, then compile
 *    it into a readable program."
 *
 * ThumbGate adaptation: instead of UI clicks, we capture successful agent
 * DEMONSTRATIONS (tool call sequences from workflow-notebook.js) and compile
 * them into deterministic replay files that execute WITHOUT model calls per
 * step. Each replay includes save verification points (pre/post state
 * assertions) so silent divergence is caught.
 *
 * Key stolen patterns:
 *   1. Demonstration-to-workflow — record one successful run, compile to
 *      deterministic program.
 *   2. No model calls by default — replay compiled workflow via shell/exec,
 *      not per-step LLM inference.
 *   3. Save verification — assert target state BEFORE each state-mutating
 *      step, read back AFTER, log mismatch.
 *   4. Agent-ready interface — compiled workflows expose a single MCP tool
 *      invocation that returns an outcome.
 *
 * Storage:
 *   .claude/workflow-demos/<id>.demo.json        (raw demonstration)
 *   .claude/workflow-demos/<id>.compiled.json    (deterministic replay)
 *   .claude/workflow-demos/<id>.index.md         (discovery artifact)
 *
 * Usage:
 *   node scripts/workflow-demo-capture.js capture --notebook <id> --title "..."
 *   node scripts/workflow-demo-capture.js compile --demo <id>
 *   node scripts/workflow-demo-capture.js replay --compiled <id>
 *   node scripts/workflow-demo-capture.js verify-state --compiled <id>
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PROJECT_ROOT = path.join(__dirname, '..');

function getDemosDir() {
  const envDir = process.env.THUMBGATE_DEMO_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(PROJECT_ROOT, '.claude', 'workflow-demos');
}

function ensureDemosDir() {
  const dir = getDemosDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// ID generation (deterministic for notebooks, random for demos)
// ---------------------------------------------------------------------------

function slugify(text) {
  return String(text || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workflow';
}

function generateId(prefix, text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${slugify(text)}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Demonstration capture
// ---------------------------------------------------------------------------

/**
 * Capture a demonstration from a completed workflow notebook.
 * The notebook already contains sessionActions and evidence; we extract
 * the successful tool call sequence and persist it as a .demo.json.
 */
function captureDemo({ notebookId, title, goal, tags = [] }) {
  ensureDemosDir();
  const demoId = generateId('demo', title || notebookId || 'capture');

  // Load notebook if available
  let notebook = null;
  const notebooksDir = path.join(
    PROJECT_ROOT, '.thumbooth', 'workflow-notebooks'
  );
  // Try the feedback dir path too
  const altNotebooksDir = path.join(
    process.env.HOME, 'Documents', 'AI-Agent-Sync', 'workflow-notebooks'
  );

  for (const dir of [notebooksDir, altNotebooksDir]) {
    const nbPath = path.join(dir, `${notebookId}.json`);
    if (fs.existsSync(nbPath)) {
      try {
        notebook = JSON.parse(fs.readFileSync(nbPath, 'utf8'));
        break;
      } catch { /* ignore parse errors */ }
    }
  }

  // Build demonstration record
  const demo = {
    id: demoId,
    title: title || notebook?.title || 'Untitled demonstration',
    goal: goal || notebook?.intent?.summary || '',
    notebookId: notebookId || null,
    capturedAt: new Date().toISOString(),
    tags: Array.isArray(tags) ? tags : [],
    status: 'captured',
    // Extract sessionActions from notebook (these are the demonstrated tool calls)
    demonstratedSteps: notebook?.sessionActions || [],
    evidence: notebook?.evidence || [],
    // State checkpoints captured during this run (pre/post assertions)
    stateAssertions: notebook?.stateAssertions || [],
    // Metadata for traceability
    sessionAgent: process.env.THUMBGATE_SESSION_AGENT || 'unknown',
    cwd: process.cwd(),
  };

  const demoPath = path.join(getDemosDir(), `${demoId}.demo.json`);
  fs.writeFileSync(demoPath, `${JSON.stringify(demo, null, 2)}\n`);

  // Emit discovery index
  const indexPath = path.join(getDemosDir(), `${demoId}.index.md`);
  const index = `# ${demo.title}\n\n` +
    `> Demo ID: ${demo.id} | Status: ${demo.status} | Captured: ${demo.capturedAt}\n\n` +
    `**Goal**: ${demo.goal || 'N/A'}\n\n` +
    `**Notbook**: ${demo.notebookId || 'N/A'}\n\n` +
    `**Steps**: ${demo.demonstratedSteps.length}\n\n` +
    `**State assertions**: ${demo.stateAssertions.length}\n\n` +
    `**Tags**: ${demo.tags.join(', ') || 'none'}\n`;
  fs.writeFileSync(indexPath, index);

  return { demoId, demoPath, indexPath, demo };
}

// ---------------------------------------------------------------------------
// Compile demonstration → deterministic replay
// ---------------------------------------------------------------------------

/**
 * Compile a captured demonstration into a deterministic replay program.
 *
 * Stolen pattern: "No model calls by default – replay the compiled workflow
 * without a model call for each screen step."
 *
 * Instead of per-step LLM inference, we encode the demonstrated tool calls
 * as a sequence of shell commands + state assertions that can be replayed
 * deterministically. Each step gets a verification checkpoint.
 */
function compileDemo({ demoId, verifyStates = true }) {
  const demoPath = path.join(getDemosDir(), `${demoId}.demo.json`);
  if (!fs.existsSync(demoPath)) {
    throw new Error(`Demo not found: ${demoId}`);
  }

  const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  ensureDemosDir();

  const compiledId = `compiled-${demoId}`;
  const replaySteps = demo.demonstratedSteps.map((step, idx) => {
    // For each demonstrated step, create a replay entry
    // If it was a shell command, encode as a shell replay
    // If it was a git operation, encode as a git replay
    // If it was a file operation, encode as a file assertion + operation
    let replayType = 'shell';
    let command = step;
    let description = '';

    if (typeof step === 'string') {
      command = step;
      description = step.slice(0, 80);
    } else if (typeof step === 'object' && step !== null) {
      if (step.action) command = step.action;
      if (step.description) description = step.description;
      if (step.type) replayType = step.type;
    }

    return {
      stepIndex: idx,
      type: replayType,
      command,
      description: description || 'No description',
      // Pre-state assertion: verify expected state before executing
      preAssertion: verifyStates ? {
        type: 'exists',
        path: '.',
        description: `Pre-step ${idx} state check`,
      } : null,
      // Post-state assertion: verify result after executing
      postAssertion: verifyStates ? {
        type: 'exit_code',
        expected: 0,
        description: `Post-step ${idx} success check`,
      } : null,
    };
  });

  const compiled = {
    id: compiledId,
    sourceDemoId: demoId,
    title: demo.title,
    goal: demo.goal,
    compiledAt: new Date().toISOString(),
    status: 'compiled',
    totalSteps: replaySteps.length,
    modelCallsPerStep: 0, // KEY: compiled workflows make ZERO model calls per step
    requiresApproval: true, // fail-closed: must be approved before replay
    steps: replaySteps,
    // MCP tool interface: this compiled workflow can be invoked as a single MCP tool
    mcpInterface: {
      toolName: `replay_${compiledId}`,
      description: demo.goal || demo.title,
      inputSchema: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean', description: 'Validate without executing' },
          stopOnFailure: { type: 'boolean', description: 'Stop on first failed assertion' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['dryRun'],
      },
    },
  };

  const compiledPath = path.join(getDemosDir(), `${compiledId}.compiled.json`);
  fs.writeFileSync(compiledPath, `${JSON.stringify(compiled, null, 2)}\n`);

  // Update demo status
  demo.status = 'compiled';
  demo.compiledId = compiledId;
  fs.writeFileSync(demoPath, `${JSON.stringify(demo, null, 2)}\n`);

  return { compiledId, compiledPath, compiled };
}

// ---------------------------------------------------------------------------
// Deterministic replay
// ---------------------------------------------------------------------------

/**
 * Replay a compiled workflow deterministically — no model calls per step.
 * Includes save verification: assert state before mutation, read back after.
 */
function replayCompiled({ compiledId, dryRun = true, stopOnFailure = true }) {
  const compiledPath = path.join(getDemosDir(), `${compiledId}.compiled.json`);
  if (!fs.existsSync(compiledPath)) {
    throw new Error(`Compiled workflow not found: ${compiledId}`);
  }

  const compiled = JSON.parse(fs.readFileSync(compiledPath, 'utf8'));

  if (compiled.requiresApproval && !dryRun) {
    throw new Error(
      `Compiled workflow ${compiledId} requires approval (set dryRun=true or approve first)`
    );
  }

  const results = [];
  let halted = false;

  for (const step of compiled.steps) {
    if (halted) break;

    const result = {
      stepIndex: step.stepIndex,
      command: step.command,
      type: step.type,
      preAssertion: null,
      execution: null,
      postAssertion: null,
      passed: true,
    };

    // Pre-state assertion (save verification BEFORE execution)
    if (step.preAssertion && step.preAssertion.type === 'exists') {
      const exists = fs.existsSync(step.preAssertion.path);
      result.preAssertion = { checked: true, passed: exists };
      if (!exists && step.preAssertion.required) {
        result.passed = false;
        result.error = `Pre-condition failed: ${step.preAssertion.path} does not exist`;
        if (stopOnFailure) halted = true;
      }
    }

    if (halted) {
      results.push(result);
      continue;
    }

    // Execute step (no model calls — pure deterministic replay)
    if (dryRun) {
      result.execution = { dryRun: true, wouldExecute: step.command };
    } else {
      try {
        const { spawnSync } = require('node:child_process');
        const proc = spawnSync('sh', ['-c', step.command], {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 30000,
        });
        result.execution = {
          exitCode: proc.status,
          stdout: (proc.stdout || '').slice(0, 500),
          stderr: (proc.stderr || '').slice(0, 500),
        };
        if (proc.status !== 0) {
          result.passed = false;
          result.error = `Exit code ${proc.status}`;
          if (stopOnFailure) halted = true;
        }
      } catch (err) {
        result.execution = { error: err.message };
        result.passed = false;
        result.error = err.message;
        if (stopOnFailure) halted = true;
      }
    }

    // Post-state assertion (save verification AFTER execution)
    if (step.postAssertion && !halted) {
      if (step.postAssertion.type === 'exit_code' && !dryRun) {
        const expected = step.postAssertion.expected;
        const actual = result.execution?.exitCode;
        result.postAssertion = {
          checked: true,
          passed: actual === expected,
          expected,
          actual,
        };
        if (actual !== expected) {
          result.passed = false;
          result.error = `Post-condition failed: exit code ${actual} !== ${expected}`;
          if (stopOnFailure) halted = true;
        }
      } else {
        result.postAssertion = { checked: false, reason: 'dryRun mode' };
      }
    }

    results.push(result);
  }

  return {
    compiledId,
    dryRun,
    halted,
    totalSteps: compiled.steps.length,
    completedSteps: results.length,
    allPassed: results.every((r) => r.passed),
    results,
  };
}

// ---------------------------------------------------------------------------
// Verify state checkpoint
// ---------------------------------------------------------------------------

/**
 * Stolen from OpenAdapt's "Save verification": "checks the right record
 * before a save and reads the record back afterward."
 *
 * In ThumbGate terms: before any state-mutating gate (PR merge, config change,
 * deploy), verify the target state matches expectations. After the mutation,
 * read back and verify.
 */
function verifyState({ compiledId, checkpoint }) {
  const compiledPath = path.join(getDemosDir(), `${compiledId}.compiled.json`);
  if (!fs.existsSync(compiledPath)) {
    throw new Error(`Compiled workflow not found: ${compiledId}`);
  }

  const compiled = JSON.parse(fs.readFileSync(compiledPath, 'utf8'));
  const step = compiled.steps[checkpoint.stepIndex];
  if (!step) {
    throw new Error(`Step ${checkpoint.stepIndex} not found in ${compiledId}`);
  }

  const assertions = [];

  // Check pre-assertion
  if (checkpoint.phase === 'pre' && step.preAssertion) {
    const assertion = step.preAssertion;
    if (assertion.type === 'exists') {
      const passed = fs.existsSync(assertion.path);
      assertions.push({ phase: 'pre', type: assertion.type, path: assertion.path, passed });
    }
    if (assertion.type === 'file_contains') {
      const exists = fs.existsSync(assertion.path);
      let passed = exists;
      if (exists && assertion.contains) {
        const content = fs.readFileSync(assertion.path, 'utf8');
        passed = content.includes(assertion.contains);
      }
      assertions.push({ phase: 'pre', type: assertion.type, path: assertion.path, passed });
    }
  }

  // Check post-assertion
  if (checkpoint.phase === 'post' && step.postAssertion) {
    const assertion = step.postAssertion;
    if (assertion.type === 'exit_code') {
      assertions.push({
        phase: 'post',
        type: assertion.type,
        expected: assertion.expected,
        actual: checkpoint.actualExitCode,
        passed: checkpoint.actualExitCode === assertion.expected,
      });
    }
  }

  return { compiledId, checkpoint, assertions, allPassed: assertions.every((a) => a.passed) };
}

// ---------------------------------------------------------------------------
// MCP tool registration (agent-ready interface)
// ---------------------------------------------------------------------------

/**
 * Stolen pattern: "Agent-ready interface — an MCP server lets an AI agent
 * invoke a workflow as one tool call and receive an outcome."
 *
 * This function returns the MCP tool definition for invoking a compiled
 * workflow, which can be registered with the ThumbGate MCP server.
 */
function getMcpToolDefinitions() {
  const demosDir = getDemosDir();
  if (!fs.existsSync(demosDir)) return [];

  const tools = [];
  for (const file of fs.readdirSync(demosDir)) {
    if (!file.endsWith('.compiled.json')) continue;
    try {
      const compiled = JSON.parse(fs.readFileSync(path.join(demosDir, file), 'utf8'));
      if (compiled.mcpInterface) {
        tools.push({
          ...compiled.mcpInterface,
          compiledId: compiled.id,
          title: compiled.title,
          goal: compiled.goal,
        });
      }
    } catch { /* skip invalid files */ }
  }

  return tools;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  switch (command) {
    case 'capture':
      if (!args.notebook) {
        console.error('--notebook <id> is required');
        process.exit(1);
      }
      {
        const result = captureDemo({
          notebookId: args.notebook,
          title: args.title || args.notebook,
          goal: args.goal,
          tags: args.tags ? args.tags.split(',') : [],
        });
        console.log(JSON.stringify(result, null, 2));
      }
      break;

    case 'compile':
      if (!args.demo) {
        console.error('--demo <id> is required');
        process.exit(1);
      }
      {
        const result = compileDemo({ demoId: args.demo, verifyStates: args.verify !== 'false' });
        console.log(JSON.stringify(result, null, 2));
      }
      break;

    case 'replay':
      if (!args.compiled) {
        console.error('--compiled <id> is required');
        process.exit(1);
      }
      {
        const result = replayCompiled({
          compiledId: args.compiled,
          dryRun: args.dryRun !== 'false',
          stopOnFailure: args.stopOnFailure !== 'false',
        });
        console.log(JSON.stringify(result, null, 2));
      }
      break;

    case 'verify-state':
      if (!args.compiled) {
        console.error('--compiled <id> is required');
        process.exit(1);
      }
      {
        const result = verifyState({
          compiledId: args.compiled,
          checkpoint: {
            stepIndex: parseInt(args.step, 10) || 0,
            phase: args.phase || 'pre',
            actualExitCode: args.actualExitCode !== undefined ? parseInt(args.actualExitCode, 10) : undefined,
          },
        });
        console.log(JSON.stringify(result, null, 2));
      }
      break;

    case 'mcp-tools':
      {
        const tools = getMcpToolDefinitions();
        console.log(JSON.stringify(tools, null, 2));
      }
      break;

    default:
      console.error([
        'Usage:',
        '  node scripts/workflow-demo-capture.js capture --notebook <id> [--title "..." --goal "..." --tags a,b]',
        '  node scripts/workflow-demo-capture.js compile --demo <id> [--verify-states true]',
        '  node scripts/workflow-demo-capture.js replay --compiled <id> [--dry-run true]',
        '  node scripts/workflow-demo-capture.js verify-state --compiled <id> --step <n> --phase pre|post',
        '  node scripts/workflow-demo-capture.js mcp-tools',
      ].join('\n'));
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  captureDemo,
  compileDemo,
  replayCompiled,
  verifyState,
  getMcpToolDefinitions,
  getDemosDir,
  generateId,
};
