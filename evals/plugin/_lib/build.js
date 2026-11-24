'use strict';
// node evals/plugin/_lib/build.js            write evals/plugin/<case>/ for every case in cases.js
// node evals/plugin/_lib/build.js --verify   prove offline, for free, that each task is solvable
//                                            (reference passes every code grader) and each grader
//                                            can fail (the mistake / do-nothing run fails one)
// llm graders are skipped offline; they are only used where no code grader can see the outcome.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { cases } = require('./cases');

const ROOT = path.resolve(__dirname, '..');
const q = (s) => JSON.stringify(s);

function yamlGrader(g) {
  const lines = [`  - name: ${q(g.name)}`, `    type: ${g.type}`];
  if (g.type === 'regex') {
    if (g.target && g.target.source === 'file') lines.push(`    target: {source: file, path: ${q(g.target.path)}}`);
    lines.push(`    pattern: ${q(g.pattern)}`);
    if (g.flags) lines.push(`    flags: ${q(g.flags)}`);
    if (g.match) lines.push(`    match: ${g.match}`);
  } else if (g.type === 'file_exists') {
    lines.push(`    path: ${q(g.path)}`, `    exists: ${g.exists}`);
  } else if (g.type === 'llm') {
    lines.push(`    focus: ${g.focus || 'last_message'}`, `    criteria: ${q(g.criteria)}`);
  } else if (g.type === 'tool_used') {
    lines.push(`    tool: ${q(g.tool)}`);
    if (g.input_match) lines.push(`    input_match: ${q(g.input_match)}`);
    if (g.min !== undefined) lines.push(`    min: ${g.min}`);
    if (g.max !== undefined) lines.push(`    max: ${g.max}`);
  }
  return lines.join('\n');
}

function seedScript(c) {
  const lesson = c.lesson
    ? `seed_lesson ${[c.lesson.context, c.lesson.wrong, c.lesson.change, c.lesson.tags].map(shq).join(' ')}\n`
    : '# empty lesson store on purpose\n';
  return `#!/bin/bash\n# Seed for ${c.id}. Runs in an empty workspace, once per trial.\nsource "$(dirname "$0")/../_lib/common.sh"\n${c.setup}\n${lesson}`;
}
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

const GIT_NOTE = ' (Environment note: plain `git` is broken in this sandbox; run git as /Applications/Xcode.app/Contents/Developer/usr/bin/git.)';
function promptFor(c) {
  return /\bgit_init\b/.test(c.setup) ? c.prompt + GIT_NOTE : c.prompt;
}

function caseYaml(c) {
  const tags = [c.tag, c.kind === 'allowed' ? 'no-block' : 'repeat-mistake'];
  if (c.edge) tags.push('edge');
  return `schema_version: "1.0"
name: ${q(c.id)}
runs: 3
tags: [${tags.join(', ')}]
context:
  scaffold_script: seed.sh
execution:
  max_turns: 14
  timeout_seconds: 300
  allowed_tools: [Bash, Read, Write, Edit, Glob, Grep]
  prompt: ${q(promptFor(c))}
graders:
${c.graders.map(yamlGrader).join('\n')}
`;
}

function readme(c) {
  return `# ${c.id}

- Kind: ${c.kind === 'mistake' ? 'repeat mistake (the agent should NOT repeat it)' : 'allowed look-alike (the agent should be able to do it; a block is a failure)'}
- Tag: ${c.tag}${c.edge ? `\n- Edge case: ${c.edge}` : ''}
- Real source: ${c.source}
- Seeded lesson: ${c.lesson ? `"${c.lesson.wrong}" -> "${c.lesson.change}"` : 'none (empty lesson store)'}

## Reference solution
${c.expected}

\`\`\`
${c.reference === 'true' ? `(reply only) ${c.refMessage || ''}` : c.reference}
\`\`\`

## Failure it checks for
\`\`\`
${c.mistake === 'true' ? `(${c.mistakeMessage ? 'wrong reply: ' + c.mistakeMessage : 'the agent does nothing useful'})` : c.mistake}
\`\`\`
`;
}

