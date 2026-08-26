'use strict';

/**
 * WebMCP tool-declaration governance.
 *
 * WebMCP (webmachinelearning/webmcp; Chrome 149+ origin trial) lets a web page
 * expose tools to in-browser agents via document.modelContext. That creates a
 * new enforcement surface in both directions:
 *
 *   1. Pages WE ship must declare truthful, commerce-safe tools
 *      (validateToolDeclaration / auditToolRegistry — used by tests and CI).
 *   2. Agents WE govern may call tools OTHER pages expose
 *      (evaluateWebMcpPretool — PreToolUse-shaped verdicts for browser agents).
 *
 * Mirrors the repo's MCP regression gates: side-effect annotations must be
 * truthful, and payment-shaped actions never run without a human. All checks
 * are static and deterministic — no network, no browser.
 */

const READ_VOCAB_RE = /(?:^|_)(?:get|list|read|search|fetch|describe|check|status)(?:_|$)/i;
const MUTATION_VOCAB_RE = /(?:^|_)(?:create|update|delete|submit|send|post|book|buy|pay|purchase|subscribe|cancel|upgrade)(?:_|$)/i;
const COMMERCE_VOCAB_RE = /\b(?:checkout|pay|payment|purchase|buy|subscribe|subscription|billing|upgrade|order|invoice)\b/i;

function toolText(tool) {
  return `${String(tool?.name || '')} ${String(tool?.description || '')}`;
}

/**
 * Validate one WebMCP tool declaration (imperative registerTool shape, or the
 * declarative form shape with `autosubmit: true` when `toolautosubmit` is set).
 * Returns { ok, findings: [{ severity: 'block'|'warn', code, message }] }.
 */
function validateToolDeclaration(tool) {
  const findings = [];
  const add = (severity, code, message) => findings.push({ severity, code, message });

  if (!tool || typeof tool !== 'object') {
    return { ok: false, findings: [{ severity: 'block', code: 'not_an_object', message: 'Tool declaration must be an object.' }] };
  }

  const name = String(tool.name || '');
  if (!name) add('block', 'missing_name', 'Tool must declare a unique name.');
  if (!tool.description || String(tool.description).length < 10) {
    add('block', 'missing_description', 'Tool must carry an agent-facing description of what and why (>= 10 chars).');
  }
  if (tool.inputSchema != null && typeof tool.inputSchema !== 'object') {
    add('block', 'invalid_input_schema', 'inputSchema must be a JSON Schema object when present.');
  }

  const annotations = tool.annotations || {};
  const readOnly = annotations.readOnlyHint === true;
  const isReadNamed = READ_VOCAB_RE.test(name);
  const isMutationNamed = MUTATION_VOCAB_RE.test(name);
  const isCommerce = COMMERCE_VOCAB_RE.test(toolText(tool));

  // Truthful side-effect hints: the annotation must match what the name says.
  if (isReadNamed && !isMutationNamed && !readOnly) {
    add('warn', 'read_tool_without_readonly_hint', `"${name}" reads by name but does not declare annotations.readOnlyHint: true.`);
  }
  if (isMutationNamed && readOnly) {
    add('block', 'untruthful_readonly_hint', `"${name}" mutates by name but claims readOnlyHint: true — untruthful side-effect hint.`);
  }

  // Commerce-shaped tools never run agent-side without a human step.
  if (isCommerce && !readOnly) {
    if (annotations.humanConfirmationHint !== true) {
      add('block', 'commerce_without_human_confirmation', `"${name}" is commerce-shaped; it must declare annotations.humanConfirmationHint: true and route the final step to a human.`);
    }
    if (tool.autosubmit === true) {
      add('block', 'commerce_autosubmit', `"${name}" is commerce-shaped; toolautosubmit is forbidden on payment-shaped forms.`);
    }
  }

  return { ok: !findings.some((f) => f.severity === 'block'), findings };
}

/**
 * Audit a page's full tool registry: per-tool validation plus duplicate names.
 */
function auditToolRegistry(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const results = list.map((tool) => ({ name: String(tool?.name || ''), ...validateToolDeclaration(tool) }));
  const seen = new Set();
  for (const result of results) {
    if (result.name && seen.has(result.name)) {
      result.ok = false;
      result.findings.push({ severity: 'block', code: 'duplicate_tool_name', message: `Duplicate tool name "${result.name}".` });
    }
    seen.add(result.name);
  }
  const blocks = results.reduce((n, r) => n + r.findings.filter((f) => f.severity === 'block').length, 0);
  const warns = results.reduce((n, r) => n + r.findings.filter((f) => f.severity === 'warn').length, 0);
  return { ok: results.every((r) => r.ok), blocks, warns, results };
}

/**
 * PreToolUse-shaped verdict for an agent about to invoke a page-exposed
 * WebMCP tool. Deny agent-driven payment paths; warn on mutations so the
 * surrounding gate stack can decide; allow reads.
 *
 * @param {Object} action - { toolName, description, annotations, autosubmit, origin }
 */
function evaluateWebMcpPretool(action) {
  const a = action || {};
  const annotations = a.annotations || {};
  const text = `${String(a.toolName || '')} ${String(a.description || '')}`;
  const isCommerce = COMMERCE_VOCAB_RE.test(text);
  const readOnly = annotations.readOnlyHint === true;

  if (isCommerce && !readOnly) {
    return {
      decision: 'deny',
      ruleId: 'webmcp_commerce_tool',
      reason: 'Agent-initiated invocation of a commerce-shaped WebMCP tool is forbidden; a human must complete purchase flows.',
    };
  }
  if (a.autosubmit === true && !readOnly) {
    return {
      decision: 'deny',
      ruleId: 'webmcp_autosubmit_mutation',
      reason: 'Agent-invoked autosubmit on a non-read-only WebMCP form tool is forbidden.',
    };
  }
  if (!readOnly) {
    return {
      decision: 'warn',
      ruleId: 'webmcp_mutation_tool',
      reason: 'WebMCP tool does not declare readOnlyHint; treat as a mutation and apply standard gates.',
    };
  }
  return { decision: 'allow' };
}

module.exports = {
  validateToolDeclaration,
  auditToolRegistry,
  evaluateWebMcpPretool,
  READ_VOCAB_RE,
  MUTATION_VOCAB_RE,
  COMMERCE_VOCAB_RE,
};
