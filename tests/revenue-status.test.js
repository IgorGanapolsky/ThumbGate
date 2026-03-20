const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGhVariableList,
  parseHtmlSignals,
  buildDiagnosis,
  formatReport,
  generateRevenueStatusReport,
} = require('../scripts/revenue-status');

test('parseGhVariableList reads gh variable output', () => {
  const parsed = parseGhVariableList([
    'RAILWAY_PROJECT_ID\tproj_123\t2026-03-20T00:00:00Z',
    'RAILWAY_ENVIRONMENT_ID\tenv_456\t2026-03-20T00:00:00Z',
    'RAILWAY_SERVICE\trlhf-feedback-loop\t2026-03-20T00:00:00Z',
  ].join('\n'));

  assert.equal(parsed.RAILWAY_PROJECT_ID, 'proj_123');
  assert.equal(parsed.RAILWAY_ENVIRONMENT_ID, 'env_456');
  assert.equal(parsed.RAILWAY_SERVICE, 'rlhf-feedback-loop');
});

test('parseHtmlSignals detects telemetry and tracking hooks', () => {
  const signals = parseHtmlSignals(`
    <script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1234"></script>
    <script>window.gtag('event', 'checkout_start');</script>
    <script>fetch('/v1/telemetry/ping', { method: 'POST' });</script>
    <section id="workflow-sprint-intake"></section>
  `);

  assert.equal(signals.plausibleScript, true);
  assert.equal(signals.gaLoaderScript, true);
  assert.equal(signals.gaEventHook, true);
  assert.equal(signals.telemetryEndpoint, true);
  assert.equal(signals.workflowSprintIntake, true);
});

test('buildDiagnosis identifies local fallback blind spot and runtime gaps', () => {
  const diagnosis = buildDiagnosis({
    publicProbe: {
      root: {
        signals: {
          telemetryEndpoint: true,
          plausibleScript: true,
          gaLoaderScript: false,
        },
      },
      telemetryPing: {
        status: 204,
      },
    },
    hostedAudit: {
      runtimePresence: {
        RLHF_GA_MEASUREMENT_ID: false,
        RLHF_PUBLIC_APP_ORIGIN: false,
        RLHF_BILLING_API_BASE_URL: false,
      },
      summaries: {
        today: {
          status: 200,
        },
        '30d': {
          status: 200,
          trafficMetrics: {
            visitors: 21,
            pageViews: 15,
          },
          revenue: {
            paidOrders: 2,
            bookedRevenueCents: 2000,
          },
        },
      },
    },
  });

  assert.equal(diagnosis.primaryIssue, 'operator_blind_spot_local_fallback');
  assert.equal(diagnosis.trackingImplemented, true);
  assert.equal(diagnosis.telemetryIngressWorking, true);
  assert.equal(diagnosis.hostedSummaryWorking, true);
  assert.equal(diagnosis.hostedTrafficObserved, true);
  assert.equal(diagnosis.hostedRevenueObserved, true);
  assert.ok(diagnosis.gaps.includes('GA4 runtime env is missing in Railway'));
});

test('generateRevenueStatusReport uses hosted railway audit when available', async () => {
  const runCalls = [];
  const report = await generateRevenueStatusReport({
    repo: 'IgorGanapolsky/mcp-memory-gateway',
    timeZone: 'America/New_York',
    runCommandFn(command, args) {
      runCalls.push([command, ...args]);
      if (command === 'gh') {
        return {
          status: 0,
          stdout: [
            'RAILWAY_PROJECT_ID\tproj_123\t2026-03-20T00:00:00Z',
            'RAILWAY_ENVIRONMENT_ID\tenv_456\t2026-03-20T00:00:00Z',
            'RAILWAY_SERVICE\trlhf-feedback-loop\t2026-03-20T00:00:00Z',
            'RLHF_PUBLIC_APP_ORIGIN\thttps://example.com\t2026-03-20T00:00:00Z',
            'RLHF_BILLING_API_BASE_URL\thttps://example.com\t2026-03-20T00:00:00Z',
          ].join('\n'),
          stderr: '',
          error: null,
        };
      }

      if (command === 'railway') {
        return {
          status: 0,
          stdout: JSON.stringify({
            runtimePresence: {
              RLHF_FEEDBACK_DIR: true,
              RLHF_API_KEY: true,
              RLHF_PUBLIC_APP_ORIGIN: false,
              RLHF_BILLING_API_BASE_URL: false,
              RLHF_GA_MEASUREMENT_ID: false,
              RLHF_CHECKOUT_FALLBACK_URL: true,
              STRIPE_SECRET_KEY: true,
            },
            summaries: {
              today: {
                status: 200,
                trafficMetrics: {
                  visitors: 6,
                  pageViews: 4,
                  checkoutStarts: 2,
                },
                signups: {
                  uniqueLeads: 2,
                },
                revenue: {
                  paidOrders: 0,
                  bookedRevenueCents: 0,
                },
                pipeline: {
                  workflowSprintLeads: {
                    total: 0,
                  },
                },
                dataQuality: {
                  attributionCoverage: 1,
                  telemetryCoverage: 1,
                },
              },
              '30d': {
                status: 200,
                trafficMetrics: {
                  visitors: 21,
                  pageViews: 15,
                  checkoutStarts: 9,
                },
                signups: {
                  uniqueLeads: 6,
                },
                revenue: {
                  paidOrders: 2,
                  bookedRevenueCents: 2000,
                },
                pipeline: {
                  workflowSprintLeads: {
                    total: 0,
                  },
                },
                dataQuality: {
                  attributionCoverage: 1,
                  telemetryCoverage: 1,
                },
              },
              lifetime: {
                status: 200,
                trafficMetrics: {
                  visitors: 21,
                  pageViews: 15,
                  checkoutStarts: 9,
                },
                signups: {
                  uniqueLeads: 6,
                },
                revenue: {
                  paidOrders: 2,
                  bookedRevenueCents: 2000,
                },
                pipeline: {
                  workflowSprintLeads: {
                    total: 0,
                  },
                },
                dataQuality: {
                  attributionCoverage: 1,
                  telemetryCoverage: 1,
                },
              },
            },
          }),
          stderr: '',
          error: null,
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    },
    fetchPublicProbe: async () => ({
      health: {
        status: 200,
        version: '0.7.4',
      },
      root: {
        status: 200,
        signals: {
          plausibleScript: true,
          telemetryEndpoint: true,
          gaLoaderScript: false,
          gaEventHook: true,
        },
      },
      telemetryPing: {
        status: 204,
      },
    }),
  });

  assert.equal(report.source, 'hosted-via-railway-env');
  assert.equal(report.diagnosis.primaryIssue, 'operator_blind_spot_local_fallback');
  assert.equal(report.hostedAudit.summaries['30d'].revenue.bookedRevenueCents, 2000);
  assert.ok(runCalls.some((call) => call[0] === 'railway' && call.includes('run')));

  const formatted = formatReport(report);
  assert.match(formatted, /Source: hosted-via-railway-env/);
  assert.match(formatted, /Today: visitors 6, pageViews 4, checkoutStarts 2/);
  assert.match(formatted, /30d: visitors 21, pageViews 15, checkoutStarts 9, paidOrders 2, bookedRevenue \$20.00/);
});
