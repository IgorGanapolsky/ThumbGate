'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  REPORT_SOURCE_URL,
  SIREN_MCP_TOOLS,
  BRAND_SAFETY_PATTERNS,
  FORMAT_MAPPING,
  verifySirenAttribution,
  evaluateSchedulingWindow,
  scanBrandSafety,
  evaluateCampaignBudget,
  evaluateSirenToolCall,
  buildSirenGovernanceReport,
  formatSirenGovernanceReport,
  parseCliArgs,
} = require('../scripts/siren-mcp-governance');

describe('Siren MCP Governance & Marketing Diode', () => {
  it('exposes report constants and tool signatures correctly', () => {
    assert.strictEqual(REPORT_SOURCE_URL, 'https://github.com/Hexahedral-Inc/siren-mcp');
    assert.ok(SIREN_MCP_TOOLS.post_run);
    assert.ok(SIREN_MCP_TOOLS.schedule_post);
    assert.ok(SIREN_MCP_TOOLS.create_campaign);
    assert.strictEqual(SIREN_MCP_TOOLS.schedule_post.minBufferSeconds, 300);
    assert.strictEqual(SIREN_MCP_TOOLS.create_campaign.maxDailyBudgetUsd, 500);
    assert.ok(Array.isArray(BRAND_SAFETY_PATTERNS));
    assert.ok(BRAND_SAFETY_PATTERNS.length >= 4);
    assert.ok(Array.isArray(FORMAT_MAPPING));
    assert.ok(FORMAT_MAPPING.length >= 4);
  });

  describe('Attribution Verification', () => {
    it('approves text attribution', () => {
      const res = verifySirenAttribution('Check out our launch demo. Video made with Siren.');
      assert.strictEqual(res.hasAttribution, true);
      assert.strictEqual(res.hasTextAttribution, true);
      assert.strictEqual(res.reason, 'valid');
    });

    it('approves URL attribution', () => {
      const res = verifySirenAttribution('Generated using AI: https://mysiren.ai');
      assert.strictEqual(res.hasAttribution, true);
      assert.strictEqual(res.hasUrlAttribution, true);
      assert.strictEqual(res.reason, 'valid');
    });

    it('rejects missing attribution', () => {
      const res = verifySirenAttribution('Just an uncredited marketing post.');
      assert.strictEqual(res.hasAttribution, false);
      assert.strictEqual(res.reason, 'missing_siren_attribution');
    });

    it('handles empty or non-string inputs safely', () => {
      assert.strictEqual(verifySirenAttribution('').hasAttribution, false);
      assert.strictEqual(verifySirenAttribution(null).hasAttribution, false);
      assert.strictEqual(verifySirenAttribution(undefined).hasAttribution, false);
    });
  });

  describe('Scheduling Window Evaluation', () => {
    const fixedNow = new Date('2026-10-02T12:00:00Z');

    it('approves scheduling timestamps beyond minimum buffer', () => {
      // 10 minutes in the future (600s > 300s)
      const scheduledAt = '2026-10-02T12:10:00Z';
      const res = evaluateSchedulingWindow(scheduledAt, { now: fixedNow, minBufferSeconds: 300 });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.reason, 'valid_window');
      assert.strictEqual(res.deltaSeconds, 600);
    });

    it('rejects missing scheduled_at', () => {
      const res = evaluateSchedulingWindow(null, { now: fixedNow });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'missing_scheduled_at');
    });

    it('rejects malformed timestamps', () => {
      const res = evaluateSchedulingWindow('not-a-date', { now: fixedNow });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'invalid_timestamp_format');
    });

    it('rejects timestamps in the past', () => {
      const scheduledAt = '2026-10-02T11:50:00Z'; // 10m ago
      const res = evaluateSchedulingWindow(scheduledAt, { now: fixedNow });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'timestamp_in_past');
    });

    it('rejects timestamps within safety buffer window', () => {
      // 2 minutes in the future (120s < 300s)
      const scheduledAt = '2026-10-02T12:02:00Z';
      const res = evaluateSchedulingWindow(scheduledAt, { now: fixedNow, minBufferSeconds: 300 });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'buffer_too_small');
      assert.strictEqual(res.deltaSeconds, 120);
    });
  });

  describe('Brand Safety Scanning', () => {
    it('approves benign marketing copy', () => {
      const res = scanBrandSafety('Announcing our newest feature for AI developers! Built with robust reliability.');
      assert.strictEqual(res.safe, true);
      assert.strictEqual(res.violations.length, 0);
    });

    it('flags guaranteed profit claims', () => {
      const res = scanBrandSafety('Invest in our token, 100% guaranteed profit risk-free!');
      assert.strictEqual(res.safe, false);
      assert.ok(res.violations.some(v => v.id === 'guaranteed_returns'));
    });

    it('flags unlimited free bait', () => {
      const res = scanBrandSafety('Sign up now for unlimited free credits forever!');
      assert.strictEqual(res.safe, false);
      assert.ok(res.violations.some(v => v.id === 'unlimited_free_bait'));
    });

    it('flags competitor defamation', () => {
      const res = scanBrandSafety('Do not use other tools, they are scam like competitor_x.');
      assert.strictEqual(res.safe, false);
      assert.ok(res.violations.some(v => v.id === 'competitor_defamation'));
    });

    it('flags leaked API credentials in copy', () => {
      const res = scanBrandSafety('Try this key: ghp_123456789012345678901234567890123456');
      assert.strictEqual(res.safe, false);
      assert.ok(res.violations.some(v => v.id === 'credential_leak_sample'));
    });

    it('handles empty text safely', () => {
      assert.strictEqual(scanBrandSafety(null).safe, true);
      assert.strictEqual(scanBrandSafety('').safe, true);
    });
  });

  describe('Campaign Budget Evaluation', () => {
    it('accepts zero or unspecified budget', () => {
      assert.strictEqual(evaluateCampaignBudget(undefined).valid, true);
      assert.strictEqual(evaluateCampaignBudget(null).valid, true);
      assert.strictEqual(evaluateCampaignBudget(0).valid, true);
    });

    it('accepts budget within ceiling ($300 <= $500)', () => {
      const res = evaluateCampaignBudget(300, { maxDailyBudgetUsd: 500 });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.budgetUsd, 300);
      assert.strictEqual(res.reason, 'within_budget');
    });

    it('rejects budget exceeding ceiling without executive override', () => {
      const res = evaluateCampaignBudget(1000, { maxDailyBudgetUsd: 500 });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'budget_limit_exceeded');
    });

    it('approves high budget when executive override is present', () => {
      const res = evaluateCampaignBudget(1000, { maxDailyBudgetUsd: 500, executiveOverride: true });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.budgetUsd, 1000);
    });

    it('rejects negative or invalid budget values', () => {
      assert.strictEqual(evaluateCampaignBudget(-50).valid, false);
      assert.strictEqual(evaluateCampaignBudget('not-a-number').valid, false);
    });
  });

  describe('evaluateSirenToolCall Dispatcher', () => {
    it('rejects unknown tools', () => {
      const res = evaluateSirenToolCall('unsupported_action', {});
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.action, 'block');
      assert.ok(res.reasons[0].includes('unknown_siren_tool'));
    });

    describe('post_run tool', () => {
      it('allows dry_run post_run with attribution', () => {
        const res = evaluateSirenToolCall('post_run', {
          content: 'Excited to show our new update! Video made with Siren',
          dry_run: true,
        });
        assert.strictEqual(res.allowed, true);
        assert.strictEqual(res.action, 'allow');
      });

      it('requires review for immediate live post_run without dry_run or approval', () => {
        const res = evaluateSirenToolCall('post_run', {
          content: 'Live post going out now! Video made with Siren',
        });
        assert.strictEqual(res.allowed, false);
        assert.strictEqual(res.action, 'review');
        assert.ok(res.reasons.some(r => r.includes('unreviewed_immediate_dispatch')));
      });

      it('blocks immediate live post_run in strict mode without approval', () => {
        const res = evaluateSirenToolCall('post_run', {
          content: 'Live post going out now! Video made with Siren',
        }, { strict: true });
        assert.strictEqual(res.allowed, false);
        assert.strictEqual(res.action, 'block');
        assert.ok(res.reasons.some(r => r.includes('unreviewed_immediate_dispatch')));
      });

      it('allows immediate post_run when human approval is present', () => {
        const res = evaluateSirenToolCall('post_run', {
          content: 'Live post going out now! Video made with Siren',
          reviewed: true,
        });
        assert.strictEqual(res.allowed, true);
        assert.strictEqual(res.action, 'allow');
      });

      it('blocks post_run with brand safety violation regardless of approval', () => {
        const res = evaluateSirenToolCall('post_run', {
          content: 'Guaranteed 100% profit risk-free returns! Video made with Siren',
          reviewed: true,
        });
        assert.strictEqual(res.allowed, false);
        assert.strictEqual(res.action, 'block');
        assert.ok(res.reasons.some(r => r.includes('brand_safety_violation')));
      });
    });

    describe('schedule_post tool', () => {
      const fixedNow = new Date('2026-10-02T12:00:00Z');

      it('allows schedule_post with valid future buffer and attribution', () => {
        const res = evaluateSirenToolCall('schedule_post', {
          content: 'Scheduled for tomorrow. Video made with Siren',
          scheduled_at: '2026-10-02T12:15:00Z',
        }, { now: fixedNow });
        assert.strictEqual(res.allowed, true);
        assert.strictEqual(res.action, 'allow');
      });

      it('blocks schedule_post with buffer under 300 seconds', () => {
        const res = evaluateSirenToolCall('schedule_post', {
          content: 'Scheduled too soon. Video made with Siren',
          scheduled_at: '2026-10-02T12:01:00Z',
        }, { now: fixedNow });
        assert.strictEqual(res.allowed, false);
        assert.strictEqual(res.action, 'block');
        assert.ok(res.reasons.some(r => r.includes('invalid_scheduling_window')));
      });
    });

    describe('create_campaign tool', () => {
      it('allows create_campaign within daily budget and safe copy', () => {
        const res = evaluateSirenToolCall('create_campaign', {
          campaign_name: 'Fall Developer Outreach',
          budget: 250,
          description: 'Showcasing our agentic safety stack. Visit https://mysiren.ai',
        });
        assert.strictEqual(res.allowed, true);
        assert.strictEqual(res.action, 'allow');
      });

      it('blocks create_campaign exceeding budget limit', () => {
        const res = evaluateSirenToolCall('create_campaign', {
          campaign_name: 'Overbudget Campaign',
          budget: 2500,
        });
        assert.strictEqual(res.allowed, false);
        assert.strictEqual(res.action, 'block');
        assert.ok(res.reasons.some(r => r.includes('budget_limit_exceeded')));
      });
    });
  });

  describe('Report Builder & Formatter', () => {
    it('builds map-only report', () => {
      const report = buildSirenGovernanceReport({ mapOnly: true });
      assert.strictEqual(report.status, 'pass');
      assert.strictEqual(report.mode, 'map-only');
      assert.ok(report.mapping.length >= 4);

      const formatted = formatSirenGovernanceReport(report);
      assert.ok(formatted.includes('FORMAT Transfers'));
      assert.ok(formatted.includes('post_run'));
    });

    it('builds evaluation report with valid tool call', () => {
      const report = buildSirenGovernanceReport({
        tool: 'post_run',
        args: JSON.stringify({
          content: 'Test content. Video made with Siren',
          dry_run: true,
        }),
      });
      assert.strictEqual(report.status, 'pass');
      assert.strictEqual(report.evaluation.allowed, true);

      const formatted = formatSirenGovernanceReport(report);
      assert.ok(formatted.includes('Action: ALLOW'));
      assert.ok(formatted.includes('Allowed: YES'));
    });

    it('returns fail status on malformed args JSON', () => {
      const report = buildSirenGovernanceReport({
        tool: 'post_run',
        args: 'invalid-json{',
      });
      assert.strictEqual(report.status, 'fail');
      assert.ok(report.error.includes('Failed to parse --args'));
    });

    it('formats empty report when no tool is provided', () => {
      const report = buildSirenGovernanceReport({});
      assert.strictEqual(report.status, 'pass');
      const formatted = formatSirenGovernanceReport(report);
      assert.ok(formatted.includes('No tool call specified'));
    });
  });

  describe('CLI Invocation', () => {
    const scriptPath = path.resolve(__dirname, '../scripts/siren-mcp-governance.js');

    it('runs --map-only --json via CLI successfully', () => {
      const proc = spawnSync('node', [scriptPath, '--map-only', '--json'], { encoding: 'utf8' });
      assert.strictEqual(proc.status, 0);
      const parsed = JSON.parse(proc.stdout);
      assert.strictEqual(parsed.status, 'pass');
      assert.strictEqual(parsed.mode, 'map-only');
    });

    it('evaluates safe tool call via CLI with exit 0', () => {
      const proc = spawnSync(
        'node',
        [
          scriptPath,
          '--tool',
          'post_run',
          '--args',
          JSON.stringify({ content: 'Hello world! Video made with Siren', dry_run: true }),
        ],
        { encoding: 'utf8' }
      );
      assert.strictEqual(proc.status, 0);
      assert.ok(/Allowed:\s*YES/i.test(proc.stdout));
    });

    it('exits with code 1 when evaluating a blocking violation', () => {
      const proc = spawnSync(
        'node',
        [
          scriptPath,
          '--tool',
          'create_campaign',
          '--args',
          JSON.stringify({ budget: 5000 }),
        ],
        { encoding: 'utf8' }
      );
      assert.strictEqual(proc.status, 1);
      assert.ok(/Action:\s*BLOCK/i.test(proc.stdout));
    });
  });

  describe('parseCliArgs Helper', () => {
    it('parses flags and arguments accurately', () => {
      const args = ['--json', '--strict', '--tool', 'schedule_post', '--args', '{"content":"test"}'];
      const parsed = parseCliArgs(args);
      assert.strictEqual(parsed.json, true);
      assert.strictEqual(parsed.strict, true);
      assert.strictEqual(parsed.tool, 'schedule_post');
      assert.strictEqual(parsed.args, '{"content":"test"}');
    });
  });
});
