#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  DEFAULT_PUBLIC_APP_ORIGIN,
} = require('./hosted-config');

const DEFAULT_REPO = 'IgorGanapolsky/ThumbGate';
const DEFAULT_RAILWAY_SERVICE = 'rlhf-feedback-loop';
const HOSTED_WINDOWS = ['today', '30d', 'lifetime'];
const RUNTIME_KEYS = [
  'RLHF_FEEDBACK_DIR',
  'RLHF_API_KEY',
  'RLHF_PUBLIC_APP_ORIGIN',
  'RLHF_BILLING_API_BASE_URL',
  'RLHF_GA_MEASUREMENT_ID',
  'RLHF_CHECKOUT_FALLBACK_URL',
  'STRIPE_SECRET_KEY',
];

function parseArgs(argv = []) {
  const options = {
    json: false,
    repo: process.env.RLHF_GITHUB_REPO || DEFAULT_REPO,
    timeZone: process.env.TZ || 'America/New_York',
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
    }
  }

  return options;
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
    plausibleScript: body.includes('/js/analytics.js'),
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

function windowSnapshot(summary = {}) {
  return {
    trafficMetrics: summary.trafficMetrics || {},
    signups: summary.signups || {},
    revenue: summary.revenue || {},
    pipeline: summary.pipeline || {},
    dataQuality: summary.dataQuality || {},
  };
}

