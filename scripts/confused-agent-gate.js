'use strict';

// Sarbjeet Johal, 27 October 2026, quoting Kiyu Gabriel at IBM TechXchange:
// https://x.com/sarbjeetjohal/status/2115073742321713223
// https://www.ibm.com/think/news/live-from-techxchange-2026
// Federation that only exchanges status does little useful work.
// A consolidated copy that arrives later is a stale authority.
// Ambiguous context, conflicting facts, and an unclear tool boundary
// are denied before a write. A production deploy names the confusion check.
// This module does not install Streamhouse, Confluent, watsonx, Vault, or
// IBM Agent Identity. Figures in the IBM article are not stored here.
// Agent identity and least privilege stay on the email-strategy gate.

const SOURCE = 'ibm-techxchange-confused-agents-2026-10-27';

const WRITE_TOOL_RE = /write|edit|bash|shell|exec|notebook|multiedit|apply_patch/i;

function isWriteTool(toolName) {
  return WRITE_TOOL_RE.test(String(toolName || ''));
}

function payloadText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  const keys = ['command', 'cmd', 'path', 'file_path', 'target_file', 'contents', 'content', 'new_string', 'body'];
  return keys.map((key) => (toolInput[key] == null ? '' : String(toolInput[key]))).join('\n');
}

function staleCopyIsAuthority(text) {
  const copy = /\b(?:snapshot|export|lakehouse copy|consolidated copy|consolidated dump)\b[\s\S]{0,140}\b(?:as (?:the )?(?:current|live)|source of truth|authoritative)\b/i.test(text);
  const mutates = /\b(?:update|send|write|decide|ship|apply|delete)\b/i.test(text);
  if (!copy || !mutates) return false;
  if (/\b(?:not the authority|refresh before|as-of|as of)\b/i.test(text)) return false;
  return true;
}

function federationStatusChatter(text) {
  const chatter = /\bstatus updates between\b[\s\S]{0,80}\b(?:agents|sources)\b/i.test(text)
    || /\bpoll (?:each|every) (?:source|system) for status\b/i.test(text);
  if (!chatter) return false;
  if (/\b(?:read the (?:record|row)|fetch the row)\b/i.test(text)) return false;
  return true;
}

function conflictingFactsProceed(text) {
  return /\bconflicts?\b[\s\S]{0,80}\b(?:ship anyway|proceed anyway|decide anyway|ignore (?:the )?conflict)\b/i.test(text)
    || /\b(?:ship|decide|proceed) anyway\b[\s\S]{0,50}\bconflicts?\b/i.test(text);
}

function ambiguousContextProceed(text) {
  return /\bambiguous context\b[\s\S]{0,80}\b(?:proceed|ship|decide)\b/i.test(text);
}

function unclearToolBoundary(text) {
  const unclear = /\b(?:use any tool|whatever tool works|tool boundary is unclear|no tool allowlist)\b/i.test(text);
  const mutates = /\b(?:update|send|write|delete|drop|deploy|apply)\b/i.test(text);
  return unclear && mutates;
}

function productionWithoutCheck(text) {
  return /\b(?:deploy|promote|ship) to production\b[\s\S]{0,90}\b(?:skip|without) the (?:confusion|consistency) (?:test|check)\b/i.test(text)
    || /\bskip the (?:confusion|consistency) (?:test|check)\b[\s\S]{0,80}\bproduction\b/i.test(text);
}

function evaluateConfusedAgentPretool({ toolName, toolInput } = {}) {
  if (!isWriteTool(toolName)) {
    return { ok: true, blockers: [], source: SOURCE };
  }
  const text = payloadText(toolInput);
  const blockers = [];
  if (staleCopyIsAuthority(text)) blockers.push('stale_copy_is_the_authority');
  if (federationStatusChatter(text)) blockers.push('federation_status_chatter');
  if (conflictingFactsProceed(text)) blockers.push('conflicting_facts_proceed');
  if (ambiguousContextProceed(text)) blockers.push('ambiguous_context_proceed');
  if (unclearToolBoundary(text)) blockers.push('unclear_tool_boundary');
  if (productionWithoutCheck(text)) blockers.push('production_without_confusion_check');
  return { ok: blockers.length === 0, blockers, source: SOURCE };
}

module.exports = {
  SOURCE,
  evaluateConfusedAgentPretool,
};
