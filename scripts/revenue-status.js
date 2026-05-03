#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  DEFAULT_PUBLIC_APP_ORIGIN,
} = require('./hosted-config');

const DEFAULT_REPO = 'IgorGanapolsky/ThumbGate';
const DEFAULT_RAILWAY_SERVICE = 'thumbgate';
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
const HOSTED_WINDOWS = ['today', '30d', 'lifetime'];
const RUNTIME_KEYS = [
  'THUMBGATE_FEEDBACK_DIR',
  'THUMBGATE_API_KEY',
  'THUMBGATE_PUBLIC_APP_ORIGIN',
  'THUMBGATE_BILLING_API_BASE_URL',
  'THUMBGATE_GA_MEASUREMENT_ID',
  'THUMBGATE_CHECKOUT_FALLBACK_URL',
  'THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL',
  'THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL',
  'STRIPE_SECRET_KEY',
];

function parseArgs(argv = []) {
  const options = {
    json: false,
    repo: process.env.THUMBGATE_GITHUB_REPO || DEFAULT_REPO,
    timeZone: process.env.TZ || 'America/New_York',
    fetchTimeoutMs: parsePositiveInteger(
      process.env.THUMBGATE_REVENUE_STATUS_FETCH_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS
    ),
    commandTimeoutMs: parsePositiveInteger(
      process.env.THUMBGATE_REVENUE_STATUS_COMMAND_TIMEOUT_MS,
      DEFAULT_COMMAND_TIMEOUT_MS
    ),
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length).trim() || options.repo;
      continue;
    }
    if (arg.startsWith('--timezone=')) {
      options.timeZone = arg.slice('--timezone='.length).trim() || options.timeZone;
      continue;
    }
    if (arg.startsWith('--fetch-timeout-ms=')) {
      options.fetchTimeoutMs = parsePositiveInteger(
        arg.slice('--fetch-timeout-ms='.length),
        options.fetchTimeoutMs
      );
      continue;
    }
    if (arg.startsWith('--command-timeout-ms=')) {
      options.commandTimeoutMs = parsePositiveInteger(
        arg.slice('--command-timeout-ms='.length),
        options.commandTimeoutMs
      );
    }
  }

  return options;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseGhVariableList(stdout = '') {
  const variables = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, value] = line.split('\t');
    if (!name || value === undefined) continue;
    variables[name.trim()] = value.trim();
  }
  return variables;
}

function parseHtmlSignals(html = '') {
  const body = String(html);
  return {
    plausibleScript: /plausible\.io\/js\/script\.js|\/js\/analytics\.js/.test(body),
    gaLoaderScript: body.includes('googletagmanager.com/gtag/js'),
    gaEventHook: body.includes('window.gtag('),
    gaPlaceholderPresent: body.includes('__GA_MEASUREMENT_ID__'),
    telemetryEndpoint: body.includes('/v1/telemetry/ping'),
    workflowSprintIntake: body.includes('workflow-sprint-intake'),
    webmcpBadge: body.includes('WebMCP-ready'),
  };
}

function centsToDollars(value) {
  return `$${(Number(value || 0) / 100).toFixed(2)}`;
}

function formatRatio(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '0.0000';
}

function normalizeWindowSummary(status, payload = {}) {
  return {
    status,
    trafficMetrics: payload.trafficMetrics || {},
    ctas: payload.ctas || {},
    signups: payload.signups || {},
    revenue: payload.revenue || {},
    pipeline: payload.pipeline || {},
    attribution: payload.attribution || {},
    dataQuality: payload.dataQuality || {},
  };
}

function windowSnapshot(summary = {}) {
  return {
    status: summary.status,
    trafficMetrics: summary.trafficMetrics || {},
    ctas: summary.ctas || {},
    signups: summary.signups || {},
    revenue: summary.revenue || {},
    pipeline: summary.pipeline || {},
    attribution: summary.attribution || {},
    dataQuality: summary.dataQuality || {},
  };
}

