'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK_SCRIPT = path.resolve(__dirname, '../scripts/hook-call-budget.js');
const DOC_PATH = path.resolve(__dirname, '../docs/claude-call-budget-gate.md');

function byteLengthOfMcpResult(result) {
  assert.ok(result && Array.isArray(result.content), 'MCP result must include content[]');
  return result.content.reduce(
    (sum, block) => sum + Buffer.byteLength(String(block && block.text ? block.text : ''), 'utf8'),
    0,
  );
}

test('cost-diet item 1: capture_feedback, retrieve_lessons, recall, and search_lessons default to compact replies < 600 bytes and return full JSON with verbose: true', async () => {
  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cost-diet-mcp-'));
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevApiKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
  process.env.THUMBGATE_API_KEY = 'tg_pro_test_cost_diet_key';

  delete require.cache[require.resolve('../adapters/mcp/server-stdio')];
  const { handleRequest } = require('../adapters/mcp/server-stdio');

  try {
    // Seed 4 prior spend/context lessons so all 4 tools have multiple long candidate actions.
    for (let i = 1; i <= 4; i++) {
      await handleRequest({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: {
          name: 'capture_feedback',
          arguments: {
            signal: 'down',
            context: `MCP tool response bloated session context window with 5 KB JSON payload #${i}`,
            whatWentWrong: `Session reread 180 KB of verbose MCP JSON across 1,752 tool calls (case ${i})`,
            whatToChange: `Keep MCP tool reply #${i} compact (<600 bytes) unless verbose: true is requested by caller`,
            tags: ['token-spend', 'mcp-compact', 'context-diet'],
          },
        },
      });
    }

    // 1. capture_feedback default (< 600B) vs verbose: true
    const captureCompact = await handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'capture_feedback',
        arguments: {
          signal: 'down',
          context: 'MCP tool response bloated session context window with large JSON payload',
          whatWentWrong: 'Session reread verbose MCP JSON on every turn',
          whatToChange: 'Return compact id, status, title, and up to 3 relevant actions under 600 bytes',
          tags: ['token-spend', 'mcp-compact'],
        },
      },
    });
    const captureBytes = byteLengthOfMcpResult(captureCompact);
    assert.ok(captureBytes > 0 && captureBytes < 600, `capture_feedback default reply must be < 600 bytes, got ${captureBytes}`);
    const captureJson = JSON.parse(captureCompact.content[0].text);
    assert.ok(captureJson.id, 'compact capture_feedback includes id');
    assert.equal(captureJson.status, 'promoted');
    assert.equal(typeof captureJson.title, 'string');
    assert.ok(Array.isArray(captureJson.actions) && captureJson.actions.length <= 3);
    assert.equal(captureJson.feedbackEvent, undefined, 'compact reply omits full feedbackEvent');

    const captureVerbose = await handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'capture_feedback',
        arguments: {
          signal: 'down',
          context: 'Verbose MCP check on token spend payload',
          whatWentWrong: 'Checking verbose flag output',
          whatToChange: 'Include full JSON when verbose is true',
          tags: ['token-spend'],
          verbose: true,
        },
      },
    });
    const captureVerboseJson = JSON.parse(captureVerbose.content[0].text);
    assert.ok(captureVerboseJson.feedbackEvent, 'verbose capture_feedback includes full feedbackEvent');
    assert.ok(byteLengthOfMcpResult(captureVerbose) > captureBytes);

    // 2. retrieve_lessons default (< 600B) vs verbose: true
    const retrieveCompact = await handleRequest({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'retrieve_lessons',
        arguments: {
          toolName: 'Bash',
          actionContext: 'MCP tool response bloated session context window with 5 KB JSON payload',
          maxResults: 5,
        },
      },
    });
    const retrieveBytes = byteLengthOfMcpResult(retrieveCompact);
    assert.ok(retrieveBytes > 0 && retrieveBytes < 600, `retrieve_lessons default reply must be < 600 bytes, got ${retrieveBytes}`);
    const retrieveJson = JSON.parse(retrieveCompact.content[0].text);
    assert.equal(typeof retrieveJson.status, 'string');
    assert.equal(typeof retrieveJson.title, 'string');
    assert.ok('id' in retrieveJson);
    assert.ok(Array.isArray(retrieveJson.actions) && retrieveJson.actions.length <= 3);

    const retrieveVerbose = await handleRequest({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'retrieve_lessons',
        arguments: {
          toolName: 'Bash',
          actionContext: 'MCP tool response bloated session context window with 5 KB JSON payload',
          maxResults: 5,
          verbose: true,
        },
      },
    });
    assert.ok(Array.isArray(JSON.parse(retrieveVerbose.content[0].text)), 'verbose retrieve_lessons returns full array');

    // 3. recall default (< 600B) vs verbose: true
    const recallCompact = await handleRequest({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'recall',
        arguments: {
          query: 'MCP tool response bloated session context window',
        },
      },
    });
    const recallBytes = byteLengthOfMcpResult(recallCompact);
    assert.ok(recallBytes > 0 && recallBytes < 600, `recall default reply must be < 600 bytes, got ${recallBytes}`);
    const recallJson = JSON.parse(recallCompact.content[0].text);
    assert.ok(recallJson.id, 'compact recall includes id');
    assert.equal(typeof recallJson.status, 'string');
    assert.equal(typeof recallJson.title, 'string');
    assert.ok(Array.isArray(recallJson.actions) && recallJson.actions.length <= 3);

    const recallVerbose = await handleRequest({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: {
        name: 'recall',
        arguments: {
          query: 'MCP tool response bloated session context window',
          verbose: true,
        },
      },
    });
    const recallVerboseJson = JSON.parse(recallVerbose.content[0].text);
    assert.ok(recallVerboseJson.pack, 'verbose recall returns full pack JSON');

    // 4. search_lessons default (< 600B) vs verbose: true
    const searchCompact = await handleRequest({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'search_lessons',
        arguments: {
          query: 'MCP tool response bloated session context',
          limit: 5,
        },
      },
    });
    const searchBytes = byteLengthOfMcpResult(searchCompact);
    assert.ok(searchBytes > 0 && searchBytes < 600, `search_lessons default reply must be < 600 bytes, got ${searchBytes}`);
    const searchJson = JSON.parse(searchCompact.content[0].text);
    assert.ok('id' in searchJson);
    assert.equal(typeof searchJson.status, 'string');
    assert.equal(typeof searchJson.title, 'string');
    assert.ok(Array.isArray(searchJson.actions) && searchJson.actions.length <= 3);

    const searchVerbose = await handleRequest({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'search_lessons',
        arguments: {
          query: 'MCP tool response bloated session context',
          limit: 5,
          verbose: true,
        },
      },
    });
    const searchVerboseJson = JSON.parse(searchVerbose.content[0].text);
    assert.ok(Array.isArray(searchVerboseJson.results), 'verbose search_lessons returns full results[]');
  } finally {
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    if (prevApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = prevApiKey;
  }
});

