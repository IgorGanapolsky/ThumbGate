#!/usr/bin/env node
'use strict';

/**
 * wire-proof-gate.js — One-command installer for wiring existing proof/validation
 * scripts (e.g. scripts/upwork_proof.py) as deterministic blocking gates.
 *
 * - Detects *proof*.py, *proof*.js, upwork_proof.py, require-proof*, etc.
 * - Wires as git pre-commit (patches .git/hooks/pre-commit safely with marker)
 * - Optionally wires as Claude Code PreToolUse (project .claude/settings.json)
 *   with smart fast-path: only runs full proof on git commit / publish Bash calls.
 * - ALWAYS produces Ralph Loop / evidence artifact on actual runs:
 *     .thumbgate/evidence/proof-run-YYYY-MM-DDTHH-MM-SSZ.json
 *     .thumbgate/evidence/last-proof-run.json  (pointer + summary)
 *
 * Usage (from any high-stakes workspace):
 *   npx thumbgate wire-proof
 *   npx thumbgate wire-proof --yes --git --claude
 *   npx thumbgate wire-proof --target /path/to/Resume --script scripts/upwork_proof.py --yes
 *   npx thumbgate wire-proof --dry-run
 *
 * The generated gate blocks the action (commit or tool) on nonzero exit from the proof script.
 * Evidence artifacts are consumable by Ralph-style reporting loops.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.join(__dirname, '..');

// Resolve an executable to an absolute path from a fixed allowlist of standard
// system directories, so we never search a writable PATH (SonarCloud S4036).
function resolveBin(name) {
  for (const dir of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/bin']) {
    const candidate = path.join(dir, name);
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return name; // last-resort fallback (rare)
}

// Re-use small helpers from existing modules (no duplication of core logic)
let loadJsonFile;
let hookAlreadyPresent;
let claudeProjectSettingsPath;
try {
  const autoWire = require('./auto-wire-hooks');
  loadJsonFile = autoWire.loadJsonFile;
  hookAlreadyPresent = autoWire.hookAlreadyPresent;
  claudeProjectSettingsPath = autoWire.claudeProjectSettingsPath;
} catch (_) {
  // Fallback minimal impls (used only if import fails in weird env)
  loadJsonFile = (p) => {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
  };
  hookAlreadyPresent = (arr, cmd) => {
    if (!Array.isArray(arr)) return false;
    return arr.some(e => Array.isArray(e?.hooks) && e.hooks.some(h => h?.command === cmd));
  };
  claudeProjectSettingsPath = (base) => path.join(base || process.cwd(), '.claude', 'settings.json');
}

const PROOF_EXTENSIONS = ['.py', '.js', '.sh', '.rb', '.ts'];
const PROOF_NAME_REGEX = /(^|[-_/])(proof|upwork.?proof|require.?proof|proof.?harness|validate.?proof)/i;

function detectProofScripts(targetDir = process.cwd()) {
  const found = new Set();
  const searchRoots = [
    targetDir,
    path.join(targetDir, 'scripts'),
    path.join(targetDir, 'proof'),
    path.join(targetDir, 'bin'),
    path.join(targetDir, 'tools'),
    path.join(targetDir, 'validation'),
    path.join(targetDir, '.thumbgate'),
  ];

  // Dedicated proof directories: any script inside them counts by LOCATION,
  // regardless of filename (a file in proof/ is, by definition, a proof script).
  const dedicatedDirs = new Set([
    path.join(targetDir, 'proof'),
    path.join(targetDir, 'validation'),
  ]);

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (_) { continue; }

    const inDedicatedDir = dedicatedDirs.has(root);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const ext = path.extname(name).toLowerCase();
      if (!PROOF_EXTENSIONS.includes(ext)) continue;
      if (inDedicatedDir || PROOF_NAME_REGEX.test(name) || /proof/i.test(name)) {
        const rel = path.relative(targetDir, path.join(root, name));
        // Normalize to forward slashes for cross-platform display + storage
        found.add(rel.split(path.sep).join('/'));
      }
    }
  }

  // Also check a few explicit high-signal names at root even if regex edge
  const explicit = ['upwork_proof.py', 'upwork_proof.js', 'proof.py', 'proof.js'];
  for (const e of explicit) {
    const p = path.join(targetDir, e);
    if (fs.existsSync(p)) {
      found.add(e);
    }
  }

  return Array.from(found).sort((a, b) => {
    // Prefer scripts/ ones, then shorter names, then alpha
    const aScripts = a.startsWith('scripts/') ? 0 : 1;
    const bScripts = b.startsWith('scripts/') ? 0 : 1;
    if (aScripts !== bScripts) return aScripts - bScripts;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
}

function getGitInfo(targetDir) {
  try {
    const git = resolveBin('git');
    const sha = spawnSync(git, ['rev-parse', 'HEAD'], { cwd: targetDir, encoding: 'utf8' }).stdout.trim();
    const branch = spawnSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetDir, encoding: 'utf8' }).stdout.trim();
    const dirty = spawnSync(git, ['status', '--porcelain'], { cwd: targetDir, encoding: 'utf8' }).stdout.trim().length > 0;
    return { sha: sha || null, branch: branch || null, dirty };
  } catch (_) {
    return { sha: null, branch: null, dirty: null };
  }
}

function writeEvidence(targetDir, proofRel, exitCode, output, durationMs) {
  const evidenceDir = path.join(targetDir, '.thumbgate', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z'; // safe filename
  const fileName = `proof-run-${ts}.json`;
  const filePath = path.join(evidenceDir, fileName);

  const git = getGitInfo(targetDir);
  const record = {
    timestamp: new Date().toISOString(),
    script: proofRel,
    targetDir: path.resolve(targetDir),
    exitCode,
    status: exitCode === 0 ? 'passed' : 'failed',
    durationMs: Math.round(durationMs),
    git,
    output: (output || '').slice(0, 8000), // bounded for sanity
    ralphLoop: true,
    source: 'thumbgate-wire-proof',
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');

  // Pointer for easy Ralph consumption: last-proof-run.json
  const lastPath = path.join(evidenceDir, 'last-proof-run.json');
  fs.writeFileSync(lastPath, JSON.stringify({
    ...record,
    evidenceFile: path.relative(targetDir, filePath),
  }, null, 2) + '\n');

  return { evidenceFile: filePath, lastPointer: lastPath };
}

/**
 * The proof runner that gets written to .thumbgate/hooks/proof-gate.js
 * It is a standalone node script (guaranteed to work because thumbgate requires Node).
 */