function buildDiagnosis({ publicProbe, hostedAudit }) {
  const today = hostedAudit?.summaries?.today || null;
  const trailing30 = hostedAudit?.summaries?.['30d'] || null;
  const runtimePresence = hostedAudit?.runtimePresence || {};
  const runtimePresenceKnown = Boolean(hostedAudit?.runtimePresenceKnown !== false);
  const traffic30 = trailing30?.trafficMetrics || {};
  const revenue30 = trailing30?.revenue || {};

  const trackingImplemented = Boolean(
    publicProbe?.root?.signals?.telemetryEndpoint &&
    publicProbe.root.signals.plausibleScript
  );
  const telemetryIngressWorking = Boolean(publicProbe?.telemetryPing?.status === 204);
  const hostedSummaryWorking = Boolean(today?.status === 200 && trailing30?.status === 200);
  const hostedTrafficObserved = Number(traffic30.visitors || 0) > 0 || Number(traffic30.pageViews || 0) > 0;
  const hostedRevenueObserved = Number(revenue30.paidOrders || 0) > 0 || Number(revenue30.bookedRevenueCents || 0) > 0;

  let primaryIssue = 'inconclusive';
  if (trackingImplemented && telemetryIngressWorking && hostedSummaryWorking && hostedTrafficObserved) {
    primaryIssue = 'operator_blind_spot_local_fallback';
  } else if (trackingImplemented && telemetryIngressWorking && hostedSummaryWorking) {
    primaryIssue = 'low_traffic';
  } else if (trackingImplemented && telemetryIngressWorking) {
    primaryIssue = 'hosted_summary_access_or_config_gap';
  } else if (trackingImplemented) {
    primaryIssue = 'telemetry_ingestion_gap';
  }

  const gaps = [];
  if (publicProbe?.error) {
    gaps.push(`Public runtime probe failed: ${publicProbe.error}`);
  }
  if (runtimePresenceKnown && !runtimePresence.THUMBGATE_GA_MEASUREMENT_ID) {
    gaps.push('GA4 runtime env is missing in Railway');
  }
  if (runtimePresenceKnown && !runtimePresence.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL) {
    gaps.push('Workflow Hardening Diagnostic payment link env is missing in Railway');
  }
  if (runtimePresenceKnown && !runtimePresence.THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL) {
    gaps.push('Workflow Hardening Sprint payment link env is missing in Railway');
  }
  if (runtimePresenceKnown && !runtimePresence.THUMBGATE_PUBLIC_APP_ORIGIN) {
    gaps.push('THUMBGATE_PUBLIC_APP_ORIGIN is not explicitly set in Railway runtime');
  }
  if (runtimePresenceKnown && !runtimePresence.THUMBGATE_BILLING_API_BASE_URL) {
    gaps.push('THUMBGATE_BILLING_API_BASE_URL is not explicitly set in Railway runtime');
  }
  if (trackingImplemented && !publicProbe.root.signals.gaLoaderScript) {
    gaps.push('GA event hooks exist in the page, but the GA loader script is absent');
  }

  return {
    trackingImplemented,
    telemetryIngressWorking,
    hostedSummaryWorking,
    hostedTrafficObserved,
    hostedRevenueObserved,
    runtimePresenceKnown,
    hostedAuditMethod: hostedAudit?.auditMethod || 'unknown',
    primaryIssue,
    gaps,
  };
}

function formatWindowBlock(label, summary = {}) {
  const traffic = summary.trafficMetrics || {};
  const revenue = summary.revenue || {};
  const signups = summary.signups || {};
  const pipeline = summary.pipeline || {};
  const sprintLeads = pipeline.workflowSprintLeads || {};

  return [
    `${label}: visitors ${traffic.visitors || 0}, pageViews ${traffic.pageViews || 0}, checkoutStarts ${traffic.checkoutStarts || 0}, paidOrders ${revenue.paidOrders || 0}, bookedRevenue ${centsToDollars(revenue.bookedRevenueCents || 0)}, sprintLeads ${sprintLeads.total || 0}, signups ${signups.uniqueLeads || 0}`,
  ];
}

function formatRuntimeState({ value, runtimePresenceKnown }) {
  if (value) return 'set';
  return runtimePresenceKnown ? 'missing' : 'unknown';
}

function formatRuntimeFlags(report) {
  return RUNTIME_KEYS.map((key) => {
    const value = report.hostedAudit.runtimePresence[key];
    const state = formatRuntimeState({
      value,
      runtimePresenceKnown: report.diagnosis.runtimePresenceKnown,
    });
    return `${key}=${state}`;
  }).join(', ');
}