test('cost-diet item 2: spend complaint lesson does not pull unrelated Stripe live key prefix or Dayglass index.html correctiveActions', () => {
  const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cost-diet-db-'));
  const { initDB, upsertLesson, inferCorrectiveActions } = require('../scripts/lesson-db');
  const db = initDB(path.join(tmpDbDir, 'lessons.sqlite'));

  try {
    // Seed unrelated Stripe live key lesson (general domain + generic tags)
    upsertLesson(db, {
      id: 'fb_stripe_key',
      signal: 'negative',
      context: 'Used test prefix instead of Stripe live key prefix on production checkout',
      whatWentWrong: 'Stripe secret key prefix mismatch broke checkout webhook verification',
      whatToChange: 'Verify Stripe live key prefix before deploying checkout webhook',
      tags: ['stripe', 'billing', 'general', 'claude', 'feedback'],
      richContext: { domain: 'general' },
      timestamp: new Date().toISOString(),
    }, { id: 'mem_stripe_key' });

    // Seed unrelated Dayglass index.html lesson (general domain + generic tags)
    upsertLesson(db, {
      id: 'fb_dayglass_html',
      signal: 'negative',
      context: 'Edited Dayglass index.html hero button without running verify-dayglass',
      whatWentWrong: 'Dayglass index.html layout regressed on localhost:3333',
      whatToChange: 'Always verify Dayglass index.html in Chromium before committing',
      tags: ['dayglass', 'ui', 'general', 'claude', 'feedback'],
      richContext: { domain: 'general' },
      timestamp: new Date().toISOString(),
    }, { id: 'mem_dayglass_html' });

    // Capture a spend complaint sharing generic domain='general' and generic tags ['claude', 'feedback']
    const spendComplaint = {
      id: 'fb_spend_complaint',
      signal: 'negative',
      context: 'Claude monthly spend hit $1,924 because 1,752 tool calls reread 180 KB of MCP outputs',
      whatWentWrong: 'ThumbGate fired zero hooks and added 45k tokens of bloated replies',
      whatToChange: 'Keep MCP replies under 600 bytes and gate sessions over 300 mechanical calls',
      tags: ['spend', 'token-burn', 'claude', 'feedback', 'general'],
      richContext: { domain: 'general' },
      timestamp: new Date().toISOString(),
    };

    const unrelatedActions = inferCorrectiveActions(db, spendComplaint, 3);
    assert.deepEqual(
      unrelatedActions,
      [],
      `Expected zero correctiveActions rather than Stripe/Dayglass lessons, got: ${JSON.stringify(unrelatedActions)}`,
    );

    // Also verify bare spend complaint with no tags at all still returns []
    const bareSpendComplaint = {
      id: 'fb_spend_bare',
      signal: 'negative',
      context: 'Awful token spend: session burned $1,924 rereading huge MCP JSON replies',
      whatWentWrong: 'Context bloat multiplied across 1,752 calls',
      tags: [],
      richContext: { domain: 'general' },
    };
    assert.deepEqual(inferCorrectiveActions(db, bareSpendComplaint, 3), []);

    // Now seed a genuinely relevant prior spend lesson and verify it IS returned
    upsertLesson(db, {
      id: 'fb_prior_spend',
      signal: 'negative',
      context: 'High Claude token spend from large MCP JSON replies in long session',
      whatWentWrong: 'Rereading multi-KB MCP payloads burned context budget',
      whatToChange: 'Delegate mechanical calls to a Sonnet subagent once session passes 300 calls',
      tags: ['spend', 'token-burn'],
      richContext: { domain: 'general' },
      timestamp: new Date().toISOString(),
    }, { id: 'mem_prior_spend' });

    const matchedActions = inferCorrectiveActions(db, spendComplaint, 3);
    assert.deepEqual(matchedActions, [
      'Delegate mechanical calls to a Sonnet subagent once session passes 300 calls',
    ]);
  } finally {
    db.close();
  }
});

