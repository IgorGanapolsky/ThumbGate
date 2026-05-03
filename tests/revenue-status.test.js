const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_REPO,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  parseArgs,
  parseGhVariableList,
  parseHtmlSignals,
  fetchWithTimeout,
  buildDiagnosis,
  formatReport,
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

  assert.equal(diagnosis.primaryIssue, 'operator_blind_spot_local_fallback');
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

test('getHostedAuditViaHttp reads hosted billing summary without Railway CLI', async () => {
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
  assert.deepEqual(requestedWindows, ['today', '30d', 'lifetime']);
  assert.equal(hostedAudit.summaries['30d'].revenue.bookedRevenueCents, 4900);
  assert.equal(hostedAudit.summaries['30d'].ctas.checkoutStartsBySource.website, 1);
  assert.equal(hostedAudit.summaries['30d'].attribution.paidBySource.website, 1);
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