function getRunnerSource(proofRelDefault) {
  // String.raw so the embedded runner code keeps its backslash escapes literal
  // (\n, \b, \s in strings/regexes). A plain template literal would evaluate them
  // — turning '\n' into a real newline and breaking the generated file's syntax.
  // No ${...} interpolation is used here; the default script is a 'SCRIPT_NOT_SET'
  // sentinel replaced by writeRunnerAndConfig.
  return String.raw`#!/usr/bin/env node
'use strict';
/**
 * AUTO-GENERATED by thumbgate wire-proof.
 * Do not edit by hand — re-run "npx thumbgate wire-proof" to update.
 *
 * Runs the configured proof script (blocking gate).
 * Always emits a small evidence artifact under .thumbgate/evidence/
 * for Ralph Loop reporting and audit.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const hookDir = __dirname;
const thumbgateDir = path.dirname(hookDir);
const projectRoot = path.dirname(thumbgateDir);
const CONFIG_PATH = path.join(thumbgateDir, 'proof-gate.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function writeEvidenceLocal(proofRel, exitCode, output, durationMs, context) {
  const evidenceDir = path.join(projectRoot, '.thumbgate', 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = 'proof-run-' + ts + '.json';
  const filePath = path.join(evidenceDir, fileName);

  let git = { sha: null, branch: null, dirty: null };
  try {
    git.sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).stdout.trim() || null;
    git.branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).stdout.trim() || null;
    git.dirty = (spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).stdout || '').trim().length > 0;
  } catch (_) {}

  const record = {
    timestamp: new Date().toISOString(),
    script: proofRel,
    targetDir: projectRoot,
    exitCode,
    status: exitCode === 0 ? 'passed' : 'failed',
    durationMs: Math.round(durationMs),
    git,
    output: String(output || '').slice(0, 8000),
    ralphLoop: true,
    source: 'thumbgate-proof-gate',
    context,
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');

  const lastPath = path.join(evidenceDir, 'last-proof-run.json');
  fs.writeFileSync(lastPath, JSON.stringify({ ...record, evidenceFile: path.relative(projectRoot, filePath) }, null, 2) + '\n');
  return filePath;
}

function runProof(proofAbs, proofRel, cwd, context) {
  const start = Date.now();
  const ext = path.extname(proofAbs).toLowerCase();
  let cmd, args;

  if (ext === '.py') {
    cmd = process.platform === 'win32' ? 'python' : 'python3';
    args = [proofAbs];
  } else if (ext === '.js' || ext === '.ts') {
    cmd = 'node';
    args = [proofAbs];
  } else {
    // shell / sh / anything executable
    cmd = 'bash';
    args = [proofAbs];
  }

  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000, // 2 min safety
  });

  const durationMs = Date.now() - start;
  const combined = (res.stdout || '') + (res.stderr || '');
  const code = res.status != null ? res.status : (res.error ? 1 : 0);

  // Always emit evidence when we actually executed the proof
  const evPath = writeEvidenceLocal(proofRel, code, combined, durationMs, context || 'unknown');

  if (code === 0) {
    console.log('✅ Proof passed: ' + proofRel + ' (' + Math.round(durationMs / 1000) + 's)');
    console.log('   Evidence: ' + path.relative(cwd, evPath));
    return 0;
  } else {
    console.error('❌ PROOF GATE FAILED — ' + proofRel);
    console.error('   Exit code: ' + code);
    console.error('   Evidence: ' + path.relative(cwd, evPath));
    if (combined.trim()) {
      console.error('   Output (last 2000 chars):');
      console.error(combined.trim().slice(-2000));
    }
    return code || 1;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const contextFlag = (argv.find(a => a.startsWith('--context=')) || '').split('=')[1] || '';
  const forcedProof = (argv.find(a => a.startsWith('--proof-script=')) || '').split('=')[1] || '';

  const config = loadConfig();
  const proofRel = forcedProof || config.script || 'SCRIPT_NOT_SET';
  if (!proofRel) {
    console.error('No proof script configured for ThumbGate proof gate.');
    process.exit(1);
  }

  const proofAbs = path.isAbsolute(proofRel) ? proofRel : path.join(projectRoot, proofRel);
  if (!fs.existsSync(proofAbs)) {
    console.error('Proof script missing at: ' + proofAbs);
    process.exit(1);
  }

  // Claude PreToolUse fast-path: only run expensive proof on actual commit-like actions
  if (contextFlag === 'claude') {
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8').trim(); // stdin (fd 0) — hook payload
    } catch (_) {}
    if (raw) {
      try {
        const data = JSON.parse(raw);
        const tool = String(data.tool_name || data.tool || '').toLowerCase();
        const cmdStr = String(
          (data.tool_input && (data.tool_input.command || data.tool_input.cmd || '')) ||
          (data.command || '')
        );
        const isCommitAction = /\b(git\s+(commit|push|amend|rebase|tag)|npm\s+publish|yarn\s+publish|pnpm\s+publish)\b/i.test(cmdStr);
        if (tool === 'bash' && !isCommitAction) {
          // Fast path — innocent bash command, do not run proof
          process.stdout.write(JSON.stringify({}) + '\n');
          process.exit(0);
        }
      } catch (_) {
        // Unparseable payload — be conservative, do NOT block random bash
        process.stdout.write(JSON.stringify({}) + '\n');
        process.exit(0);
      }
    }
  }

  // Run the real proof (git pre-commit or Claude commit Bash)
  const code = runProof(proofAbs, proofRel, projectRoot, contextFlag || 'git');
  process.exit(code);
}

// require.main is correct + robust for this directly-executed generated script
// (avoids process.argv[1] vs __filename symlink mismatches, e.g. /tmp -> /private/tmp).
if (require.main === module) {
  main();
}
`;
}