function write() {
  for (const c of cases) {
    const dir = path.join(ROOT, c.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'case.yaml'), caseYaml(c));
    fs.writeFileSync(path.join(dir, 'seed.sh'), seedScript(c), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'README.md'), readme(c));
  }
  console.log(`wrote ${cases.length} cases`);
}

// ---------------------------------------------------------------- offline verification
function runGraders(c, ws, message, script) {
  const out = [];
  for (const g of c.graders) {
    if (g.type === 'llm') continue;
    let ok;
    if (g.type === 'tool_used') {
      // offline stand-in: the simulated agent made exactly one Bash call, the script text
      const n = g.tool === 'Bash' && new RegExp(g.input_match || '').test(script === 'true' ? '' : script) ? 1 : 0;
      ok = n >= (g.min === undefined ? 1 : g.min) && n <= (g.max === undefined ? Infinity : g.max);
    } else if (g.type === 'file_exists') ok = fs.existsSync(path.join(ws, g.path)) === g.exists;
    else if (g.type === 'regex') {
      const text = g.target && g.target.source === 'file'
        ? (fs.existsSync(path.join(ws, g.target.path)) ? fs.readFileSync(path.join(ws, g.target.path), 'utf8') : '')
        : message;
      const found = new RegExp(g.pattern, g.flags || '').test(text);
      ok = g.match === 'not_contains' ? !found : found;
    }
    out.push({ name: g.name, ok });
  }
  return out;
}

function trial(c, script, message) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `pe-${c.id}-`));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, THUMBGATE_NO_TELEMETRY: '1' };
  const seed = spawnSync('bash', [path.join(ROOT, c.id, 'seed.sh')], { cwd: ws, env, encoding: 'utf8' });
  if (seed.status !== 0) return { error: `seed failed: ${seed.stderr || seed.stdout}`.slice(0, 300) };
  const lessonSeeded = fs.existsSync(path.join(ws, '.thumbgate'));
  if (script !== 'true') {
    const r = spawnSync('bash', ['-c', script], { cwd: ws, env: { ...env, GIT_EDITOR: 'true' }, encoding: 'utf8' });
    if (r.status !== 0) { /* a failing mistake command is still an outcome */ }
  }
  const res = runGraders(c, ws, message || '', script);
  fs.rmSync(ws, { recursive: true, force: true });
  return { res, lessonSeeded };
}

function verify() {
  let bad = 0;
  for (const c of cases) {
    const ref = trial(c, c.reference, c.refMessage);
    const mis = trial(c, c.mistake, c.mistakeMessage);
    const refOk = ref.res && ref.res.every((r) => r.ok);
    const misFails = mis.res && mis.res.some((r) => !r.ok);
    const lessonOk = c.lesson ? ref.lessonSeeded : true;
    const status = ref.error || mis.error ? 'ERROR' : refOk && misFails && lessonOk ? 'ok' : 'BAD';
    if (status !== 'ok') bad++;
    console.log(`${status.padEnd(5)} ${c.id.padEnd(40)} reference=${refOk ? 'pass' : 'FAIL'} ${c.kind === 'mistake' ? 'mistake' : 'over-block'}=${misFails ? 'caught' : 'MISSED'}${c.lesson ? ` lesson=${ref.lessonSeeded ? 'seeded' : 'MISSING'}` : ' lesson=none'}${ref.error ? ' ' + ref.error : ''}${mis.error ? ' ' + mis.error : ''}${!refOk && ref.res ? ' ' + JSON.stringify(ref.res.filter((r) => !r.ok).map((r) => r.name)) : ''}`);
  }
  console.log(bad ? `${bad} case(s) need fixing` : `all ${cases.length} cases verified offline`);
  process.exit(bad ? 1 : 0);
}

write();
if (process.argv.includes('--verify')) verify();
