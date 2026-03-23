'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  routeProfile,
  routePrivacy,
  findMostRestrictiveProfile,
  isReadOnlySession,
} = require('../scripts/profile-router');

// ---------------------------------------------------------------------------
// Helpers — save and restore env vars
// ---------------------------------------------------------------------------

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// ---------------------------------------------------------------------------
// routeProfile
// ---------------------------------------------------------------------------

test('routeProfile returns explicit profile when RLHF_MCP_PROFILE is set', () => {
  withEnv({ RLHF_MCP_PROFILE: 'locked', RLHF_SUBAGENT_PROFILE: undefined }, () => {
    const result = routeProfile({ toolName: 'recall' });
    assert.equal(result.profile, 'locked');
    assert.equal(result.wasAutoRouted, false);
  });
});

test('routeProfile auto-routes to readonly for review sessions', () => {
  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: 'review', RLHF_SUBAGENT_PROFILE: undefined }, () => {
    const result = routeProfile({ toolName: 'recall' });
    assert.equal(result.profile, 'readonly');
    assert.equal(result.wasAutoRouted, true);
  });
});

test('routeProfile auto-routes to readonly for subagent review_workflow', () => {
  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SUBAGENT_PROFILE: 'review_workflow', RLHF_SESSION_TYPE: undefined }, () => {
    const result = routeProfile({});
    assert.equal(result.profile, 'readonly');
    assert.equal(result.wasAutoRouted, true);
  });
});

test('routeProfile defaults to essential for least privilege', () => {
  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined, CI: undefined, GITHUB_EVENT_NAME: undefined }, () => {
    const result = routeProfile({});
    assert.equal(result.profile, 'essential');
    assert.equal(result.wasAutoRouted, true);
  });
});

test('routeProfile selects most restrictive profile for a known tool', () => {
  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined, CI: undefined, GITHUB_EVENT_NAME: undefined }, () => {
    // 'diagnose_failure' is in locked (4 tools), readonly (14), default (31)
    // Most restrictive = locked
    const result = routeProfile({ toolName: 'diagnose_failure' });
    assert.equal(result.profile, 'locked');
    assert.ok(result.wasAutoRouted);
  });
});

test('routeProfile routes to readonly when no write intent', () => {
  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined }, () => {
    const result = routeProfile({ hasWriteIntent: false });
    assert.equal(result.profile, 'readonly');
    assert.ok(result.wasAutoRouted);
  });
});

// ---------------------------------------------------------------------------
// findMostRestrictiveProfile
// ---------------------------------------------------------------------------

test('findMostRestrictiveProfile returns smallest profile with the tool', () => {
  // 'feedback_summary' is in locked(5), essential(8), commerce(7), readonly(15), default(32)
  const profile = findMostRestrictiveProfile('feedback_summary');
  assert.equal(profile, 'locked');
});

test('findMostRestrictiveProfile returns locked for search_lessons', () => {
  const profile = findMostRestrictiveProfile('search_lessons');
  assert.equal(profile, 'locked');
});

test('findMostRestrictiveProfile returns locked for search_rlhf', () => {
  const profile = findMostRestrictiveProfile('search_rlhf');
  assert.equal(profile, 'locked');
});

test('findMostRestrictiveProfile returns null for unknown tool', () => {
  const profile = findMostRestrictiveProfile('nonexistent_tool_xyz');
  assert.equal(profile, null);
});

// ---------------------------------------------------------------------------
// routePrivacy
// ---------------------------------------------------------------------------

test('routePrivacy routes locally for .env references', () => {
  const result = routePrivacy({
    toolName: 'Read',
    toolInput: { file_path: '/project/.env' },
  });
  assert.equal(result.route, 'local');
});

test('routePrivacy routes locally for credential references', () => {
  const result = routePrivacy({
    toolName: 'Read',
    toolInput: { file_path: '/project/credentials.json' },
  });
  assert.equal(result.route, 'local');
});

test('routePrivacy routes locally for DPO export tool', () => {
  const result = routePrivacy({
    toolName: 'export_dpo_pairs',
    toolInput: {},
  });
  assert.equal(result.route, 'local');
});

test('routePrivacy routes to frontier for normal operations', () => {
  const result = routePrivacy({
    toolName: 'recall',
    toolInput: { query: 'how to test gates' },
  });
  assert.equal(result.route, 'frontier');
});

test('routePrivacy detects api_key in input', () => {
  const result = routePrivacy({
    toolName: 'Bash',
    toolInput: { command: 'export API_KEY=sk-abc123' },
  });
  assert.equal(result.route, 'local');
});

// ---------------------------------------------------------------------------
// isReadOnlySession
// ---------------------------------------------------------------------------

test('isReadOnlySession detects CI PR context', () => {
  withEnv({ CI: 'true', GITHUB_EVENT_NAME: 'pull_request', RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined }, () => {
    assert.equal(isReadOnlySession(), true);
  });
});

test('isReadOnlySession returns false by default', () => {
  withEnv({ CI: undefined, GITHUB_EVENT_NAME: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined }, () => {
    assert.equal(isReadOnlySession(), false);
  });
});