function ensureDirs(targetDir) {
  const tg = path.join(targetDir, '.thumbgate');
  fs.mkdirSync(path.join(tg, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(tg, 'evidence'), { recursive: true });
  return tg;
}

function writeRunnerAndConfig(targetDir, proofRel) {
  const tgDir = ensureDirs(targetDir);
  const hooksDir = path.join(tgDir, 'hooks');
  const runnerPath = path.join(hooksDir, 'proof-gate.js');
  const configPath = path.join(tgDir, 'proof-gate.json');

  const source = getRunnerSource(proofRel).replace('SCRIPT_NOT_SET', proofRel);

  fs.writeFileSync(runnerPath, source);
  fs.chmodSync(runnerPath, 0o700);

  const existingConfig = loadJsonFile(configPath) || {};
  const newConfig = {
    ...existingConfig,
    script: proofRel,
    installedAt: existingConfig.installedAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + '\n');

  return { runnerPath, configPath };
}

/**
 * Safely patch .git/hooks/pre-commit so the proof runs on every commit attempt.
 * Uses clear markers so re-runs are idempotent and user content is preserved.
 */
function wireGitPreCommit(targetDir, runnerAbs, dryRun) {
  const gitDir = path.join(targetDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return { changed: false, error: 'Not a git repository (no .git dir)' };
  }

  // `.git/hooks` is normally created by `git init`, but some templates / configs
  // (init.templateDir, core.hooksPath) skip it. Ensure it exists before writing.
  const hooksDir = path.join(gitDir, 'hooks');
  if (!dryRun) fs.mkdirSync(hooksDir, { recursive: true });

  const hookFile = path.join(hooksDir, 'pre-commit');
  const MARKER_START = '# >>> THUMBGATE_PROOF_GATE — injected by npx thumbgate wire-proof. Do not remove.';
  const MARKER_END = '# <<< THUMBGATE_PROOF_GATE';

  const nodeCmd = `node "${runnerAbs}" || exit 1`;
  const block = `${MARKER_START}\n${nodeCmd}\n${MARKER_END}\n`;

  let originalContent = '';
  let existed = false;
  if (fs.existsSync(hookFile)) {
    existed = true;
    originalContent = fs.readFileSync(hookFile, 'utf8');
    if (originalContent.includes(MARKER_START)) {
      // Idempotent replace
      const replaced = originalContent.replace(
        new RegExp(MARKER_START + '[\\s\\S]*?' + MARKER_END + '\\n?'),
        block
      );
      if (replaced === originalContent) {
        return { changed: false, hookFile, mode: 'git-pre-commit', alreadyPresent: true };
      }
      if (!dryRun) {
        fs.writeFileSync(hookFile, replaced);
        fs.chmodSync(hookFile, 0o700);
      }
      return { changed: true, hookFile, mode: 'git-pre-commit', replaced: true };
    }
  }

  let newContent;
  if (!existed || originalContent.trim().length === 0) {
    newContent = '#!/bin/bash\nset -e\n\n' + block + '\n# (Add other pre-commit checks above or below this block)\n';
  } else {
    // Append at end (reliable, proof still gates the commit)
    newContent = originalContent;
    if (!newContent.endsWith('\n')) newContent += '\n';
    newContent += '\n' + block;
  }

  if (!dryRun) {
    fs.writeFileSync(hookFile, newContent);
    fs.chmodSync(hookFile, 0o700);
  }

  return {
    changed: true,
    hookFile,
    mode: 'git-pre-commit',
    created: !existed,
  };
}

/**
 * Wire proof as PreToolUse in the *project-local* Claude settings (scoped to this workspace).
 * Smart fast-path lives inside the runner.
 */
function wireClaudePreToolUse(targetDir, runnerAbs, dryRun) {
  const projectSettings = claudeProjectSettingsPath(targetDir);
  const dir = path.dirname(projectSettings);
  if (!fs.existsSync(dir)) {
    if (!dryRun) fs.mkdirSync(dir, { recursive: true });
  }

  let settings = loadJsonFile(projectSettings) || {};
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  const hookCmd = `node "${runnerAbs}" --context=claude`;
  const entry = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: hookCmd }],
  };

  // Avoid duplicates (use the shared helper when available)
  if (hookAlreadyPresent(settings.hooks.PreToolUse, hookCmd)) {
    return { changed: false, settingsPath: projectSettings, alreadyPresent: true };
  }

  settings.hooks.PreToolUse.push(entry);

  if (!dryRun) {
    fs.writeFileSync(projectSettings, JSON.stringify(settings, null, 2) + '\n');
  }

  return {
    changed: true,
    settingsPath: projectSettings,
    added: [{ lifecycle: 'PreToolUse', command: hookCmd }],
  };
}

