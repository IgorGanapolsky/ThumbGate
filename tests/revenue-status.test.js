const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_REPO,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  HOSTED_WINDOWS,
  parseArgs,
  parseGhVariableList,
  parseHtmlSignals,
  resolveHostedAuditApiKey,
  fetchWithTimeout,
  normalizeExternalCustomerAudit,
  normalizeWindowSummary,
  normalizeWorkflowIntakeQueue,
  buildDiagnosis,
  formatReport,
  resolveExternalCustomerAudit,
  getHostedAuditViaHttp,
  generateRevenueStatusReport,
} = require('../scripts/revenue-status');

test('parseArgs defaults to the ThumbGate repo slug', () => {
  const options = parseArgs([]);
  assert.equal(options.repo, DEFAULT_REPO);
  assert.equal(options.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  assert.equal(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS);
  assert.equal(DEFAULT_REPO, 'IgorGanapolsky/ThumbGate');
});

test('parseArgs accepts bounded audit timeout overrides', () => {
  const options = parseArgs([
    '--fetch-timeout-ms=2500',
    '--command-timeout-ms=7000',
  ]);

  assert.equal(options.fetchTimeoutMs, 2500);
  assert.equal(options.commandTimeoutMs, 7000);
});

test('resolveHostedAuditApiKey prefers operator key over general API key', () => {
  assert.equal(resolveHostedAuditApiKey({
    THUMBGATE_OPERATOR_KEY: 'tg_operator',
    THUMBGATE_API_KEY: 'tg_api',
  }), 'tg_operator');
  assert.equal(resolveHostedAuditApiKey({
    THUMBGATE_API_KEY: 'tg_api',
  }, { operatorKey: null }), 'tg_api');
  assert.equal(resolveHostedAuditApiKey({
    THUMBGATE_OPERATOR_KEY: '   ',
    THUMBGATE_API_KEY: '',
  }, { operatorKey: null }), '');
  assert.equal(resolveHostedAuditApiKey({
    THUMBGATE_OPERATOR_KEY: '   ',
    THUMBGATE_API_KEY: 'tg_api',
  }, { operatorKey: 'tg_local_operator' }), 'tg_local_operator');
});

test('fetchWithTimeout rejects stalled hosted calls with a readable error', async () => {
  await assert.rejects(
    fetchWithTimeout(
      async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
      new URL('https://example.com/v1/billing/summary'),
      {},
      1
    ),
    /Timed out fetching https:\/\/example\.com\/v1\/billing\/summary after 1ms/
  );
});

test('parseGhVariableList reads gh variable output', () => {
  const parsed = parseGhVariableList([
    'RAILWAY_PROJECT_ID\tproj_123\t2026-03-20T00:00:00Z',
    'RAILWAY_ENVIRONMENT_ID\tenv_456\t2026-03-20T00:00:00Z',
    'RAILWAY_SERVICE\tthumbgate\t2026-03-20T00:00:00Z',
  ].join('\n'));

  assert.equal(parsed.RAILWAY_PROJECT_ID, 'proj_123');
  assert.equal(parsed.RAILWAY_ENVIRONMENT_ID, 'env_456');
  assert.equal(parsed.RAILWAY_SERVICE, 'thumbgate');
});

test('parseHtmlSignals detects telemetry and tracking hooks', () => {
  const signals = parseHtmlSignals(`
    <script defer data-domain="thumbgate-production.up.railway.app" src="https://plausible.io/js/script.js"></script>
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

test('normalizeExternalCustomerAudit summarizes real customers separately from owner/test activity', () => {
  const normalized = normalizeExternalCustomerAudit({
    configured: true,
    ownerEmails: ['owner@example.com'],
    productAttribution: {
      verified: false,
      gap: 'Account-wide only',
    },
    charges: {
      all: { chargeCount: 3, uniqueCustomerCount: 1, netCents: 16900 },
      owner: { chargeCount: 3, uniqueCustomerCount: 1, netCents: 16900 },
      external: { chargeCount: 0, uniqueCustomerCount: 0, netCents: 0 },
    },
    subscriptions: {
      activeOwner: 1,
      activeExternal: 0,
      mrrExternalCents: 0,
    },
    checkout: {
      externalSessions: 2358,
      completedExternal: 1,
    },
  });

  assert.equal(normalized.configured, true);
  assert.equal(normalized.externalCustomerCount, 0);
  assert.equal(normalized.externalNetRevenueCents, 0);
  assert.equal(normalized.ownerChargeCount, 3);
  assert.equal(normalized.ownerNetRevenueCents, 16900);
  assert.equal(normalized.activeOwnerSubscriptions, 1);
  assert.equal(normalized.productAttributionVerified, false);
  assert.equal(normalized.productAttributionGap, 'Account-wide only');
  assert.equal(normalized.accountWideExternalCustomerCount, 0);
});

test('normalizeExternalCustomerAudit exposes only reconciled ThumbGate attribution as external revenue', () => {
  const normalized = normalizeExternalCustomerAudit({
    configured: true,
    charges: {
      owner: { chargeCount: 0, netCents: 0 },
      external: { chargeCount: 2, uniqueCustomerCount: 2, netCents: 149800 },
    },
    subscriptions: { activeExternal: 1, mrrExternalCents: 4900 },
    productAttribution: {
      verified: true,
      thumbgate: {
        uniquePayingCustomerCount: 1,
        netRevenueCents: 49900,
        activeSubscriptionCount: 0,
        mrrCents: 0,
        revenueWindows: {
          verified: true,
          basis: 'Stripe charge cohort',
          timeZone: 'America/New_York',
          todayGrossRevenueCents: 49900,
          todayNetRevenueCents: 49900,
          trailing30DayGrossRevenueCents: 149800,
          trailing30DayNetRevenueCents: 149800,
        },
      },
    },
  });

  assert.equal(normalized.accountWideExternalCustomerCount, 2);
  assert.equal(normalized.accountWideExternalNetRevenueCents, 149800);
  assert.equal(normalized.externalCustomerCount, 1);
  assert.equal(normalized.externalNetRevenueCents, 49900);
  assert.equal(normalized.windowAttributionVerified, true);
  assert.equal(normalized.revenueWindowTimeZone, 'America/New_York');
  assert.equal(normalized.externalTodayGrossRevenueCents, 49900);
  assert.equal(normalized.externalTrailing30DayNetRevenueCents, 149800);
  assert.equal(normalized.activeExternalSubscriptions, 0);
  assert.equal(normalized.externalMrrCents, 0);
});

test('buildDiagnosis does not treat account-wide non-owner Stripe activity as ThumbGate revenue without product attribution', () => {
  const diagnosis = buildDiagnosis({
    publicProbe: {
      root: { signals: { telemetryEndpoint: true, plausibleScript: true } },
      telemetryPing: { status: 204 },
    },
    hostedAudit: {
      runtimePresence: {
        THUMBGATE_GA_MEASUREMENT_ID: true,
        THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: true,
        THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: true,
      },
      externalCustomerAudit: {
        configured: true,
        productAttribution: { verified: false, gap: 'Account-wide only' },
        charges: {
          owner: { chargeCount: 0, netCents: 0 },
          external: { chargeCount: 1, uniqueCustomerCount: 1, netCents: 49900 },
        },
        subscriptions: { activeOwner: 0, activeExternal: 0, mrrExternalCents: 0 },
      },
      summaries: {
        today: { status: 200 },
        '30d': {
          status: 200,
          trafficMetrics: { visitors: 10, pageViews: 15 },
          revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        },
        lifetime: { status: 200, revenue: { paidOrders: 0, bookedRevenueCents: 0 } },
      },
    },
  });

  assert.equal(diagnosis.externalCustomerRevenueObserved, false);
  assert.equal(diagnosis.primaryIssue, 'conversion_or_pricing_gap');
});

test('buildDiagnosis reports owner/test-only revenue instead of treating raw lifetime revenue as first-dollar proof', () => {
  const diagnosis = buildDiagnosis({
    publicProbe: {
      root: {
        signals: {
          telemetryEndpoint: true,
          plausibleScript: true,
          gaLoaderScript: true,
        },
      },
      telemetryPing: {
        status: 204,
      },
    },
    hostedAudit: {
      runtimePresence: {
        THUMBGATE_GA_MEASUREMENT_ID: true,
        THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: true,
        THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: true,
      },
      externalCustomerAudit: {
        configured: true,
        charges: {
          owner: { chargeCount: 3, netCents: 16900 },
          external: { chargeCount: 0, uniqueCustomerCount: 0, netCents: 0 },
        },
        subscriptions: {
          activeOwner: 1,
          activeExternal: 0,
          mrrExternalCents: 0,
        },
      },
      summaries: {
        today: { status: 200 },
        '30d': {
          status: 200,
          trafficMetrics: { visitors: 102, pageViews: 83 },
          revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        },
        lifetime: {
          status: 200,
          revenue: { paidOrders: 6, bookedRevenueCents: 16900 },
        },
      },
    },
  });

  assert.equal(diagnosis.primaryIssue, 'owner_test_revenue_only');
  assert.equal(diagnosis.hostedRevenueObserved, false);
  assert.equal(diagnosis.externalCustomerRevenueObserved, false);
  assert.equal(diagnosis.ownerTestRevenueOnly, true);
});

test('buildDiagnosis treats hosted funnel telemetry as implemented tracking even when root script detection is incomplete', () => {
  const diagnosis = buildDiagnosis({
    publicProbe: {
      root: {
        signals: {
          telemetryEndpoint: false,
          plausibleScript: false,
        },
      },
      telemetryPing: {
        status: 204,
      },
    },
    hostedAudit: {
      runtimePresence: {
        THUMBGATE_GA_MEASUREMENT_ID: true,
        THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: true,
        THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: true,
      },
      summaries: {
        today: { status: 200 },
        '30d': {
          status: 200,
          trafficMetrics: { visitors: 127, pageViews: 109, checkoutStarts: 2 },
          ctas: {
            checkoutIntent: { views: 2, clicks: 0 },
          },
          revenue: { paidOrders: 0, bookedRevenueCents: 0 },
          dataQuality: {
            attributionCoverage: 1,
            telemetryCoverage: 0.9937,
          },
        },
        lifetime: {
          status: 200,
          revenue: { paidOrders: 0, bookedRevenueCents: 0 },
        },
      },
    },
  });

  assert.equal(diagnosis.trackingImplemented, true);
  assert.equal(diagnosis.primaryIssue, 'conversion_or_pricing_gap');
});

test('resolveExternalCustomerAudit returns a visible unavailable marker when Railway vars are missing', () => {
  const audit = resolveExternalCustomerAudit({
    repoVars: {},
    runCommandFn() {
      throw new Error('should not call Railway without ids');
    },
  });

  assert.equal(audit.configured, false);
  assert.match(audit.gap, /Railway project\/environment variables are unavailable/);
});

test('buildDiagnosis prioritizes GA4 runtime config over stale local fallback labels', () => {
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
        THUMBGATE_GA_MEASUREMENT_ID: false,
        THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: false,
        THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: false,
        THUMBGATE_PUBLIC_APP_ORIGIN: false,
        THUMBGATE_BILLING_API_BASE_URL: false,
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

  assert.equal(diagnosis.primaryIssue, 'ga4_runtime_config_gap');
  assert.equal(diagnosis.trackingImplemented, true);
  assert.equal(diagnosis.telemetryIngressWorking, true);
  assert.equal(diagnosis.hostedSummaryWorking, true);
  assert.equal(diagnosis.hostedTrafficObserved, true);
  assert.equal(diagnosis.hostedRevenueObserved, true);
  assert.ok(diagnosis.gaps.includes('GA4 runtime env is missing in Railway'));
  assert.ok(diagnosis.gaps.includes('Workflow Hardening Diagnostic payment link env is missing in Railway'));
  assert.ok(diagnosis.gaps.includes('Workflow Hardening Sprint payment link env is missing in Railway'));
});

test('generateRevenueStatusReport uses hosted railway audit when available', async () => {
  const runCalls = [];
  const report = await generateRevenueStatusReport({
    repo: 'IgorGanapolsky/ThumbGate',
    timeZone: 'America/New_York',
    fetchTimeoutMs: 45000,
    apiKey: '',
    runCommandFn(command, args) {
      runCalls.push([command, ...args]);
      if (command === 'gh') {
        return {
          status: 0,
          stdout: [
            'RAILWAY_PROJECT_ID\tproj_123\t2026-03-20T00:00:00Z',
            'RAILWAY_ENVIRONMENT_ID\tenv_456\t2026-03-20T00:00:00Z',
            'RAILWAY_SERVICE\tthumbgate\t2026-03-20T00:00:00Z',
            'THUMBGATE_PUBLIC_APP_ORIGIN\thttps://example.com\t2026-03-20T00:00:00Z',
            'THUMBGATE_BILLING_API_BASE_URL\thttps://example.com\t2026-03-20T00:00:00Z',
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
              THUMBGATE_FEEDBACK_DIR: true,
              THUMBGATE_API_KEY: true,
              THUMBGATE_PUBLIC_APP_ORIGIN: false,
              THUMBGATE_BILLING_API_BASE_URL: false,
              THUMBGATE_GA_MEASUREMENT_ID: false,
              THUMBGATE_CHECKOUT_FALLBACK_URL: true,
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
                ctas: {
                  checkoutInterstitialViews: 3,
                  checkoutInterstitialClicks: 2,
                  checkoutInterstitialProConfirms: 1,
                  checkoutInterstitialWorkflowIntakeClicks: 1,
                  checkoutInterstitialTeamPathClicks: 0,
                  checkoutInterstitialDiagnosticCheckoutClicks: 1,
                  checkoutInterstitialWorkflowSprintCheckoutClicks: 0,
                  checkoutBotDeflections: 4,
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
                ctas: {
                  checkoutInterstitialViews: 12,
                  checkoutInterstitialClicks: 5,
                  checkoutInterstitialProConfirms: 3,
                  checkoutInterstitialWorkflowIntakeClicks: 1,
                  checkoutInterstitialTeamPathClicks: 1,
                  checkoutInterstitialDiagnosticCheckoutClicks: 2,
                  checkoutInterstitialWorkflowSprintCheckoutClicks: 1,
                  checkoutBotDeflections: 7,
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
  assert.equal(report.diagnosis.primaryIssue, 'ga4_runtime_config_gap');
  assert.equal(report.hostedAudit.summaries['30d'].revenue.bookedRevenueCents, 2000);
  assert.ok(runCalls.some((call) => call[0] === 'railway' && call.includes('run')));
  assert.ok(
    runCalls.some((call) => call[0] === 'railway' && call.some((arg) => String(arg).includes('const fetchTimeoutMs = 45000;')))
  );

  const formatted = formatReport(report);
  assert.match(formatted, /Source: hosted-via-railway-env/);
  assert.match(formatted, /Today: visitors 6, pageViews 4, checkoutStarts 2.*checkoutIntent views 3, clicks 2, stripeConfirms 1, intakeClicks 1, teamPathClicks 0, diagnosticClicks 1, sprintCheckoutClicks 0, botDeflections 4/);
  assert.match(formatted, /30d: visitors 21, pageViews 15, checkoutStarts 9, paidOrders 2, bookedRevenue \$20.00/);
  assert.match(formatted, /30d: .*checkoutIntent views 12, clicks 5, stripeConfirms 3, intakeClicks 1, teamPathClicks 1, diagnosticClicks 2, sprintCheckoutClicks 1, botDeflections 7/);
});

test('getHostedAuditViaHttp prefers one batched summary and strips intake identities', async () => {
  const requestedWindows = [];
  const hostedAudit = await getHostedAuditViaHttp({
    appOrigin: 'https://example.com',
    apiKey: 'tg_test_key',
    timeZone: 'America/New_York',
    fetchImpl: async (url, options) => {
      requestedWindows.push(url.searchParams.get('window'));
      assert.equal(options.headers.authorization, 'Bearer tg_test_key');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          summaries: Object.fromEntries(HOSTED_WINDOWS.map((window) => [window, {
            trafficMetrics: { visitors: window === '30d' ? 30 : 3 },
            revenue: { paidOrders: 0, bookedRevenueCents: 0 },
          }])),
          runtimePresence: { THUMBGATE_OPERATOR_KEY: true },
          intakeQueue: {
            total: 5,
            eligibleTotal: 5,
            returned: 5,
            byStatus: { new: 5 },
            latestSubmittedAt: '2026-07-16T02:45:45.748Z',
            oldestSubmittedAt: '2026-07-01T12:00:00.000Z',
            leads: [{ contact: { email: 'must-not-leak@example.com' } }],
          },
        }),
      };
    },
  });

  assert.deepEqual(requestedWindows, ['all']);
  assert.equal(hostedAudit.batchSummary, true);
  assert.equal(hostedAudit.summaries['30d'].trafficMetrics.visitors, 30);
  assert.equal(hostedAudit.intakeQueue.eligibleTotal, 5);
  assert.equal(hostedAudit.intakeQueue.byStatus.new, 5);
  assert.equal(hostedAudit.intakeQueue.leads, undefined);
  assert.doesNotMatch(JSON.stringify(hostedAudit), /must-not-leak/);
});

test('getHostedAuditViaHttp falls back to per-window summaries for older deployments', async () => {
  const requestedWindows = [];
  const hostedAudit = await getHostedAuditViaHttp({
    appOrigin: 'https://example.com',
    apiKey: 'tg_test_key',
    timeZone: 'America/New_York',
    fetchImpl: async (url, options) => {
      requestedWindows.push(url.searchParams.get('window'));
      assert.equal(options.headers.authorization, 'Bearer tg_test_key');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          trafficMetrics: {
            visitors: 3,
            checkoutStarts: 1,
          },
          ctas: {
            checkoutStartsBySource: {
              website: 1,
            },
          },
          revenue: {
            paidOrders: 1,
            bookedRevenueCents: 4900,
          },
          attribution: {
            paidBySource: {
              website: 1,
            },
          },
          dataQuality: {
            attributionCoverage: 1,
            telemetryCoverage: 1,
          },
        }),
      };
    },
  });

  assert.equal(hostedAudit.auditMethod, 'hosted-http-api');
  assert.equal(hostedAudit.runtimePresenceKnown, false);
  assert.deepEqual(requestedWindows, ['all', 'today', '30d', 'lifetime']);
  assert.equal(hostedAudit.batchSummary, false);
  assert.equal(hostedAudit.summaries['30d'].revenue.bookedRevenueCents, 4900);
  assert.equal(hostedAudit.summaries['30d'].ctas.checkoutStartsBySource.website, 1);
  assert.equal(hostedAudit.summaries['30d'].attribution.paidBySource.website, 1);
});

test('normalizeWorkflowIntakeQueue never preserves contact rows', () => {
  const queue = normalizeWorkflowIntakeQueue({
    total: 2,
    eligibleTotal: 1,
    returned: 1,
    approvalReadyTotal: 1,
    discoveryReadyTotal: 2,
    byStatus: { new: 1, paid_team: 1 },
    latestSubmittedAt: '2026-07-16T02:45:45.748Z',
    leads: [{ contact: { email: 'private@example.com' } }],
  });

  assert.equal(queue.total, 2);
  assert.equal(queue.eligibleTotal, 1);
  assert.equal(queue.approvalReadyTotal, 1);
  assert.equal(queue.discoveryReadyTotal, 2);
  assert.equal(queue.leads, undefined);
  assert.doesNotMatch(JSON.stringify(queue), /private@example.com/);
});

test('normalizeWindowSummary strips lead, payment-event, and latest-order records', () => {
  const summary = normalizeWindowSummary(200, {
    revenue: {
      paidOrders: 1,
      bookedRevenueCents: 49900,
      latestPaidOrder: { email: 'paid-private@example.com' },
      events: [{ customerEmail: 'event-private@example.com' }],
    },
    pipeline: {
      workflowSprintLeads: {
        total: 5,
        contactable: 5,
        byStatus: { new: 5 },
        latestLeadAt: '2026-07-16T02:45:45.748Z',
        latestLead: { email: 'lead-private@example.com', company: 'Private Co' },
      },
    },
  });

  assert.equal(summary.revenue.paidOrders, 1);
  assert.equal(summary.revenue.latestPaidOrder, undefined);
  assert.equal(summary.revenue.events, undefined);
  assert.equal(summary.pipeline.workflowSprintLeads.total, 5);
  assert.equal(summary.pipeline.workflowSprintLeads.latestLead, undefined);
  assert.doesNotMatch(JSON.stringify(summary), /private@example.com|Private Co/);
});

test('formatReport exposes intake counts while withholding contact details', () => {
  const report = {
    generatedAt: '2026-07-16T12:00:00.000Z',
    source: 'hosted-http-api',
    diagnosis: {
      primaryIssue: 'conversion_or_pricing_gap',
      trackingImplemented: true,
      telemetryIngressWorking: true,
      hostedSummaryWorking: true,
      hostedTrafficObserved: true,
      hostedRevenueObserved: false,
      externalCustomerRevenueObserved: false,
      hostedAuditMethod: 'hosted-http-api',
      runtimePresenceKnown: true,
      gaps: [],
    },
    publicProbe: {
      health: { status: 200, version: '1.28.4' },
      telemetryPing: { status: 204 },
    },
    hostedAudit: {
      runtimePresence: {},
      summaries: Object.fromEntries(HOSTED_WINDOWS.map((window) => [window, {
        trafficMetrics: {},
        ctas: {},
        revenue: {},
        signups: {},
        pipeline: {},
        dataQuality: { attributionCoverage: 1, telemetryCoverage: 1 },
      }])),
      intakeQueue: normalizeWorkflowIntakeQueue({
        total: 5,
        eligibleTotal: 5,
        returned: 5,
        approvalReadyTotal: 1,
        discoveryReadyTotal: 4,
        byStatus: { new: 4, qualified: 1 },
        latestSubmittedAt: '2026-07-16T02:45:45.748Z',
        leads: [{ contact: { email: 'private@example.com' } }],
      }),
    },
  };

  const formatted = formatReport(report);
  assert.match(formatted, /Operator intake queue: eligible 5, discovery-ready 4, close-ready 1, new 4, qualified 1/);
  assert.match(formatted, /contact details withheld/);
  assert.doesNotMatch(formatted, /private@example.com/);
});

test('getHostedAuditViaHttp carries hosted runtime presence when exposed', async () => {
  const hostedAudit = await getHostedAuditViaHttp({
    appOrigin: 'https://example.com',
    apiKey: 'tg_test_key',
    timeZone: 'America/New_York',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        runtimePresence: {
          THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: true,
          THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: true,
        },
        trafficMetrics: {
          visitors: 3,
          checkoutStarts: 1,
        },
        revenue: {
          paidOrders: 0,
          bookedRevenueCents: 0,
        },
      }),
    }),
  });

  assert.equal(hostedAudit.runtimePresenceKnown, true);
  assert.equal(hostedAudit.runtimePresence.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL, true);
  assert.equal(hostedAudit.runtimePresence.THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL, true);
});

test('generateRevenueStatusReport prefers hosted HTTP API when THUMBGATE_API_KEY is available', async () => {
  const runCalls = [];
  const report = await generateRevenueStatusReport({
    repo: 'IgorGanapolsky/ThumbGate',
    timeZone: 'America/New_York',
    apiKey: 'tg_test_key',
    runCommandFn(command, args) {
      runCalls.push([command, ...args]);
      if (command === 'gh') {
        return {
          status: 0,
          stdout: 'THUMBGATE_PUBLIC_APP_ORIGIN\thttps://example.com\t2026-04-14T00:00:00Z\n',
          stderr: '',
          error: null,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        trafficMetrics: {
          visitors: 9,
          pageViews: 7,
          checkoutStarts: 2,
        },
        signups: {
          uniqueLeads: 1,
        },
        revenue: {
          paidOrders: 1,
          bookedRevenueCents: 4900,
        },
        pipeline: {
          workflowSprintLeads: {
            total: 1,
          },
        },
        dataQuality: {
          attributionCoverage: 1,
          telemetryCoverage: 1,
        },
      }),
    }),
    fetchPublicProbe: async () => ({
      health: {
        status: 200,
        version: '1.5.0',
      },
      root: {
        status: 200,
        signals: {
          plausibleScript: true,
          telemetryEndpoint: true,
          gaLoaderScript: true,
          gaEventHook: true,
        },
      },
      telemetryPing: {
        status: 204,
      },
    }),
  });

  assert.equal(report.source, 'hosted-http-api');
  assert.equal(report.diagnosis.hostedSummaryWorking, true);
  assert.equal(report.diagnosis.runtimePresenceKnown, false);
  assert.equal(report.hostedAudit.summaries.today.revenue.bookedRevenueCents, 4900);
  assert.ok(!runCalls.some((call) => call[0] === 'railway'));
  assert.match(formatReport(report), /Railway runtime inspected: no/);
});

test('generateRevenueStatusReport degrades when local fallback summary is unavailable', async () => {
  const report = await generateRevenueStatusReport({
    repo: 'IgorGanapolsky/ThumbGate',
    timeZone: 'America/New_York',
    apiKey: '',
    runCommandFn() {
      return {
        status: 1,
        stdout: '',
        stderr: 'gh unavailable',
        error: null,
      };
    },
    fetchPublicProbe: async () => ({
      health: {
        status: 200,
        version: '1.5.0',
      },
      root: {
        status: 200,
        signals: {
          plausibleScript: true,
          telemetryEndpoint: true,
          gaLoaderScript: false,
        },
      },
      telemetryPing: {
        status: 204,
      },
    }),
    localFallbackFn: async () => {
      throw new Error('operator key mismatch');
    },
  });

  assert.equal(report.source, 'local-fallback');
  assert.equal(report.hostedAudit.summaries.today.status, 'unavailable');
  assert.ok(report.diagnosis.gaps.includes('operator key mismatch'));
  assert.ok(report.diagnosis.gaps.includes('local operational billing summary is unavailable'));
});

test('generateRevenueStatusReport degrades when public runtime probe fails', async () => {
  const report = await generateRevenueStatusReport({
    repo: 'IgorGanapolsky/ThumbGate',
    timeZone: 'America/New_York',
    apiKey: '',
    runCommandFn(command) {
      if (command === 'gh') {
        return {
          status: 1,
          stdout: '',
          stderr: 'not authenticated',
          error: null,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    fetchPublicProbe: async () => {
      throw new Error('Timed out fetching https://example.com/health after 5ms');
    },
  });

  assert.equal(report.source, 'local-fallback');
  assert.equal(report.publicProbe.health.status, 0);
  assert.ok(
    report.diagnosis.gaps.includes('Public runtime probe failed: Timed out fetching https://example.com/health after 5ms')
  );
});
