'use strict';

// The verdict `thumbgate gate-check` prints, shared with scripts/skill-shell-gate.js.

function denyOutput(reason, extra = {}) {
  return JSON.stringify({ decision: 'block', reason,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason, ...extra } });
}

async function evaluateGateCheck(input = {}, options = {}) {
  const env = options.env || process.env;
  const gatesEngine = require('./gates-engine');
  const toolName = input.tool_name || input.toolName;
  const toolInput = input.tool_input || input.toolInput || {};
  const cwd = input.cwd || process.cwd();

  const { evaluatePreToolUse } = require('./token-shunt-honesty');
  const shunt = evaluatePreToolUse({ toolName, toolInput, cwd });
  if (shunt && shunt.ok === false) {
    return denyOutput(`token-shunt: ${shunt.reason}`);
  }

  const { evaluateMcpPreToolUse } = require('./third-author-governance');
  const thirdAuthor = evaluateMcpPreToolUse({
    toolName,
    toolInput,
    authorContext: { isAgent: true, cwd },
  });
  if (thirdAuthor && thirdAuthor.permissionDecision === 'deny') {
    return denyOutput(thirdAuthor.permissionDecisionReason, {
      findingId: thirdAuthor.findingId,
      alternatives: thirdAuthor.alternatives,
    });
  }

  // The operator bypass only skips advisory and strict-mode gates. Security and
  // self-protection floors are evaluated before the early approval path.
  if (env.THUMBGATE_HOTFIX_BYPASS === '1') {
    const hardFloorOutput = gatesEngine.runHardFloor(input);
    if (hardFloorOutput) return hardFloorOutput;
    return JSON.stringify({
      decision: 'approve',
      reason: 'operator-bypass-opt-in',
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '' },
    });
  }

  const output = await gatesEngine.runAsync(input);
  // Opt-in (`thumbgate auto-approve on`): a call you gave a thumbs-up skips the permission prompt.
  // Only ever upgrades a call every check above already let through.
  return require('./thumbs-up-auto-approve').applyAutoApprove(output, input, { env });
}

module.exports = { evaluateGateCheck };
