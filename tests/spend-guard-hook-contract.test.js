'use strict';

// End-to-end cover for the money guard AS A HOOK PROCESS.
//
// The precision test covers the matcher in isolation. This one spawns the guard
// the way the runtime does — PreToolUse JSON on stdin — and asserts both halves
// of the contract:
//   1. decision:  ordinary developer payloads pass, real commerce payloads deny
//   2. transport: stdout is either empty or exactly one JSON object
//
// (2) exists because a hook that emits malformed stdout surfaces to the user as
// "Hook JSON output validation failed - (root): Invalid input", which is
// indistinguishable from a policy denial and hides the real decision.
//
// Vectors are derived from the pattern so this file never embeds the tokens it
// tests, and so it stays correct if the token list changes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'scripts', 'thumbgate-spend-guard.js');
const { evaluateSpend } = require(GUARD);

function matcher() {
  const src = fs.readFileSync(GUARD, 'utf8');
  const m = src.match(/const DIRECT_CHECKOUT_PATH\s*=\s*(\/[\s\S]*?\/i);/);
  assert.ok(m, 'commerce-path matcher not found');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

function tokens() {
  const inner = matcher().source.match(/\[\\\/#\]\(\?:([^)]+)\)/);
  assert.ok(inner, 'expected character-class prefixed token group');
  return inner[1].split('|').map((t) => t.replace(/\?$/, ''));
}

function hosts() {
  return [...new Set(matcher().source.match(/[a-z]+\\\.[a-z]+\\\.[a-z]+/g) || [])]
    .map((h) => h.replace(/\\/g, ''));
}

function runGuard(payload) {
  const res = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

// A hook must emit nothing, or exactly one JSON object that VALIDATES against
// Claude Code's PreToolUse hook-output schema (root keys, enum values, and the
// hookSpecificOutput key set) — not merely something JSON.parse accepts. A root
// {"decision":"allow"} parses fine and still fails validation ("allow" is not
// in the root approve|block enum) — that exact shape caused the 2026-08-05
// errors-on-every-tool-call incident across all sessions.
const ROOT_KEYS = new Set([
  'continue', 'stopReason', 'suppressOutput', 'decision', 'reason',
  'systemMessage', 'hookSpecificOutput',
]);
const ROOT_DECISIONS = new Set(['approve', 'block']);
const HSO_KEYS = new Set([
  'hookEventName', 'permissionDecision', 'permissionDecisionReason', 'additionalContext',
]);
const PERMISSION_DECISIONS = new Set(['allow', 'deny', 'ask']);

function assertTransportContract(out, label) {
  if (out.stdout === '') return;
  const lines = out.stdout.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, `${label}: stdout must be empty or exactly one JSON line`);
  let parsed;
  assert.doesNotThrow(
    () => { parsed = JSON.parse(lines[0]); },
    `${label}: stdout must be empty or exactly one JSON object, got: ${out.stdout.slice(0, 200)}`,
  );
  assert.equal(typeof parsed, 'object', `${label}: stdout JSON must be an object`);
  assert.notEqual(parsed, null, `${label}: stdout JSON must not be null`);
  assert.ok(!Array.isArray(parsed), `${label}: stdout JSON must not be an array`);
  for (const key of Object.keys(parsed)) {
    assert.ok(ROOT_KEYS.has(key), `${label}: root key "${key}" is not in the hook-output schema`);
  }
  if ('decision' in parsed) {
    assert.ok(
      ROOT_DECISIONS.has(parsed.decision),
      `${label}: root decision "${parsed.decision}" invalid — the schema allows only approve|block`,
    );
  }
  if ('hookSpecificOutput' in parsed) {
    const hso = parsed.hookSpecificOutput;
    assert.equal(typeof hso, 'object', `${label}: hookSpecificOutput must be an object`);
    assert.notEqual(hso, null, `${label}: hookSpecificOutput must not be null`);
    for (const key of Object.keys(hso)) {
      assert.ok(HSO_KEYS.has(key), `${label}: hookSpecificOutput key "${key}" is not in the schema`);
    }
    assert.equal(hso.hookEventName, 'PreToolUse', `${label}: hookEventName must be PreToolUse`);
    if ('permissionDecision' in hso) {
      assert.ok(
        PERMISSION_DECISIONS.has(hso.permissionDecision),
        `${label}: permissionDecision "${hso.permissionDecision}" invalid`,
      );
    }
    if ('permissionDecisionReason' in hso) {
      assert.equal(typeof hso.permissionDecisionReason, 'string', `${label}: reason must be a string`);
    }
    if ('additionalContext' in hso) {
      assert.equal(typeof hso.additionalContext, 'string', `${label}: additionalContext must be a string`);
    }
  }
}

test('ordinary developer payloads are not denied', () => {
  for (const token of tokens()) {
    for (const payload of [
      { tool_name: 'Bash', tool_input: { command: `vcs ${token} -b feature/x` } },
      { tool_name: 'Write', tool_input: { file_path: 'a.py', content: `"""describe the ${token} tier."""` } },
    ]) {
      const out = runGuard(payload);
      assert.equal(out.stdout, '', `allow/${token}: an allow must be silent — any stdout risks schema rejection`);
      assert.equal(out.code, 0, `"${token}" in ordinary context must not be denied (stderr: ${out.stderr.slice(0, 160)})`);
    }
  }
});

test('real commerce payloads are still denied', () => {
  const urls = [
    ...hosts().map((h) => `https://${h}/session/abc`),
    ...tokens().map((t) => `https://vendor.example.com/${t}`),
  ];
  for (const url of urls) {
    const out = runGuard({ tool_name: 'WebFetch', tool_input: { url } });
    assertTransportContract(out, `deny/${url}`);
    assert.notEqual(out.code, 0, `${url} must stay denied`);
    const parsed = JSON.parse(out.stdout);
    assert.equal(
      parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision,
      'deny',
      `${url}: deny must be expressed as hookSpecificOutput.permissionDecision`,
    );
  }
});

test('the hook honours its stdout transport contract on every path', () => {
  const samples = [
    { tool_name: 'Bash', tool_input: { command: 'git status' } },
    { tool_name: 'Read', tool_input: { file_path: 'README.md' } },
    { tool_name: 'WebFetch', tool_input: { url: `https://${hosts()[0]}/x` } },
  ];
  for (const payload of samples) {
    assertTransportContract(runGuard(payload), `transport/${payload.tool_name}`);
  }
});

test('remedy-tool prose and quoted issue bodies are not commerce actions (#3523)', () => {
  const payloads = [
    {
      tool_name: 'mcp__thumbgate__satisfy_gate',
      tool_input: {
        gate: 'pr_threads_checked',
        evidence: 'blocked because evidence mentioned checkout of the working copy',
      },
    },
    {
      tool_name: 'capture_feedback',
      tool_input: {
        signal: 'down',
        context: 'commerce matcher fired on checkout in a git sense',
        whatWentWrong: 'create of a GitHub issue quoting checkout',
      },
    },
    {
      tool_name: 'Bash',
      tool_input: {
        command: 'gh issue create --title bug --body "matcher fired on checkout and chmod 755"',
      },
    },
  ];
  for (const payload of payloads) {
    const out = runGuard(payload);
    assert.equal(out.stdout, '', `allow/${payload.tool_name}: prose must be silent`);
    assert.equal(out.code, 0, `${payload.tool_name} prose must not be a HARD BLOCK (stderr: ${out.stderr.slice(0, 160)})`);
  }
});

test('file-content tools do not treat prose or SQL as spend', () => {
  const cases = [
    ['Write', {
      file_path: 'report.md',
      content: `Currency example: $1,234.56.\n${'ordinary prose '.repeat(20)}Update the appendix.`,
    }],
    ['Edit', {
      file_path: 'analysis.sql',
      old_string: 'Invoice',
      new_string: 'UPDATE records SET status = 1',
    }],
    ['NotebookEdit', {
      notebook_path: 'analysis.ipynb',
      new_source: 'Update the invoice-formatting example.',
    }],
  ];

  for (const [toolName, toolInput] of cases) {
    assert.deepEqual(evaluateSpend(toolName, toolInput), { decision: 'allow' });
  }
});

test('financial action and object must be within 80 characters', () => {
  const far = evaluateSpend('Bash', {
    command: `update ${'ordinary '.repeat(20)}billing documentation`,
  });
  assert.deepEqual(far, { decision: 'allow' });

  const nearby = evaluateSpend('Bash', {
    command: 'update billing plan to professional tier',
  });
  assert.equal(nearby.decision, 'deny');
  assert.equal(nearby.ruleId, 'financial_action_and_object');
});

test('vendor prose is allowed while interactive spend remains denied', () => {
  assert.deepEqual(
    evaluateSpend('Write', {
      file_path: 'notes.md',
      content: 'OpenAI documentation describes pro features and paid credits.',
    }),
    { decision: 'allow' },
  );

  const interactive = evaluateSpend('mcp__browseros_neo__act', {
    kind: 'click',
    url: 'https://checkout.stripe.com/c/pay/test',
  });
  assert.equal(interactive.decision, 'deny');
  assert.equal(interactive.ruleId, 'interactive_spend_ui');
});

test('direct purchase and guard-tampering controls remain denied', () => {
  const direct = evaluateSpend('domain_purchase', { domain: 'example.com' });
  assert.equal(direct.decision, 'deny');
  assert.equal(direct.ruleId, 'purchase_tool');

  const tampering = evaluateSpend('Bash', {
    command: 'chmod u+w ~/.thumbgate/bin/thumbgate-spend-guard.js',
  });
  assert.equal(tampering.decision, 'deny');
  assert.equal(tampering.ruleId, 'guard_tampering');
});

test('raw payment APIs, Chrome left clicks, and bare-price clicks are denied', () => {
  const rawPaymentApi = evaluateSpend('Bash', {
    command: 'curl -X POST https://api.stripe.com/v1/charges -d amount=4999',
  });
  assert.equal(rawPaymentApi.decision, 'deny');
  assert.equal(rawPaymentApi.ruleId, 'payment_api_mutation');

  const chromeLeftClick = evaluateSpend('mcp__chrome__computer', {
    action: 'left_click',
    text: 'Stripe Pro',
  });
  assert.equal(chromeLeftClick.decision, 'deny');
  assert.equal(chromeLeftClick.ruleId, 'interactive_spend_ui');

  const barePriceClick = evaluateSpend('mcp__browser__click', {
    element: 'Complete order for $49.99',
  });
  assert.equal(barePriceClick.decision, 'deny');
  assert.equal(barePriceClick.ruleId, 'interactive_spend_ui');
});

test('dollar amounts, padded structured plan changes, DELETE APIs, and inert notebooks stay gated', () => {
  for (const command of [
    'charge $588 now',
    'pay $588 now',
    'curl -X POST https://api.vendor.com/charge -d amount=$588',
  ]) {
    const verdict = evaluateSpend('Bash', { command });
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.ruleId, 'financial_action_and_object', command);
  }

  const padded = evaluateSpend('mcp__vendor__account', {
    action: 'update',
    account: 'acct_1',
    metadata: 'x'.repeat(100),
    plan: 'professional tier',
  });
  assert.equal(padded.decision, 'deny');
  assert.equal(padded.ruleId, 'financial_action_and_object');

  const deleted = evaluateSpend('Bash', {
    command: 'curl -X DELETE https://api.stripe.com/v1/subscriptions/sub_123',
  });
  assert.equal(deleted.decision, 'deny');
  assert.equal(deleted.ruleId, 'payment_api_mutation');

  assert.deepEqual(
    evaluateSpend('NotebookEdit', {
      notebook_path: 'docs/analysis.ipynb',
      new_source: 'See https://checkout.stripe.com/c/pay/cs_test and api.stripe.com/v1/charges',
    }),
    { decision: 'allow' },
  );
});

test('read-only payment APIs and inert price prose remain allowed', () => {
  assert.deepEqual(
    evaluateSpend('Bash', {
      command: 'curl https://api.stripe.com/v1/charges?limit=1',
    }),
    { decision: 'allow' },
  );

  assert.deepEqual(
    evaluateSpend('Write', {
      file_path: 'pricing-notes.md',
      content: 'The historical price was $49.99.',
    }),
    { decision: 'allow' },
  );
});