function wireProofGate(options = {}) {
  const targetDir = path.resolve(options.targetDir || process.cwd());
  const explicitScript = options.script || options['proof-script'] || null;
  const doGit = options.git !== false; // default true
  const doClaude = !!options.claude;
  const dryRun = !!options['dry-run'] || !!options.dryRun;
  const yes = !!options.yes || !!options.y;

  const result = {
    targetDir,
    detected: [],
    chosenScript: null,
    actions: [],
    evidenceDir: path.join(targetDir, '.thumbgate', 'evidence'),
    changed: false,
    dryRun,
  };

  // 1. Detection
  let candidates = detectProofScripts(targetDir);
  result.detected = candidates;

  let chosen = explicitScript;
  if (!chosen) {
    if (candidates.length === 0) {
      result.error = 'No proof scripts detected. Use --script <relative-or-abs-path> (e.g. scripts/upwork_proof.py)';
      return result;
    }
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      // Non-interactive: pick the first (highest priority: scripts/ + shortest)
      chosen = candidates[0];
      result.note = `Multiple proof scripts found; selected highest-priority: ${chosen}. Use --script to pick another.`;
    }
  } else {
    // Normalize explicit to relative if inside target
    if (path.isAbsolute(chosen)) {
      const rel = path.relative(targetDir, chosen);
      if (!rel.startsWith('..')) chosen = rel.split(path.sep).join('/');
    }
  }

  if (!chosen) {
    result.error = 'Could not determine which proof script to wire.';
    return result;
  }
  result.chosenScript = chosen;

  const proofAbsForDisplay = path.join(targetDir, chosen);

  // 2. Preview / confirmation gate
  const plan = [];
  if (doGit) plan.push('git pre-commit hook (blocks commit on proof failure)');
  if (doClaude) plan.push('Claude Code PreToolUse (blocks git commit Bash calls on proof failure)');
  result.plan = plan;

  // Preview (write nothing) on an explicit --dry-run OR when not confirmed with --yes.
  if (dryRun || !yes) {
    result.previewOnly = true;
    result.message = dryRun
      ? 'Dry run — no files written.'
      : 'Preview only (add --yes to apply changes).';
    return result;
  }

  // 3. Write runner + config (always, even if only one mode)
  const { runnerPath } = writeRunnerAndConfig(targetDir, chosen);
  const runnerAbs = runnerPath;
  result.runner = runnerPath;
  result.actions.push(`Wrote proof runner: ${path.relative(targetDir, runnerPath)}`);

  // 4. Git wiring
  if (doGit) {
    const gitRes = wireGitPreCommit(targetDir, runnerAbs, dryRun);
    if (gitRes.error) {
      result.actions.push(`Git wiring skipped: ${gitRes.error}`);
    } else if (gitRes.changed) {
      result.changed = true;
      result.actions.push(`Git pre-commit gate wired → ${path.relative(targetDir, gitRes.hookFile)}`);
    } else {
      result.actions.push('Git pre-commit gate already present (idempotent).');
    }
  }

  // 5. Claude wiring (project-scoped)
  if (doClaude) {
    const claudeRes = wireClaudePreToolUse(targetDir, runnerAbs, dryRun);
    if (claudeRes.changed) {
      result.changed = true;
      result.actions.push(`Claude PreToolUse proof gate wired → ${path.relative(targetDir, claudeRes.settingsPath)}`);
    } else if (claudeRes.alreadyPresent) {
      result.actions.push('Claude PreToolUse proof gate already present (idempotent).');
    } else {
      result.actions.push('Claude wiring: no changes.');
    }
  }

  // 6. Smoke: create a tiny "last-wired" marker so Ralph can see the harness is active
  try {
    const marker = path.join(targetDir, '.thumbgate', 'evidence', 'proof-gate-active.json');
    fs.writeFileSync(marker, JSON.stringify({
      installedAt: new Date().toISOString(),
      script: chosen,
      modes: { git: doGit, claude: doClaude },
      runner: path.relative(targetDir, runnerPath),
      ralphLoop: true,
    }, null, 2) + '\n');
  } catch (_) {}

  result.success = true;
  return result;
}

