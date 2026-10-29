'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  compileCatalogLines,
  evaluateA2uiFastUiPretool,
} = require('../scripts/a2ui-fast-ui-gate');

const ROOT = path.resolve(__dirname, '..');
const INSTALL_VERB = 'npm install';

test('read, edit, and bash stay allowed', () => {
  for (const call of [
    { toolName: 'Read', toolInput: { file_path: 'scripts/a2ui-fast-ui-gate.js' } },
    { toolName: 'Edit', toolInput: { file_path: 'public/index.html', old_string: 'a', new_string: 'b' } },
    { toolName: 'Bash', toolInput: { command: 'ls scripts' } },
    { toolName: 'Write', toolInput: { file_path: 'notes.md', content: 'the checkout page explains the price' } },
  ]) {
    const verdict = evaluateA2uiFastUiPretool(call);
    assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers));
  }
});

test('an empty call is allowed', () => {
  const verdict = evaluateA2uiFastUiPretool();
  assert.equal(verdict.ok, true);
  assert.equal(verdict.source, 'google-a2ui-2026-10-27');
});

test('a catalog line compiles to surface messages', () => {
  const compiled = compileCatalogLines({
    catalog: ['Card', 'Text'],
    source: [
      'surface("billing")',
      'root = Card(_)',
      'title = Text("Plan")',
      '$/title = "Plan"',
    ].join('\n'),
  });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.surfaceId, 'billing');
  assert.deepEqual(compiled.messages.map((row) => row.kind), ['surface', 'data', 'components']);
  assert.equal(compiled.messages[2].components[0].args.length, 0);
});

test('a macro fills a system value and a literal price is rejected', () => {
  const allowed = compileCatalogLines({
    catalog: ['Card'],
    source: 'root = Card("ok")\n$/price = OrderStatus("ord_42")',
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.dataModel.price, { macro: 'OrderStatus', id: 'ord_42' });

  const denied = compileCatalogLines({
    catalog: ['Card'],
    source: 'root = Card("ok")\n$/price = "19"',
  });
  assert.equal(denied.ok, false);
  assert.ok(denied.errors.some((error) => error.reason === 'system_value_needs_macro'));
});

test('a component outside the catalog is denied', () => {
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: {
      catalog: ['Card'],
      express: 'root = Dialog("upgrade")',
    },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('a2ui_component_outside_catalog'));
});

test('a literal system value in the express field is denied', () => {
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: {
      catalog: ['Card'],
      express: 'root = Card("ok")\n$/orderStatus = "paid"',
    },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('a2ui_system_value_needs_macro'));
});

test('eval in a catalog line is denied', () => {
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: {
      catalog: ['Card'],
      express: 'root = Card("ok")\neval("alert(1)")',
    },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('a2ui_arbitrary_code'));
});

test('a checkout screen without a layout id is denied', () => {
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: {
      catalog: ['Card'],
      express: 'root = Card("pay")',
      screenArchetype: 'checkout',
    },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('a2ui_known_screen_needs_layout'));
});

test('the same checkout with a declared layout is allowed', () => {
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: {
      catalog: ['Card'],
      express: 'root = Card("pay")',
      screenArchetype: 'checkout',
      layoutId: 'checkout',
    },
  });
  assert.equal(verdict.ok, true);
});

test('raw transport json is denied when a catalog is set', () => {
  const marker = ['update', 'Components'].join('');
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: {
      catalog: ['Card'],
      express: `root = Card("ok")\n${marker}`,
    },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('a2ui_raw_transport_json'));
});

test('installing the vendor SDK is denied', () => {
  const verdict = evaluateA2uiFastUiPretool({
    toolName: 'Bash',
    toolInput: { command: `${INSTALL_VERB} ${INSTALL_PKG}` },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('a2ui_sdk_install_denied'));
});

test('the gate does not store vendor speed figures and stays out of the npm file list', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const src = fs.readFileSync(path.join(ROOT, 'scripts/a2ui-fast-ui-gate.js'), 'utf8');
  assert.equal(pkg.files.includes('scripts/a2ui-fast-ui-gate.js'), false);
  assert.match(pkg.scripts['test:gates'], /tests\/a2ui-fast-ui-gate\.test\.js/);
  assert.doesNotMatch(src, /80x|3x fewer|gemini-3\.5|thinking off/i);
});

test('the hook calls the gate and fail-opens', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'scripts/hook-pre-tool-use.js'), 'utf8');
  const start = hook.indexOf("require('./a2ui-fast-ui-gate')");
  assert.ok(start > 0);
  const window = hook.slice(Math.max(0, start - 80), start + 360);
  assert.match(window, /try \{/);
  assert.match(window, /failOpen\(err\)/);
  assert.match(window, /a2ui-fast-ui:/);
});

test('the live hook denies an off-catalog component and allows ls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-a2ui-hook-'));
  const hook = path.join(ROOT, 'scripts/hook-pre-tool-use.js');
  function run(toolInput) {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        cwd: dir,
        tool_input: toolInput,
      }),
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: path.join(dir, 'feedback'),
        THUMBGATE_HOOKS_ENFORCE: '',
        THUMBGATE_AUTOGATE_PR_COMMITS: '',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout || '{}');
  }
  try {
    const denied = run({
      command: 'node render-ui.js',
      catalog: ['Card'],
      express: 'root = Dialog("upgrade")',
    });
    assert.equal(denied.decision, 'block');
    assert.match(String(denied.reason || ''), /a2ui-fast-ui: a2ui_component_outside_catalog/);
    const allowed = run({ command: 'ls scripts' });
    assert.notEqual(allowed.decision, 'block');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writing this gate and its test stays allowed', () => {
  for (const name of [
    'scripts/a2ui-fast-ui-gate.js',
    'tests/a2ui-fast-ui-gate.test.js',
    'scripts/hook-pre-tool-use.js',
  ]) {
    const verdict = evaluateA2uiFastUiPretool({
      toolName: 'Write',
      toolInput: { file_path: name, content: fs.readFileSync(path.join(ROOT, name), 'utf8') },
    });
    assert.equal(verdict.ok, true, `${name} ${verdict.blockers.join(',')}`);
  }
});

const INSTALL_PKG = '@a2ui/agent';