function buildDiagnosis({ publicProbe, hostedAudit }) {
  const today = hostedAudit && hostedAudit.summaries ? hostedAudit.summaries.today : null;
  const trailing30 = hostedAudit && hostedAudit.summaries ? hostedAudit.summaries['30d'] : null;
  const runtimePresence = hostedAudit ? hostedAudit.runtimePresence : {};
  const traffic30 = trailing30 && trailing30.trafficMetrics ? trailing30.trafficMetrics : {};
  const revenue30 = trailing30 && trailing30.revenue ? trailing30.revenue : {};

  const trackingImplemented = Boolean(
    publicProbe &&
    publicProbe.root &&
    publicProbe.root.signals &&
    publicProbe.root.signals.telemetryEndpoint &&
    publicProbe.root.signals.plausibleScript
  );
  const telemetryIngressWorking = Boolean(publicProbe && publicProbe.telemetryPing && publicProbe.telemetryPing.status === 204);
  const hostedSummaryWorking = Boolean(today && today.status === 200 && trailing30 && trailing30.status === 200);
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
  if (!runtimePresence.RLHF_GA_MEASUREMENT_ID) {
    gaps.push('GA4 runtime env is missing in Railway');
  }
  if (!runtimePresence.RLHF_PUBLIC_APP_ORIGIN) {
    gaps.push('RLHF_PUBLIC_APP_ORIGIN is not explicitly set in Railway runtime');
  }
  if (!runtimePresence.RLHF_BILLING_API_BASE_URL) {
    gaps.push('RLHF_BILLING_API_BASE_URL is not explicitly set in Railway runtime');
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

function formatReport(report) {
  const lines = [];
  lines.push(`Revenue Status @ ${report.generatedAt}`);
  lines.push(`Source: ${report.source}`);
  lines.push(`Primary issue: ${report.diagnosis.primaryIssue}`);
  lines.push(`Tracking implemented: ${report.diagnosis.trackingImplemented ? 'yes' : 'no'}`);
  lines.push(`Telemetry ingress working: ${report.diagnosis.telemetryIngressWorking ? 'yes' : 'no'}`);
  lines.push(`Hosted summary working: ${report.diagnosis.hostedSummaryWorking ? 'yes' : 'no'}`);
  lines.push(`Hosted traffic observed: ${report.diagnosis.hostedTrafficObserved ? 'yes' : 'no'}`);
  lines.push(`Hosted revenue observed: ${report.diagnosis.hostedRevenueObserved ? 'yes' : 'no'}`);
  lines.push('');
  lines.push(`Public health: ${report.publicProbe.health.status} (${report.publicProbe.health.version || 'unknown version'})`);
  lines.push(`Telemetry ping probe: ${report.publicProbe.telemetryPing.status}`);
  lines.push(`Runtime flags: ${RUNTIME_KEYS.map((key) => `${key}=${report.hostedAudit.runtimePresence[key] ? 'set' : 'missing'}`).join(', ')}`);
  lines.push('');
  lines.push(...formatWindowBlock('Today', report.hostedAudit.summaries.today));
  lines.push(...formatWindowBlock('30d', report.hostedAudit.summaries['30d']));
  lines.push(...formatWindowBlock('Lifetime', report.hostedAudit.summaries.lifetime));
  lines.push('');
  lines.push(`30d attribution coverage: ${formatRatio(report.hostedAudit.summaries['30d'].dataQuality.attributionCoverage)}`);
  lines.push(`30d telemetry coverage: ${formatRatio(report.hostedAudit.summaries['30d'].dataQuality.telemetryCoverage)}`);

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

function getRepoVariables({ repo = DEFAULT_REPO, runCommandFn = runCommand } = {}) {
  const stdout = requireCommandSuccess(
    'gh variable list',
    runCommandFn('gh', ['variable', 'list', '-R', repo])
  );
  return parseGhVariableList(stdout);
}

async function probePublicRuntime(appOrigin) {
  const healthUrl = new URL('/health', appOrigin);
  const rootUrl = new URL('/', appOrigin);
  const telemetryUrl = new URL('/v1/telemetry/ping', appOrigin);

  const healthRes = await fetch(healthUrl);
  const healthJson = await healthRes.json();
  const rootRes = await fetch(rootUrl);
  const rootHtml = await rootRes.text();

  const probeId = crypto.randomUUID();
  const telemetryRes = await fetch(telemetryUrl, {
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
  });

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
      const runtimePresence = {};
      for (const key of ${JSON.stringify(RUNTIME_KEYS)}) {
        runtimePresence[key] = Boolean(process.env[key]);
      }

      const summaries = {};
      for (const window of ${JSON.stringify(HOSTED_WINDOWS)}) {
        const url = new URL('/v1/billing/summary', base);
        url.searchParams.set('window', window);
        url.searchParams.set('timezone', ${JSON.stringify(timeZone)});
        const response = await fetch(url, {
          headers: {
            authorization: 'Bearer ' + process.env.RLHF_API_KEY,
            accept: 'application/json',
          },
        });
        const payload = await response.json();
        summaries[window] = {
          status: response.status,
          trafficMetrics: payload.trafficMetrics || {},
          signups: payload.signups || {},
          revenue: payload.revenue || {},
          pipeline: payload.pipeline || {},
          dataQuality: payload.dataQuality || {},
        };
      }

      console.log(JSON.stringify({ runtimePresence, summaries }, null, 2));
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
    ])
  );
  return JSON.parse(stdout);
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
} = {}) {
  let repoVars = {};
  let repoVarError = null;
  try {
    repoVars = getRepoVariables({ repo, runCommandFn });
  } catch (error) {
    repoVarError = error;
  }

  const appOrigin = repoVars.RLHF_PUBLIC_APP_ORIGIN || DEFAULT_PUBLIC_APP_ORIGIN;
  const publicProbe = await fetchPublicProbe(appOrigin);

  try {
    if (!repoVars.RAILWAY_PROJECT_ID || !repoVars.RAILWAY_ENVIRONMENT_ID) {
      throw repoVarError || new Error('GitHub repo variables for Railway are unavailable.');
    }

    const hostedAudit = getHostedAuditViaRailway({
      projectId: repoVars.RAILWAY_PROJECT_ID,
      environmentId: repoVars.RAILWAY_ENVIRONMENT_ID,
      service: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
      appOrigin: repoVars.RLHF_BILLING_API_BASE_URL || appOrigin,
      timeZone,
      runCommandFn,
    });

    return {
      generatedAt: new Date().toISOString(),
      repo,
      source: 'hosted-via-railway-env',
      repoVars: {
        RAILWAY_PROJECT_ID: Boolean(repoVars.RAILWAY_PROJECT_ID),
        RAILWAY_ENVIRONMENT_ID: Boolean(repoVars.RAILWAY_ENVIRONMENT_ID),
        RAILWAY_SERVICE: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
        RLHF_PUBLIC_APP_ORIGIN: appOrigin,
        RLHF_BILLING_API_BASE_URL: repoVars.RLHF_BILLING_API_BASE_URL || appOrigin,
      },
      publicProbe,
      hostedAudit,
      diagnosis: buildDiagnosis({
        publicProbe,
        hostedAudit,
      }),
    };
  } catch (error) {
    const fallback = await getLocalFallback(timeZone);
    return {
      generatedAt: new Date().toISOString(),
      repo,
      source: 'local-fallback',
      repoVars: {
        RAILWAY_PROJECT_ID: Boolean(repoVars.RAILWAY_PROJECT_ID),
        RAILWAY_ENVIRONMENT_ID: Boolean(repoVars.RAILWAY_ENVIRONMENT_ID),
        RAILWAY_SERVICE: repoVars.RAILWAY_SERVICE || DEFAULT_RAILWAY_SERVICE,
        RLHF_PUBLIC_APP_ORIGIN: appOrigin,
        RLHF_BILLING_API_BASE_URL: repoVars.RLHF_BILLING_API_BASE_URL || appOrigin,
      },
      publicProbe,
      hostedAudit: {
        runtimePresence: {},
        summaries: {
          today: windowSnapshot(fallback.summary),
          '30d': windowSnapshot(),
          lifetime: windowSnapshot(),
        },
        error: error.message,
      },
      diagnosis: {
        trackingImplemented: Boolean(publicProbe.root && publicProbe.root.signals && publicProbe.root.signals.telemetryEndpoint),
        telemetryIngressWorking: Boolean(publicProbe.telemetryPing && publicProbe.telemetryPing.status === 204),
        hostedSummaryWorking: false,
        hostedTrafficObserved: false,
        hostedRevenueObserved: false,
        primaryIssue: 'hosted_summary_access_or_config_gap',
        gaps: [repoVarError && repoVarError.message, error.message, fallback.fallbackReason].filter(Boolean),
      },
    };
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await generateRevenueStatusReport({
    repo: options.repo,
    timeZone: options.timeZone,
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
  HOSTED_WINDOWS,
  RUNTIME_KEYS,
  parseArgs,
  parseGhVariableList,
  parseHtmlSignals,
  centsToDollars,
  buildDiagnosis,
  formatReport,
  buildRailwayAuditSnippet,
  generateRevenueStatusReport,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