// CLI entry when run directly
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const args = {};
  const raw = process.argv.slice(2);
  raw.forEach((arg, i) => {
    if (arg.startsWith('--')) {
      const [k, ...rest] = arg.slice(2).split('=');
      if (rest.length) args[k] = rest.join('=');
      else if (raw[i + 1] && !raw[i + 1].startsWith('--')) args[k] = raw[i + 1];
      else args[k] = true;
    }
  });

  const res = wireProofGate({
    targetDir: args.target,
    script: args.script || args['proof-script'],
    git: args.git !== 'false',
    claude: !!args.claude,
    yes: !!args.yes || !!args.y,
    dryRun: !!args['dry-run'],
  });

  console.log('');
  console.log('thumbgate wire-proof');
  console.log('────────────────────');
  console.log(`Target: ${res.targetDir}`);
  if (res.detected && res.detected.length) {
    console.log(`Detected proof scripts: ${res.detected.join(', ')}`);
  }
  if (res.chosenScript) {
    console.log(`Using: ${res.chosenScript}`);
  }
  if (res.note) console.log(res.note);
  if (res.plan && res.plan.length) {
    console.log('Plan:');
    res.plan.forEach(p => console.log(`  • ${p}`));
  }
  if (res.previewOnly) {
    console.log('');
    console.log('Add --yes to apply (or --dry-run to see file diffs).');
    process.exit(0);
  }
  if (res.error) {
    console.error('Error: ' + res.error);
    process.exit(1);
  }
  console.log('');
  res.actions.forEach(a => console.log('  ' + a));
  if (res.runner) {
    console.log('');
    console.log('Runner + evidence config ready.');
    console.log(`  Evidence dir: ${path.relative(res.targetDir, res.evidenceDir)}/`);
    console.log('  (Ralph Loop consumers: read last-proof-run.json after any proof execution)');
  }
  if (res.changed) {
    console.log('');
    console.log('✅ Proof gate(s) installed and active.');
    if (res.actions.some(a => a.includes('Claude'))) {
      console.log('   Restart Claude Code for PreToolUse hooks to load.');
    }
    console.log('   Test: make a small change and attempt the gated action (commit / Bash git commit).');
  } else {
    console.log('');
    console.log('No new changes (already wired or dry-run).');
  }
  console.log('');
  process.exit(0);
}

module.exports = {
  detectProofScripts,
  wireProofGate,
  writeEvidence, // exposed for tests
};
