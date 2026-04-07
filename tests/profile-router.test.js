'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  routeProfile,
  routePrivacy,
  routeInference,
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

function withEmptySettingsSandbox(fn) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-profile-project-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-profile-home-'));
  try {
    return fn({ projectRoot, homeDir });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
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
  withEmptySettingsSandbox(({ projectRoot, homeDir }) => {
    withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: 'review', RLHF_SUBAGENT_PROFILE: undefined }, () => {
      const result = routeProfile({ toolName: 'recall', settingsOptions: { projectRoot, homeDir } });
      assert.equal(result.profile, 'readonly');
      assert.equal(result.wasAutoRouted, true);
    });
  });
});

test('routeProfile auto-routes to readonly for subagent review_workflow', () => {
  withEmptySettingsSandbox(({ projectRoot, homeDir }) => {
    withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SUBAGENT_PROFILE: 'review_workflow', RLHF_SESSION_TYPE: undefined }, () => {
      const result = routeProfile({ settingsOptions: { projectRoot, homeDir } });
      assert.equal(result.profile, 'readonly');
      assert.equal(result.wasAutoRouted, true);
    });
  });
});

test('routeProfile defaults to essential for least privilege', () => {
  withEmptySettingsSandbox(({ projectRoot, homeDir }) => {
    withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined, CI: undefined, GITHUB_EVENT_NAME: undefined }, () => {
      const result = routeProfile({ settingsOptions: { projectRoot, homeDir } });
      assert.equal(result.profile, 'essential');
      assert.equal(result.wasAutoRouted, true);
    });
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
  withEmptySettingsSandbox(({ projectRoot, homeDir }) => {
    withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined }, () => {
      const result = routeProfile({ hasWriteIntent: false, settingsOptions: { projectRoot, homeDir } });
      assert.equal(result.profile, 'readonly');
      assert.ok(result.wasAutoRouted);
    });
  });
});

test('routeProfile uses settings hierarchy for default profile fallback', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-profile-settings-'));
  fs.mkdirSync(path.join(projectRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'config', 'thumbgate-settings.managed.json'),
    JSON.stringify({ mcp: { defaultProfile: 'dispatch' } }, null, 2),
  );

  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: undefined, RLHF_SUBAGENT_PROFILE: undefined, CI: undefined, GITHUB_EVENT_NAME: undefined }, () => {
    const result = routeProfile({ settingsOptions: { projectRoot, homeDir: projectRoot } });
    assert.equal(result.profile, 'dispatch');
    assert.equal(result.settingsOrigin.scope, 'managed');
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('routeProfile uses settings hierarchy for readonly profile fallback', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-profile-readonly-'));
  fs.mkdirSync(path.join(projectRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'config', 'thumbgate-settings.managed.json'),
    JSON.stringify({ mcp: { readonlySessionProfile: 'locked' } }, null, 2),
  );

  withEnv({ RLHF_MCP_PROFILE: undefined, RLHF_SESSION_TYPE: 'review', RLHF_SUBAGENT_PROFILE: undefined }, () => {
    const result = routeProfile({ settingsOptions: { projectRoot, homeDir: projectRoot } });
    assert.equal(result.profile, 'locked');
    assert.equal(result.settingsOrigin.scope, 'managed');
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// findMostRestrictiveProfile
// ---------------------------------------------------------------------------

test('findMostRestrictiveProfile returns smallest profile with the tool', () => {
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

test('routePrivacy routes locally for claim verification tools', () => {
  const result = routePrivacy({
    toolName: 'verify_claim',
    toolInput: { claim: 'tests pass' },
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

test('routeInference keeps sensitive long-context workloads local even if current backend is managed', () => {
  const result = routeInference({
    toolName: 'verify_claim',
    toolInput: { claim: 'audit repo safety' },
    taskType: 'large-context',
    contextTokens: 220000,
    tags: ['xmemory'],
    env: {
      RLHF_PROVIDER_MODE: 'managed',
    },
  });

  assert.equal(result.route, 'local');
  assert.equal(result.privacy.route, 'local');
  assert.equal(result.recommendationClass, 'privacy_local_required');
});

test('routeInference surfaces IndexCache-ready sparse local backend recommendations', () => {
  const result = routeInference({
    toolName: 'recall',
    toolInput: { query: 'multi-hop recall' },
    taskType: 'large-context',
    contextTokens: 180000,
    tags: ['retrieval-heavy'],
    env: {
      RLHF_PROVIDER_MODE: 'local',
      RLHF_LOCAL_MODEL_FAMILY: 'glm-4.5',
      RLHF_LOCAL_MODEL_SERVER: 'vllm',
      RLHF_INDEXCACHE_ENABLED: 'true',
    },
  });

  assert.equal(result.route, 'local');
  assert.equal(result.recommendationClass, 'indexcache_active');
  assert.equal(result.backend.indexCacheEnabled, true);
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
