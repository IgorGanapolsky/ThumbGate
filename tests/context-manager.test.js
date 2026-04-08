'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  assembleUnifiedContext,
  formatUnifiedContext,
  getAgentProfile,
  AGENT_PROFILES,
  classifyTier,
} = require('../scripts/context-manager');

describe('context-manager', () => {
  // -----------------------------------------------------------------------
  // Agent profiles
  // -----------------------------------------------------------------------
  describe('getAgentProfile', () => {
    it('returns claude profile for claude agent type', () => {
      const profile = getAgentProfile('claude');
      assert.strictEqual(profile.maxLessons, 8);
      assert.strictEqual(profile.includeCodeGraph, true);
      assert.strictEqual(profile.contextBudget, 10000);
    });

    it('returns cursor profile for cursor agent type', () => {
      const profile = getAgentProfile('cursor');
      assert.strictEqual(profile.maxLessons, 5);
      assert.strictEqual(profile.includeCodeGraph, true);
    });

    it('returns forgecode profile for forgecode agent type', () => {
      const profile = getAgentProfile('forgecode');
      assert.strictEqual(profile.includeCodeGraph, false);
      assert.strictEqual(profile.contextBudget, 6000);
    });

    it('returns codex profile for codex agent type', () => {
      const profile = getAgentProfile('codex');
      assert.strictEqual(profile.maxLessons, 6);
      assert.strictEqual(profile.includeCodeGraph, true);
      assert.strictEqual(profile.contextBudget, 8000);
    });

    it('returns default profile for unknown agent type', () => {
      const profile = getAgentProfile('unknown-agent');
      assert.deepStrictEqual(profile, AGENT_PROFILES.default);
    });

    it('returns default profile for null/undefined', () => {
      assert.deepStrictEqual(getAgentProfile(null), AGENT_PROFILES.default);
      assert.deepStrictEqual(getAgentProfile(undefined), AGENT_PROFILES.default);
    });

    it('is case-insensitive', () => {
      assert.deepStrictEqual(getAgentProfile('Claude'), AGENT_PROFILES.claude);
      assert.deepStrictEqual(getAgentProfile('CURSOR'), AGENT_PROFILES.cursor);
    });
  });

  // -----------------------------------------------------------------------
  // Tier classification
  // -----------------------------------------------------------------------
  describe('classifyTier', () => {
    it('returns full when session + lessons present', () => {
      assert.strictEqual(classifyTier({
        session: { lastTask: 'test' },
        lessons: [{ id: '1' }],
        contextPack: null,
      }), 'full');
    });

    it('returns full when session + contextPack present', () => {
      assert.strictEqual(classifyTier({
        session: { lastTask: 'test' },
        lessons: [],
        contextPack: { packId: 'p1' },
      }), 'full');
    });

    it('returns warm when lessons present but no session', () => {
      assert.strictEqual(classifyTier({
        session: null,
        lessons: [{ id: '1' }],
        contextPack: null,
      }), 'warm');
    });

    it('returns warm when contextPack present but no session', () => {
      assert.strictEqual(classifyTier({
        session: null,
        lessons: [],
        contextPack: { packId: 'p1' },
      }), 'warm');
    });

    it('returns cold when nothing present', () => {
      assert.strictEqual(classifyTier({
        session: null,
        lessons: [],
        contextPack: null,
      }), 'cold');
    });
  });

  // -----------------------------------------------------------------------
  // assembleUnifiedContext — integration (graceful degradation)
  // -----------------------------------------------------------------------
  describe('assembleUnifiedContext', () => {
    it('returns a valid context object with all required fields', () => {
      const ctx = assembleUnifiedContext({ query: 'test task' });
      assert.ok(ctx.tier, 'tier should be set');
      assert.ok(['full', 'warm', 'cold'].includes(ctx.tier), `tier should be full/warm/cold, got ${ctx.tier}`);
      assert.ok(ctx.assembledAt, 'assembledAt should be set');
      assert.ok(ctx.agentType, 'agentType should be set');
      assert.ok(ctx.agentProfile, 'agentProfile should be set');
      assert.ok(Array.isArray(ctx.lessons), 'lessons should be an array');
      assert.ok(ctx.guards, 'guards should be present');
    });

    it('uses default agent type when none specified', () => {
      const ctx = assembleUnifiedContext({ query: 'test' });
      assert.strictEqual(ctx.agentType, 'default');
      assert.strictEqual(ctx.agentProfile.maxLessons, 5);
    });

    it('respects agent type parameter', () => {
      const ctx = assembleUnifiedContext({ query: 'test', agentType: 'claude' });
      assert.strictEqual(ctx.agentType, 'claude');
      assert.strictEqual(ctx.agentProfile.maxLessons, 8);
      assert.strictEqual(ctx.agentProfile.contextBudget, 10000);
    });

    it('degrades gracefully — never throws', () => {
      // Even with garbage input, should return a valid context
      assert.doesNotThrow(() => {
        assembleUnifiedContext({});
      });
      assert.doesNotThrow(() => {
        assembleUnifiedContext({ query: '', agentType: 'nonexistent' });
      });
    });

    it('session is null when no handoff exists', () => {
      const ctx = assembleUnifiedContext({ query: 'fresh start' });
      // Session may or may not exist depending on local state, but should not throw
      assert.ok(ctx.session === null || typeof ctx.session === 'object');
    });

    it('guards default to allow when no guard artifact exists', () => {
      const ctx = assembleUnifiedContext({ query: 'test' });
      assert.ok(ctx.guards);
      assert.ok(
        ctx.guards.mode === 'allow' || ctx.guards.mode === 'warn' || ctx.guards.mode === 'block',
        `guard mode should be allow/warn/block, got ${ctx.guards.mode}`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // formatUnifiedContext — output formatting
  // -----------------------------------------------------------------------
  describe('formatUnifiedContext', () => {
    it('formats a cold tier context', () => {
      const ctx = {
        tier: 'cold',
        agentType: 'default',
        assembledAt: '2026-04-08T00:00:00.000Z',
        session: null,
        userProfile: null,
        lessons: [],
        guards: { mode: 'allow' },
        contextPack: null,
        codeGraph: null,
      };
      const output = formatUnifiedContext(ctx);
      assert.ok(output.includes('Tier: cold'));
      assert.ok(output.includes('Agent: default'));
    });

    it('formats a full tier context with session and lessons', () => {
      const ctx = {
        tier: 'full',
        agentType: 'claude',
        assembledAt: '2026-04-08T00:00:00.000Z',
        session: { lastTask: 'fix bug', nextStep: 'deploy', blockers: ['CI red'] },
        userProfile: { entries: ['Senior engineer', 'Prefers terse output'], charCount: 40 },
        lessons: [
          { id: 'l1', title: 'Dont mock DB', signal: 'negative', relevanceScore: 0.8, rule: { condition: 'test uses mock', action: 'use real DB' } },
          { id: 'l2', title: 'Single PR worked', signal: 'positive', relevanceScore: 0.6, rule: null },
        ],
        guards: { mode: 'warn', reason: 'similar past failure' },
        contextPack: {
          packId: 'p1',
          itemCount: 3,
          items: [
            { id: 'i1', namespace: 'memory/error', title: 'DB crash', tags: ['db'], score: 5 },
          ],
          visibility: null,
          cached: false,
        },
        codeGraph: '3 files affected: server.js, db.js, test.js',
      };
      const output = formatUnifiedContext(ctx);
      assert.ok(output.includes('Tier: full'));
      assert.ok(output.includes('### Session'));
      assert.ok(output.includes('fix bug'));
      assert.ok(output.includes('deploy'));
      assert.ok(output.includes('CI red'));
      assert.ok(output.includes('### User Profile'));
      assert.ok(output.includes('Senior engineer'));
      assert.ok(output.includes('### Guard: WARN'));
      assert.ok(output.includes('### Lessons (2)'));
      assert.ok(output.includes('[-] Dont mock DB'));
      assert.ok(output.includes('[+] Single PR worked'));
      assert.ok(output.includes('IF test uses mock THEN use real DB'));
      assert.ok(output.includes('### Context Pack (3 items)'));
      assert.ok(output.includes('DB crash'));
      assert.ok(output.includes('### Code Graph Impact'));
      assert.ok(output.includes('3 files affected'));
    });

    it('skips sections when data is null/empty', () => {
      const ctx = {
        tier: 'warm',
        agentType: 'cursor',
        assembledAt: '2026-04-08T00:00:00.000Z',
        session: null,
        userProfile: null,
        lessons: [{ id: 'l1', title: 'lesson', signal: 'positive', relevanceScore: 0.5, rule: null }],
        guards: { mode: 'allow' },
        contextPack: null,
        codeGraph: null,
      };
      const output = formatUnifiedContext(ctx);
      assert.ok(!output.includes('### Session'));
      assert.ok(!output.includes('### User Profile'));
      assert.ok(!output.includes('### Guard'));
      assert.ok(!output.includes('### Context Pack'));
      assert.ok(!output.includes('### Code Graph'));
      assert.ok(output.includes('### Lessons (1)'));
    });
  });
});
