'use strict';

// The PreToolUse verdict that `thumbgate gate-check` prints, as a function, so
// other hook surfaces (PreSkillShellCommand, scripts/skill-shell-gate.js) run the
// exact same checks in the same order instead of a copy that drifts.

function denyOutput(reason, extra = {}) {
  return JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      ...extra,
    },
  });
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

  return gatesEngine.runAsync(input);
}

module.exports = { evaluateGateCheck };
