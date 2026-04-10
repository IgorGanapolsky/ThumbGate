const test = require('node:test');
const assert = require('node:assert/strict');

const { TOOLS } = require('../scripts/tool-registry');

test('TOOLS is a non-empty array of tool definitions', () => {
  assert.ok(Array.isArray(TOOLS));
  assert.ok(TOOLS.length > 5, `expected >5 tools, got ${TOOLS.length}`);
});

test('every tool has name, description, and inputSchema', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.name, `tool missing name: ${JSON.stringify(tool)}`);
    assert.ok(tool.description, `tool ${tool.name} missing description`);
    assert.ok(tool.inputSchema, `tool ${tool.name} missing inputSchema`);
    assert.equal(tool.inputSchema.type, 'object', `tool ${tool.name} schema type must be object`);
  }
});

test('capture_feedback tool exists with required signal param', () => {
  const captureTool = TOOLS.find(t => t.name === 'capture_feedback');
  assert.ok(captureTool, 'capture_feedback tool must exist');
  assert.ok(captureTool.inputSchema.properties.signal, 'capture_feedback must have signal property');
  assert.ok(captureTool.inputSchema.properties.chatHistory, 'capture_feedback must expose chatHistory for history-aware distillation');
  assert.ok(captureTool.inputSchema.properties.conversationWindow, 'capture_feedback must expose conversationWindow for structured reflection');
  assert.ok(captureTool.inputSchema.properties.relatedFeedbackId, 'capture_feedback must expose relatedFeedbackId');
});

test('document import tools exist and search_thumbgate exposes document search', () => {
  const importTool = TOOLS.find((tool) => tool.name === 'import_document');
  const listTool = TOOLS.find((tool) => tool.name === 'list_imported_documents');
  const getTool = TOOLS.find((tool) => tool.name === 'get_imported_document');
  const searchTool = TOOLS.find((tool) => tool.name === 'search_thumbgate');

  assert.ok(importTool, 'import_document tool must exist');
  assert.ok(listTool, 'list_imported_documents tool must exist');
  assert.ok(getTool, 'get_imported_document tool must exist');
  assert.ok(searchTool, 'search_thumbgate tool must exist');
  assert.equal(importTool.annotations.destructiveHint, true);
  assert.equal(listTool.annotations.readOnlyHint, true);
  assert.equal(getTool.annotations.readOnlyHint, true);
  assert.ok(searchTool.inputSchema.properties.source.enum.includes('documents'));
});

test('conversation follow-up tools exist with the expected safety hints', () => {
  const openTool = TOOLS.find((tool) => tool.name === 'open_feedback_session');
  const appendTool = TOOLS.find((tool) => tool.name === 'append_feedback_context');
  const finalizeTool = TOOLS.find((tool) => tool.name === 'finalize_feedback_session');
  const retrieveTool = TOOLS.find((tool) => tool.name === 'retrieve_lessons');
  const reflectTool = TOOLS.find((tool) => tool.name === 'reflect_on_feedback');

  assert.ok(openTool, 'open_feedback_session tool must exist');
  assert.ok(appendTool, 'append_feedback_context tool must exist');
  assert.ok(finalizeTool, 'finalize_feedback_session tool must exist');
  assert.ok(retrieveTool, 'retrieve_lessons tool must exist');
  assert.ok(reflectTool, 'reflect_on_feedback tool must exist');

  assert.equal(openTool.annotations.destructiveHint, true);
  assert.equal(appendTool.annotations.destructiveHint, true);
  assert.equal(finalizeTool.annotations.destructiveHint, true);
  assert.equal(retrieveTool.annotations.readOnlyHint, true);
  assert.equal(reflectTool.annotations.readOnlyHint, true);
});

test('recall tool exists', () => {
  const recallTool = TOOLS.find(t => t.name === 'recall');
  assert.ok(recallTool, 'recall tool must exist');
});