function formatReport(report) {
  const lines = [
    `Revenue Status @ ${report.generatedAt}`,
    `Source: ${report.source}`,
    `Primary issue: ${report.diagnosis.primaryIssue}`,
    `Tracking implemented: ${report.diagnosis.trackingImplemented ? 'yes' : 'no'}`,
    `Telemetry ingress working: ${report.diagnosis.telemetryIngressWorking ? 'yes' : 'no'}`,
    `Hosted summary working: ${report.diagnosis.hostedSummaryWorking ? 'yes' : 'no'}`,
    `Hosted traffic observed: ${report.diagnosis.hostedTrafficObserved ? 'yes' : 'no'}`,
    `Hosted revenue observed: ${report.diagnosis.hostedRevenueObserved ? 'yes' : 'no'}`,
    `Hosted audit method: ${report.diagnosis.hostedAuditMethod}`,
    `Railway runtime inspected: ${report.diagnosis.runtimePresenceKnown ? 'yes' : 'no'}`,
    '',
    `Public health: ${report.publicProbe.health.status} (${report.publicProbe.health.version || 'unknown version'})`,
    `Telemetry ping probe: ${report.publicProbe.telemetryPing.status}`,
    `Runtime flags: ${formatRuntimeFlags(report)}`,
    '',
    ...formatWindowBlock('Today', report.hostedAudit.summaries.today),
    ...formatWindowBlock('30d', report.hostedAudit.summaries['30d']),
    ...formatWindowBlock('Lifetime', report.hostedAudit.summaries.lifetime),
    '',
    `30d attribution coverage: ${formatRatio(report.hostedAudit.summaries['30d'].dataQuality.attributionCoverage)}`,
    `30d telemetry coverage: ${formatRatio(report.hostedAudit.summaries['30d'].dataQuality.telemetryCoverage)}`,
  ];

  if (report.diagnosis.gaps.length) {
    lines.push('');
    lines.push('Gaps:');
    for (const gap of report.diagnosis.gaps) {
      lines.push(`- ${gap}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  };
}

function requireCommandSuccess(name, result) {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `${name} failed`;
    throw new Error(message);
  }
  return result.stdout;
}

function getRepoVariables({ repo = DEFAULT_REPO, runCommandFn = runCommand, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  const stdout = requireCommandSuccess(
    'gh variable list',
    runCommandFn('gh', ['variable', 'list', '-R', repo], { timeout: commandTimeoutMs })
  );
  return parseGhVariableList(stdout);
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const timeout = parsePositiveInteger(timeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const displayUrl = url?.href || String(url);
      throw new Error(`Timed out fetching ${displayUrl} after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function probePublicRuntime(appOrigin, { fetchImpl = fetch, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
  const healthUrl = new URL('/health', appOrigin);
  const rootUrl = new URL('/', appOrigin);
  const telemetryUrl = new URL('/v1/telemetry/ping', appOrigin);

  const healthRes = await fetchWithTimeout(fetchImpl, healthUrl, {}, timeoutMs);
  const healthJson = await healthRes.json();
  const rootRes = await fetchWithTimeout(fetchImpl, rootUrl, {}, timeoutMs);
  const rootHtml = await rootRes.text();

  const probeId = crypto.randomUUID();
  const telemetryRes = await fetchWithTimeout(fetchImpl, telemetryUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      eventType: 'ops_live_audit_probe',
      clientType: 'web',
      installId: `audit_install_${probeId}`,
      visitorId: `audit_visitor_${probeId}`,
      sessionId: `audit_session_${probeId}`,
      acquisitionId: `audit_acq_${probeId}`,
      page: '/',
      pageTitle: 'Ops Live Audit Probe',
      source: 'website',
      utmSource: 'website',
      utmMedium: 'ops_audit',
      utmCampaign: 'ops_live_audit',
      ctaId: 'ops_live_audit',
    }),
  }, timeoutMs);

  return {
    health: {
      status: healthRes.status,
      version: healthJson.version || null,
      deployment: healthJson.deployment || null,
    },
    root: {
      status: rootRes.status,
      signals: parseHtmlSignals(rootHtml),
    },
    telemetryPing: {
      status: telemetryRes.status,
    },
  };
}

function buildRailwayAuditSnippet({ appOrigin, timeZone }) {
  return `
    (async () => {
      const base = ${JSON.stringify(appOrigin)};
      const fetchTimeoutMs = ${JSON.stringify(DEFAULT_FETCH_TIMEOUT_MS)};
      async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }
      const runtimePresence = {};
      for (const key of ${JSON.stringify(RUNTIME_KEYS)}) {
        runtimePresence[key] = Boolean(process.env[key]);
      }

      const summaries = {};
      for (const window of ${JSON.stringify(HOSTED_WINDOWS)}) {
        const url = new URL('/v1/billing/summary', base);
        url.searchParams.set('window', window);
        url.searchParams.set('timezone', ${JSON.stringify(timeZone)});
        const response = await fetchWithTimeout(url, {
          headers: {
            authorization: 'Bearer ' + process.env.THUMBGATE_API_KEY,
            accept: 'application/json',
          },
        });
        const payload = await response.json();
        summaries[window] = {
          status: response.status,
          trafficMetrics: payload.trafficMetrics || {},
          ctas: payload.ctas || {},
          signups: payload.signups || {},
          revenue: payload.revenue || {},
          pipeline: payload.pipeline || {},
          attribution: payload.attribution || {},
          dataQuality: payload.dataQuality || {},
        };
      }

      console.log(JSON.stringify({
        auditMethod: 'railway-env',
        runtimePresenceKnown: true,
        runtimePresence,
        summaries,
      }, null, 2));
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exit(1);
    });
  `;
}

function getHostedAuditViaRailway({
  projectId,
  environmentId,
  service = DEFAULT_RAILWAY_SERVICE,
  appOrigin = DEFAULT_PUBLIC_APP_ORIGIN,
  timeZone = 'America/New_York',
  runCommandFn = runCommand,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
} = {}) {
  const snippet = buildRailwayAuditSnippet({ appOrigin, timeZone });
  const stdout = requireCommandSuccess(
    'railway run',
    runCommandFn('railway', [
      'run',
      '-p',
      projectId,
      '-e',
      environmentId,
      '-s',
      service,
      '--',
      'node',
      '-e',
      snippet,
    ], { timeout: commandTimeoutMs })
  );
  const hostedAudit = JSON.parse(stdout);
  return {
    auditMethod: 'railway-env',
    runtimePresenceKnown: true,
    ...hostedAudit,
  };
}

async function getHostedAuditViaHttp({
  appOrigin = DEFAULT_PUBLIC_APP_ORIGIN,
  apiKey = process.env.THUMBGATE_API_KEY,
  timeZone = 'America/New_York',
  fetchImpl = fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
} = {}) {
  if (!apiKey) {
    throw new Error('THUMBGATE_API_KEY is not set for hosted billing summary audit.');
  }

  const summaries = {};
  for (const window of HOSTED_WINDOWS) {
    const url = new URL('/v1/billing/summary', appOrigin);
    url.searchParams.set('window', window);
    url.searchParams.set('timezone', timeZone);
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
    }, timeoutMs);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Hosted billing summary ${window} returned ${response.status}`);
    }
    summaries[window] = normalizeWindowSummary(response.status, payload);
  }

  return {
    auditMethod: 'hosted-http-api',
    runtimePresenceKnown: false,
    runtimePresence: {
      THUMBGATE_API_KEY: true,
    },
    summaries,
  };
}

async function getLocalFallback(timeZone) {
  const {
    getOperationalBillingSummary,
  } = require('./operational-summary');
  const result = await getOperationalBillingSummary({
    window: 'today',
    timeZone,
  });
  return {
    source: 'local',
    fallbackReason: result.fallbackReason,
    summary: result.summary,
  };
}

async function generateRevenueStatusReport({
  repo = DEFAULT_REPO,
  timeZone = 'America/New_York',
  runCommandFn = runCommand,
  fetchPublicProbe = probePublicRuntime,
  fetchImpl = fetch,
  apiKey = process.env.THUMBGATE_API_KEY,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  localFallbackFn = getLocalFallback,
} = {}) {
  let repoVars = {};
  let repoVarError = null;
  try {
    repoVars = getRepoVariables({ repo, runCommandFn, commandTimeoutMs });
  } catch (error) {
    repoVarError = error;
  }

  const appOrigin = repoVars.THUMBGATE_PUBLIC_APP_ORIGIN || DEFAULT_PUBLIC_APP_ORIGIN;
  let publicProbe;
  try {
    publicProbe = await fetchPublicProbe(appOrigin, {
      fetchImpl,
      timeoutMs: fetchTimeoutMs,
    });
  } catch (error) {
    publicProbe = {
      error: error?.message || String(error),
      health: {
        status: 0,
        version: null,
        deployment: null,
      },
      root: {
        status: 0,
        signals: {},
      },
      telemetryPing: {
        status: 0,
      },
    };
  }
  const hostedApiOrigin = repoVars.THUMBGATE_BILLING_API_BASE_URL || appOrigin;
  let hostedHttpError = null;

  try {
    const hostedAudit = await getHostedAuditViaHttp({
      appOrigin: hostedApiOrigin,
      apiKey,
      timeZone,
      fetchImpl,
      timeoutMs: fetchTimeoutMs,
    });

    return {
      generatedAt: new Date().toISOString(),
      repo,
      source: 'hosted-http-api',
      repoVars: {
        RAILWAY_PROJECT_ID: Boolean(repoVars.RAILWAY_PROJECT_ID),
        RAILWAY_ENVIRONMENT_ID: Boolean(repoVars.RAILWAY_ENVIRONMENT_ID),
        RAILWAY_SERVICE: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
        THUMBGATE_PUBLIC_APP_ORIGIN: appOrigin,
        THUMBGATE_BILLING_API_BASE_URL: hostedApiOrigin,
      },
      publicProbe,
      hostedAudit,
      diagnosis: buildDiagnosis({
        publicProbe,
        hostedAudit,
      }),
    };
  } catch (error) {
    hostedHttpError = error;
  }

  try {
    if (!repoVars.RAILWAY_PROJECT_ID || !repoVars.RAILWAY_ENVIRONMENT_ID) {
      throw repoVarError || new Error('GitHub repo variables for Railway are unavailable.');
    }

    const hostedAudit = getHostedAuditViaRailway({
      projectId: repoVars.RAILWAY_PROJECT_ID,
      environmentId: repoVars.RAILWAY_ENVIRONMENT_ID,
      service: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
      appOrigin: hostedApiOrigin,
      timeZone,
      runCommandFn,
      commandTimeoutMs,
    });

    return {
      generatedAt: new Date().toISOString(),
      repo,
      source: 'hosted-via-railway-env',
      repoVars: {
        RAILWAY_PROJECT_ID: Boolean(repoVars.RAILWAY_PROJECT_ID),
        RAILWAY_ENVIRONMENT_ID: Boolean(repoVars.RAILWAY_ENVIRONMENT_ID),
        RAILWAY_SERVICE: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
        THUMBGATE_PUBLIC_APP_ORIGIN: appOrigin,
        THUMBGATE_BILLING_API_BASE_URL: hostedApiOrigin,
      },
      publicProbe,
      hostedAudit,
      diagnosis: buildDiagnosis({
        publicProbe,
        hostedAudit,
      }),
    };
  } catch (error) {
    let fallback;
    let fallbackError = null;
    try {
      fallback = await localFallbackFn(timeZone);
    } catch (localError) {
      fallbackError = localError;
      fallback = {
        source: 'local',
        fallbackReason: 'local operational billing summary is unavailable',
        summary: normalizeWindowSummary('unavailable'),
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      repo,
      source: 'local-fallback',
      repoVars: {
        RAILWAY_PROJECT_ID: Boolean(repoVars.RAILWAY_PROJECT_ID),
        RAILWAY_ENVIRONMENT_ID: Boolean(repoVars.RAILWAY_ENVIRONMENT_ID),
        RAILWAY_SERVICE: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
        THUMBGATE_PUBLIC_APP_ORIGIN: appOrigin,
        THUMBGATE_BILLING_API_BASE_URL: hostedApiOrigin,
      },
      publicProbe,
      hostedAudit: {
        auditMethod: 'local-fallback',
        runtimePresenceKnown: true,
        runtimePresence: {},
        summaries: {
          today: windowSnapshot(fallback.summary),
          '30d': windowSnapshot(),
          lifetime: windowSnapshot(),
        },
        error: error.message,
      },
      diagnosis: {
        trackingImplemented: Boolean(publicProbe.root?.signals?.telemetryEndpoint),
        telemetryIngressWorking: Boolean(publicProbe.telemetryPing?.status === 204),
        hostedSummaryWorking: false,
        hostedTrafficObserved: false,
        hostedRevenueObserved: false,
        runtimePresenceKnown: true,
        hostedAuditMethod: 'local-fallback',
        primaryIssue: 'hosted_summary_access_or_config_gap',
        gaps: [
          publicProbe.error ? `Public runtime probe failed: ${publicProbe.error}` : null,
          repoVarError?.message,
          hostedHttpError?.message,
          error.message,
          fallbackError?.message,
          fallback.fallbackReason,
        ].filter(Boolean),
      },
    };
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await generateRevenueStatusReport({
    repo: options.repo,
    timeZone: options.timeZone,
    fetchTimeoutMs: options.fetchTimeoutMs,
    commandTimeoutMs: options.commandTimeoutMs,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatReport(report));
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_RAILWAY_SERVICE,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  HOSTED_WINDOWS,
  RUNTIME_KEYS,
  parseArgs,
  parsePositiveInteger,
  parseGhVariableList,
  parseHtmlSignals,
  centsToDollars,
  fetchWithTimeout,
  buildDiagnosis,
  formatReport,
  buildRailwayAuditSnippet,
  getHostedAuditViaHttp,
  generateRevenueStatusReport,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}
