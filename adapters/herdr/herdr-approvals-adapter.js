'use strict';

/**
 * ThumbGate Approvals Adapter for Herdr (herdr.dev) Terminal Multiplexer.
 *
 * Intercepts tool use and terminal command events across active Herdr agent panes,
 * evaluating them against ThumbGate's local prevention rules, spend guard, and
 * workflow sentinel before execution.
 */

const { evaluateLocal, DENY_REASON } = require('../../docs/guard/spend-guard-decision-diff');

/**
 * Handle Herdr pre-action interception hook.
 *
 * @param {Object} event - Herdr tool/command event payload
 * @param {string} event.paneId - ID of the originating Herdr pane
 * @param {string} event.agentIdentity - Agent name/model (e.g. claude-code, codex)
 * @param {string} event.toolName - Intercepted tool name or 'Bash'
 * @param {Object|string} event.toolInput - Tool input parameters or command string
 * @returns {Object} Verdict payload for Herdr multiplexer ({ decision: 'allow'|'deny'|'require_approval', reason?: string })
 */
function handleHerdrEvent(event) {
  const { paneId, agentIdentity, toolName = 'Bash', toolInput = {} } = event || {};

  // Run local spend guard and rule evaluation
  const spendVerdict = evaluateLocal(toolName, toolInput, 'new');
  if (spendVerdict && spendVerdict.decision === 'deny') {
    return {
      decision: 'deny',
      ruleId: spendVerdict.ruleId,
      reason: `${DENY_REASON} [Rule: ${spendVerdict.ruleId} | Pane: ${paneId || 'default'} | Agent: ${agentIdentity || 'unknown'}]`,
      hookSpecificOutput: {
        hookName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${DENY_REASON} [Rule: ${spendVerdict.ruleId}]`,
      },
    };
  }

  return {
    decision: 'allow',
    paneId,
    agentIdentity,
    hookSpecificOutput: {
      hookName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  };
}

module.exports = { handleHerdrEvent };