test('natural-language harness tools exist with the expected safety hints', () => {
  const listTool = TOOLS.find((tool) => tool.name === 'list_harnesses');
  const runTool = TOOLS.find((tool) => tool.name === 'run_harness');

  assert.ok(listTool, 'list_harnesses tool must exist');
  assert.ok(runTool, 'run_harness tool must exist');
  assert.equal(listTool.annotations.readOnlyHint, true);
  assert.equal(runTool.annotations.destructiveHint, true);
});

test('org_dashboard tool stays aligned with Team rollout packaging', () => {
  const orgDashboardTool = TOOLS.find(t => t.name === 'org_dashboard');
  assert.ok(orgDashboardTool, 'org_dashboard tool must exist');
  assert.match(orgDashboardTool.description, /Team rollout: full visibility/i);
  assert.match(orgDashboardTool.description, /Free preview: limited to 3 agents/i);
  assert.doesNotMatch(orgDashboardTool.description, /Pro: full visibility/i);
});

test('settings_status tool exists as a read-only visibility surface', () => {
  const settingsTool = TOOLS.find((tool) => tool.name === 'settings_status');
  assert.ok(settingsTool, 'settings_status tool must exist');
  assert.equal(settingsTool.annotations.readOnlyHint, true);
  assert.match(settingsTool.description, /per-field origin metadata/i);
});

test('scope control tools expose the task-scope and protected-approval workflow', () => {
  const setScopeTool = TOOLS.find((tool) => tool.name === 'set_task_scope');
  const getScopeTool = TOOLS.find((tool) => tool.name === 'get_scope_state');
  const setBranchTool = TOOLS.find((tool) => tool.name === 'set_branch_governance');
  const getBranchTool = TOOLS.find((tool) => tool.name === 'get_branch_governance');
  const approveTool = TOOLS.find((tool) => tool.name === 'approve_protected_action');
  const integrityTool = TOOLS.find((tool) => tool.name === 'check_operational_integrity');
  const sentinelTool = TOOLS.find((tool) => tool.name === 'workflow_sentinel');

  assert.ok(setScopeTool, 'set_task_scope tool must exist');
  assert.ok(getScopeTool, 'get_scope_state tool must exist');
  assert.ok(setBranchTool, 'set_branch_governance tool must exist');
  assert.ok(getBranchTool, 'get_branch_governance tool must exist');
  assert.ok(approveTool, 'approve_protected_action tool must exist');
  assert.ok(integrityTool, 'check_operational_integrity tool must exist');
  assert.ok(sentinelTool, 'workflow_sentinel tool must exist');

  assert.equal(setScopeTool.annotations.destructiveHint, true);
  assert.equal(getScopeTool.annotations.readOnlyHint, true);
  assert.equal(setBranchTool.annotations.destructiveHint, true);
  assert.equal(getBranchTool.annotations.readOnlyHint, true);
  assert.equal(approveTool.annotations.destructiveHint, true);
  assert.equal(integrityTool.annotations.readOnlyHint, true);
  assert.equal(sentinelTool.annotations.readOnlyHint, true);
  assert.ok(setScopeTool.inputSchema.properties.allowedPaths, 'set_task_scope should expose allowedPaths');
  assert.ok(setBranchTool.inputSchema.properties.releaseVersion, 'set_branch_governance should expose releaseVersion');
  assert.ok(approveTool.inputSchema.required.includes('pathGlobs'), 'approve_protected_action should require pathGlobs');
  assert.ok(integrityTool.inputSchema.properties.requirePrForReleaseSensitive, 'check_operational_integrity should expose release-sensitive enforcement');
  assert.ok(sentinelTool.inputSchema.required.includes('toolName'), 'workflow_sentinel should require toolName');
  assert.ok(sentinelTool.inputSchema.properties.changedFiles, 'workflow_sentinel should expose changedFiles');
});

test('tool names are unique', () => {
  const names = TOOLS.map(t => t.name);
  const unique = new Set(names);
  assert.equal(names.length, unique.size, `duplicate tool names: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});