test('cost-diet item 3: opt-in Claude Code call-budget hook counts per session, denies once past 300 on mechanical tools, allows delegation, and emits Stop call count', () => {
  const {
    DEFAULT_CALL_BUDGET_THRESHOLD,
    CALL_BUDGET_DENY_MESSAGE,
    isMechanicalTool,
    evaluateCallBudgetPreToolUse,
    formatStopCallCountLine,
  } = require('../scripts/hook-call-budget');

  assert.equal(DEFAULT_CALL_BUDGET_THRESHOLD, 300);
  assert.equal(
    CALL_BUDGET_DENY_MESSAGE,
    'This session is large; hand mechanical work to a Sonnet subagent or side session.',
  );

  // Mechanical classification: Bash, browser runs, chat search = true; Agent/Task = false
  assert.equal(isMechanicalTool('Bash'), true);
  assert.equal(isMechanicalTool('mcp__dayglass__dayglass_browser_navigate'), true);
  assert.equal(isMechanicalTool('mcp__dayglass__dayglass_search_audio'), true);
  assert.equal(isMechanicalTool('mcp__slack__chat_search'), true);
  assert.equal(isMechanicalTool('Agent'), false);
  assert.equal(isMechanicalTool('Task'), false);

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-call-budget-test-'));
  try {
    // 1..300 calls allow
    for (let i = 1; i <= 300; i++) {
      const tool = i % 3 === 0
        ? 'mcp__dayglass__dayglass_browser_snapshot'
        : (i % 5 === 0 ? 'mcp__dayglass__dayglass_search_screen' : 'Bash');
      const res = evaluateCallBudgetPreToolUse(
        { session_id: 'sess-budget-300', tool_name: tool, tool_use_id: `tu_${i}` },
        { stateDir },
      );
      assert.equal(res.decision, 'allow', `call ${i} must be allowed`);
    }

    // Call 301 on Agent (delegation to Sonnet) is NOT denied
    const delegationRes = evaluateCallBudgetPreToolUse(
      { session_id: 'sess-budget-300', tool_name: 'Agent', tool_use_id: 'tu_301_agent' },
      { stateDir },
    );
    assert.equal(delegationRes.decision, 'allow', 'Agent delegation must never be denied');

    // Next mechanical call (302 total > 300, mechanical = true, not yet denied) DENIES ONCE
    const denied = evaluateCallBudgetPreToolUse(
      { session_id: 'sess-budget-300', tool_name: 'Bash', tool_use_id: 'tu_302_bash' },
      { stateDir },
    );
    assert.equal(denied.decision, 'block');
    assert.equal(denied.reason, CALL_BUDGET_DENY_MESSAGE);
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(denied.hookSpecificOutput.permissionDecisionReason, CALL_BUDGET_DENY_MESSAGE);

    // Subsequent mechanical call in same session is ALLOWED (denies once only)
    const afterDeny = evaluateCallBudgetPreToolUse(
      { session_id: 'sess-budget-300', tool_name: 'Bash', tool_use_id: 'tu_303_bash' },
      { stateDir },
    );
    assert.equal(afterDeny.decision, 'allow', 'must deny only once per session');

    // Stop-time line reports the session's call count
    const stopLine = formatStopCallCountLine({ session_id: 'sess-budget-300' }, { stateDir });
    assert.match(stopLine, /sess-budget-300/);
    assert.match(stopLine, /\b303 tool calls\b/);

    // Subprocess CLI smoke check (PreToolUse deny + Stop JSON line)
    const cliStateDir = path.join(stateDir, 'cli');
    for (let i = 1; i <= 3; i++) {
      const r = spawnSync(process.execPath, [HOOK_SCRIPT, '--threshold=3'], {
        input: JSON.stringify({ session_id: 'cli-sess', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: `c_${i}` }),
        env: { ...process.env, THUMBGATE_CALL_BUDGET_DIR: cliStateDir },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0);
      assert.deepEqual(JSON.parse(r.stdout), {});
    }
    const cliDeny = spawnSync(process.execPath, [HOOK_SCRIPT, '--threshold=3'], {
      input: JSON.stringify({ session_id: 'cli-sess', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'c_4' }),
      env: { ...process.env, THUMBGATE_CALL_BUDGET_DIR: cliStateDir },
      encoding: 'utf8',
    });
    assert.equal(cliDeny.status, 0);
    const cliDenyJson = JSON.parse(cliDeny.stdout);
    assert.equal(cliDenyJson.decision, 'block');
    assert.equal(cliDenyJson.reason, CALL_BUDGET_DENY_MESSAGE);

    const cliStop = spawnSync(process.execPath, [HOOK_SCRIPT, '--stop'], {
      input: JSON.stringify({ session_id: 'cli-sess', hook_event_name: 'Stop' }),
      env: { ...process.env, THUMBGATE_CALL_BUDGET_DIR: cliStateDir },
      encoding: 'utf8',
    });
    assert.equal(cliStop.status, 0);
    const cliStopJson = JSON.parse(cliStop.stdout.trim());
    assert.match(cliStopJson.systemMessage, /Session cli-sess call count: 4 tool calls \(4 mechanical\)\./);

    // Documentation exists and instructs how to enable in ~/.claude/settings.json
    assert.equal(fs.existsSync(DOC_PATH), true);
    const doc = fs.readFileSync(DOC_PATH, 'utf8');
    assert.match(doc, /~\/\.claude\/settings\.json/);
    assert.match(doc, /hook-call-budget\.js/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
