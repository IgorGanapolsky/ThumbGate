'use strict';

/**
 * Funnel Invariant Tests
 *
 * These tests exist because on 2026-03-31 we discovered that ~1,700 monthly
 * npm installs never saw a checkout button. The free tier had no limits
 * (FREE_TIER_LIMITS was empty, FREE_TIER_MAX_GATES was Infinity), so the
 * upgrade upsell code was unreachable by design. CI tested correctness but
 * not funnel reachability.
 *
 * These invariants ensure the upgrade path is always reachable. If any of
 * these fail, the checkout funnel is broken and zero npm users will convert.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');

describe('funnel invariant: postinstall banner exists', () => {
  it('bin/postinstall.js exists', () => {
    assert.ok(fs.existsSync(path.join(PKG_ROOT, 'bin', 'postinstall.js')), 'postinstall script must exist');
  });

  it('package.json has postinstall script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts.postinstall, 'postinstall script must be defined in package.json');
    assert.ok(pkg.scripts.postinstall.includes('postinstall'), 'postinstall script must reference the postinstall file');
  });

  it('postinstall contains checkout URL', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'bin', 'postinstall.js'), 'utf8');
    assert.ok(src.includes('checkout'), 'postinstall must contain a checkout URL');
  });
});

describe('funnel invariant: free tier has real limits', () => {
  it('FREE_TIER_LIMITS is non-empty', () => {
    const { FREE_TIER_LIMITS } = require('../scripts/rate-limiter');
    const keys = Object.keys(FREE_TIER_LIMITS);
    assert.ok(keys.length >= 3, `FREE_TIER_LIMITS must have at least 3 entries, got ${keys.length}. If this is empty, the upgrade upsell is unreachable.`);
  });

  it('FREE_TIER_MAX_GATES is finite', () => {
    const { FREE_TIER_MAX_GATES } = require('../scripts/rate-limiter');
    assert.ok(Number.isFinite(FREE_TIER_MAX_GATES), `FREE_TIER_MAX_GATES must be finite, got ${FREE_TIER_MAX_GATES}. Infinity means free users never see Pro gate features.`);
  });

  it('at least one action is Pro-only (daily=0)', () => {
    const { FREE_TIER_LIMITS } = require('../scripts/rate-limiter');
    const proOnly = Object.entries(FREE_TIER_LIMITS).filter(([, v]) => {
      const daily = typeof v === 'object' ? v.daily : v;
      return daily === 0;
    });
    assert.ok(proOnly.length >= 1, 'At least one action must be Pro-only (daily=0) to give users a reason to upgrade');
  });

  it('UPGRADE_MESSAGE contains a URL', () => {
    const { UPGRADE_MESSAGE } = require('../scripts/rate-limiter');
    assert.ok(/https?:\/\//.test(UPGRADE_MESSAGE), 'UPGRADE_MESSAGE must contain a URL so users know where to go');
  });
});

describe('funnel invariant: MCP server enforces limits on gated tools', () => {
  it('server-stdio.js calls enforceLimit for rate-limited tools', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'adapters', 'mcp', 'server-stdio.js'), 'utf8');
    const gatedTools = ['search_rlhf', 'export_dpo', 'export_databricks', 'commerce_recall'];
    for (const tool of gatedTools) {
      assert.ok(src.includes(`enforceLimit('${tool}')`), `MCP server must call enforceLimit('${tool}'). Without this, free users never see the upgrade prompt for ${tool}.`);
    }
  });

  it('server-stdio.js defines enforceLimit function', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'adapters', 'mcp', 'server-stdio.js'), 'utf8');
    assert.ok(src.includes('function enforceLimit'), 'MCP server must define enforceLimit function');
  });

  it('enforceLimit references checkout URL', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'adapters', 'mcp', 'server-stdio.js'), 'utf8');
    assert.ok(src.includes('checkout'), 'enforceLimit must include a checkout URL in the error message');
  });
});

describe('funnel invariant: CLI surfaces upgrade path', () => {
  it('cli.js defines upgradeNudge function', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'bin', 'cli.js'), 'utf8');
    assert.ok(src.includes('function upgradeNudge'), 'CLI must define upgradeNudge function');
  });

  it('cli.js calls upgradeNudge after key commands', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'bin', 'cli.js'), 'utf8');
    // These are the highest-traffic CLI commands — each must nudge
    const commands = ['init', 'capture', 'stats'];
    for (const cmd of commands) {
      // Look for upgradeNudge() call near the case handler
      const pattern = new RegExp(`case '${cmd}'[\\s\\S]{0,200}upgradeNudge\\(\\)`);
      assert.ok(pattern.test(src), `CLI must call upgradeNudge() after '${cmd}' command. Without this, ${cmd} users never see the upgrade path.`);
    }
  });

  it('upgradeNudge references checkout URL', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'bin', 'cli.js'), 'utf8');
    assert.ok(src.includes('PRO_CHECKOUT_URL'), 'upgradeNudge must reference PRO_CHECKOUT_URL');
  });
});

// Snapshot ledger at module load time — before other test suites can contaminate it
const _ledgerPath = path.join(PKG_ROOT, '.rlhf', 'funnel-events.jsonl');
const _ledgerSnapshot = fs.existsSync(_ledgerPath) ? fs.readFileSync(_ledgerPath, 'utf8').trim() : '';

describe('funnel invariant: ledger data integrity', () => {
  it('funnel ledger has no test-data paid events (snapshot at load time)', () => {
    if (!_ledgerSnapshot) return; // no ledger = no contamination
    const events = _ledgerSnapshot.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const fakePaid = events.filter((e) =>
      e.stage === 'paid' && (
        !e.customerId ||
        e.customerId === 'None' ||
        /^github_user_\d+$/.test(e.customerId) ||
        /^test_/.test(e.customerId) ||
        /^mock_/.test(e.customerId)
      )
    );
    assert.equal(fakePaid.length, 0,
      `Funnel ledger contains ${fakePaid.length} fake paid events at startup. ` +
      'Test runs must use _TEST_FUNNEL_LEDGER_PATH to isolate test data. ' +
      `Fake IDs: ${fakePaid.map((e) => e.customerId || e.evidence).join(', ')}`
    );
  });

  it('billing.js uses _TEST_ env vars for ledger isolation', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'billing.js'), 'utf8');
    assert.ok(src.includes('_TEST_FUNNEL_LEDGER_PATH'), 'billing.js must check _TEST_FUNNEL_LEDGER_PATH for test isolation');
    assert.ok(src.includes('_TEST_REVENUE_LEDGER_PATH'), 'billing.js must check _TEST_REVENUE_LEDGER_PATH for test isolation');
  });
});
