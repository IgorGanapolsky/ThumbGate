#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  filterEntriesForWindow,
  resolveAnalyticsWindow,
  serializeAnalyticsWindow,
} = require('./analytics-window');
const {
  getLegacyFeedbackDir,
  getFallbackFeedbackDir,
  resolveFallbackArtifactPath,
} = require('./feedback-paths');

const TELEMETRY_FILE_NAME = 'telemetry-pings.jsonl';
const MARKETING_CLICK_EVENT_TYPES = new Set([
  'cta_click',
  'checkout_start',
  'checkout_bootstrap',
  'diagnostic_checkout_confirmed',
  'checkout_interstitial_cta_clicked',
  'chatgpt_gpt_open',
  'chatgpt_gpt_click',
  'install_guide_click',
  'install_click',
  'pro_page_click',
  'pro_checkout_start',
  'workflow_sprint_intake_click',
  'demo_click',
  'github_repo_click',
  'community_landing_redirect',
]);
const CHECKOUT_START_EVENT_TYPES = new Set([
  'checkout_start',
  'checkout_bootstrap',
  // A diagnostic buyer has submitted a valid receipt email and the server is
  // issuing the external Payment Link redirect. This is stronger than a CTA
  // click and is the service equivalent of the Pro checkout bootstrap.
  'diagnostic_checkout_confirmed',
]);

function shouldIncludeLegacyTelemetry() {
  if (
    process.env._TEST_LEGACY_FEEDBACK_DIR ||
    process.env.THUMBGATE_LEGACY_FEEDBACK_DIR ||
    process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR ||
    process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR
  ) {
    return true;
  }
  return process.env.NODE_ENV !== 'test';
}

function shouldMergeLegacyTelemetry() {
  return process.env._TEST_INCLUDE_LEGACY_TELEMETRY === '1'
    || process.env.THUMBGATE_INCLUDE_LEGACY_TELEMETRY === '1';
}

function normalizeText(value, maxLength = 160) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function incrementCounter(counter, key, amount = 1) {
  const resolvedKey = normalizeText(key) || 'unknown';
  counter[resolvedKey] = (counter[resolvedKey] || 0) + amount;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeRate(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(parsed, 1));
}

function safeRate(num, den) {
  if (!den) return 0;
  return Number((num / den).toFixed(4));
}

function isMarketingClickEvent(eventType) {
  return MARKETING_CLICK_EVENT_TYPES.has(String(eventType || '').toLowerCase());
}

function isCheckoutStartEvent(eventType) {
  return CHECKOUT_START_EVENT_TYPES.has(String(eventType || '').toLowerCase());
}

function getTelemetryPath(feedbackDir) {
  return path.join(feedbackDir, TELEMETRY_FILE_NAME);
}

function getLegacyTelemetryPath(feedbackDir) {
  const resolvedFallbackPath = resolveFallbackArtifactPath(TELEMETRY_FILE_NAME, {
    feedbackDir,
  });
  if (!resolvedFallbackPath) return null;
  const resolvedFeedbackDir = path.resolve(feedbackDir || '.');
  if (path.resolve(path.dirname(resolvedFallbackPath)) === resolvedFeedbackDir) {
    return null;
  }
  return resolvedFallbackPath;
}

function buildSourceWarning(code, message) {
  return { code, message };
}

function getTelemetrySourceDiagnostics(feedbackDir) {
  const primaryPath = getTelemetryPath(feedbackDir);
  const legacyPath = shouldIncludeLegacyTelemetry() ? getLegacyTelemetryPath(feedbackDir) : null;
  const primaryExists = fs.existsSync(primaryPath);
  const legacyExists = Boolean(legacyPath && fs.existsSync(legacyPath));
  const activePaths = [];
  const warnings = [];
  let activeMode = 'missing';

  if (primaryExists && legacyExists && shouldMergeLegacyTelemetry()) {
    activePaths.push(primaryPath, legacyPath);
    activeMode = 'merged';
    warnings.push(buildSourceWarning(
      'telemetry_mixed_roots',
      'Telemetry exists in both the active and legacy feedback directories; analytics merged both sources.'
    ));
  } else if (primaryExists) {
    activePaths.push(primaryPath);
    activeMode = 'primary';
  } else if (legacyExists) {
    activePaths.push(legacyPath);
    activeMode = 'legacy_fallback';
    warnings.push(buildSourceWarning(
      'telemetry_legacy_fallback',
      'Telemetry exists only in the legacy feedback directory; analytics fell back to legacy telemetry.'
    ));
  } else {
    warnings.push(buildSourceWarning(
      'telemetry_missing',
      'Telemetry is missing from both the active and legacy feedback directories.'
    ));
  }

  return {
    fileName: TELEMETRY_FILE_NAME,
    primaryPath,
    legacyPath,
    fallbackPath: path.join(getFallbackFeedbackDir({ feedbackDir }), TELEMETRY_FILE_NAME),
    legacyFeedbackPath: path.join(getLegacyFeedbackDir({ feedbackDir }), TELEMETRY_FILE_NAME),
    primaryExists,
    legacyExists,
    activeMode,
    activePaths,
    mixedRoots: activeMode === 'merged',
    warnings,
  };
}

function inferClientType(payload) {
  const explicit = pickFirstText(payload.clientType, payload.client, payload.origin);
  if (explicit) return explicit.toLowerCase();
  if (pickFirstText(payload.page, payload.landingPath, payload.ctaId, payload.visitorId, payload.sessionId)) {
    return 'web';
  }
  if (pickFirstText(payload.platform, payload.nodeVersion, payload.installId)) {
    return 'cli';
  }
  return 'unknown';
}

function inferEventType(payload, clientType) {
  const explicit = pickFirstText(payload.eventType, payload.event, payload.kind);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (normalized === 'checkout_cta_clicked') return 'checkout_start';
    if (normalized === 'cli_ping') return 'cli_init';
    return normalized;
  }
  if (clientType === 'web' && pickFirstText(payload.ctaId)) return 'checkout_start';
  if (clientType === 'web') return 'landing_page_view';
  if (clientType === 'cli') return 'cli_init';
  return 'ping';
}

function parseReferrerHost(referrer) {
  if (!referrer) return null;
  try {
    return new URL(referrer).host || null;
  } catch {
    return null;
  }
}

function normalizeHostToken(value) {
  const text = normalizeText(value, 255);
  return text ? text.toLowerCase() : null;
}

function inferTrafficChannel(raw = {}, referrerHost = null) {
  const source = normalizeHostToken(raw.source || raw.utmSource);
  const medium = normalizeHostToken(raw.utmMedium);
  const seoSurface = normalizeHostToken(raw.seoSurface || raw.searchSurface || raw.surface);
  const host = normalizeHostToken(referrerHost);

  if (source === 'producthunt') return 'producthunt';
  if (source === 'reddit') return 'reddit';
  if (medium === 'creator_partnership') return 'creator';
  if (source === 'ai_search' || seoSurface === 'ai_search') return 'ai_search';
  if (source === 'organic_search' || seoSurface === 'organic_search') return 'organic_search';
  if (source === 'direct') return 'direct';
  if (source === 'website' && !host) return 'direct';
  if (medium === 'listing' && source === 'producthunt') return 'producthunt';
  if (medium === 'organic') return 'organic_search';

  const aiHosts = [
    'perplexity.ai',
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'gemini.google.com',
  ];
  if (host && aiHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return 'ai_search';
  }

  const productHuntHosts = [
    'producthunt.com',
    'www.producthunt.com',
  ];
  if (host && productHuntHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return 'producthunt';
  }

  const redditHosts = [
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'np.reddit.com',
    'out.reddit.com',
    'redd.it',
  ];
  if (host && redditHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return 'reddit';
  }

  const searchHosts = [
    'google.com',
    'bing.com',
    'duckduckgo.com',
    'search.yahoo.com',
    'search.brave.com',
    'ecosia.org',
  ];
  if (host && searchHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return 'organic_search';
  }

  if (!host) return 'direct';
  return 'referral';
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const text = normalizeText(value, 32);
  if (!text) return false;
  return ['1', 'true', 'yes', 'y', 'bot'].includes(text.toLowerCase());
}

function includesAnyToken(values, tokens) {
  const haystack = values
    .map((value) => normalizeText(value, 512))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!haystack) return false;
  return tokens.some((token) => haystack.includes(token));
}

function addAudienceReason(reasons, code) {
  if (!reasons.includes(code)) reasons.push(code);
}

function classifyTelemetryAudience(entry = {}, raw = {}) {
  const reasons = [];
  const identityValues = [
    raw.email,
    raw.customerEmail,
    raw.buyerEmail,
    raw.userEmail,
    entry.visitorId,
    entry.sessionId,
    entry.traceId,
    entry.acquisitionId,
    entry.installId,
  ];
  const attributionValues = [
    entry.source,
    entry.utmSource,
    entry.utmMedium,
    entry.utmCampaign,
    entry.utmContent,
    entry.creator,
    entry.offerCode,
    entry.campaignVariant,
    entry.referrerHost,
  ];
  const eventValues = [
    entry.eventType,
    entry.event,
    entry.page,
    entry.landingPath,
    entry.ctaId,
    entry.reasonCode,
    entry.reasonDetail,
  ];
  const userAgent = normalizeText(entry.userAgent || raw.userAgent, 512) || '';
  const hostValues = [raw.host, raw.hostname, raw.origin, raw.url, raw.pageUrl, entry.referrerHost];

  if (normalizeBoolean(entry.isBot || raw.isBot) || includesAnyToken([userAgent], [
    'bot',
    'crawler',
    'spider',
    'headless',
    'playwright',
    'puppeteer',
    'curl/',
    'wget/',
    'lighthouse',
  ])) {
    addAudienceReason(reasons, 'bot_or_automation_user_agent');
  }

  if (includesAnyToken(identityValues, [
    '@example.com',
    'buyer@example.com',
    'test@example.com',
    'codex-verification',
    'audit@thumbgate.ai',
  ])) {
    addAudienceReason(reasons, 'test_identity');
  }

  if (includesAnyToken([...attributionValues, ...eventValues], [
    'codex',
    'audit',
    'verification',
    'synthetic',
    'smoke',
    'probe',
    'test',
  ])) {
    addAudienceReason(reasons, 'test_or_audit_attribution');
  }

  if (includesAnyToken(hostValues, [
    'localhost',
    '127.0.0.1',
    '::1',
    'thumbgate-production.up.railway.app',
  ])) {
    addAudienceReason(reasons, 'internal_host');
  }

  if (includesAnyToken([userAgent, ...identityValues], [
    'codex',
    'github-actions',
    'node-fetch',
    'thumbgate-analytics',
    'thumbgate-verification',
  ])) {
    addAudienceReason(reasons, 'internal_operator_or_ci');
  }

  if (
    (entry.clientType || entry.client) === 'unknown' &&
    !pickFirstText(entry.visitorId, entry.sessionId, entry.acquisitionId, entry.installId, entry.traceId) &&
    !userAgent &&
    includesAnyToken([entry.source, entry.utmSource], ['direct', 'website'])
  ) {
    addAudienceReason(reasons, 'unknown_direct_no_identity');
  }

  const audience = reasons.includes('test_identity') || reasons.includes('test_or_audit_attribution')
    ? 'test'
    : (reasons.includes('bot_or_automation_user_agent')
      ? 'bot'
      : (
        reasons.includes('internal_host') ||
        reasons.includes('internal_operator_or_ci') ||
        reasons.includes('unknown_direct_no_identity')
          ? 'internal'
          : 'external'
      ));

  return {
    audience,
    reasons,
    isExternal: audience === 'external',
    isInternal: audience === 'internal',
    isTest: audience === 'test',
    isBot: audience === 'bot',
  };
}

function sanitizeTelemetryPayload(payload = {}, headers = {}) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const clientType = inferClientType(raw);
  const eventType = inferEventType(raw, clientType);
  const source = pickFirstText(raw.source, raw.utmSource, clientType === 'cli' ? 'cli' : 'direct');
  const utmSource = pickFirstText(raw.utmSource, raw.source, clientType === 'web' ? source : null);
  const utmMedium = pickFirstText(raw.utmMedium, clientType === 'web' ? 'landing_page' : clientType);
  const utmCampaign = pickFirstText(raw.utmCampaign, raw.campaign, clientType === 'web' ? 'organic' : null);
  const referrer = pickFirstText(raw.referrer, headers.referer, headers.referrer);
  const referrerHost = parseReferrerHost(referrer);
  const reasonCode = pickFirstText(
    raw.reasonCode,
    raw.reason,
    raw.cancelReason,
    raw.lossReason,
    raw.abandonReason
  );
  const entry = {
    receivedAt: new Date().toISOString(),
    client: clientType,
    clientType,
    event: eventType,
    eventType,
    installId: pickFirstText(raw.installId),
    visitorId: pickFirstText(raw.visitorId),
    sessionId: pickFirstText(raw.sessionId),
    traceId: pickFirstText(raw.traceId),
    acquisitionId: pickFirstText(raw.acquisitionId),
    version: pickFirstText(raw.version, raw.appVersion),
    platform: pickFirstText(raw.platform),
    nodeVersion: pickFirstText(raw.nodeVersion),
    page: pickFirstText(raw.page, raw.landingPath, raw.path),
    landingPath: pickFirstText(raw.landingPath, raw.page, raw.path),
    pageType: pickFirstText(raw.pageType),
    contentPillar: pickFirstText(raw.contentPillar, raw.pillar),
    primaryQuery: pickFirstText(raw.primaryQuery, raw.query),
    referrer,
    referrerHost,
    source,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent: pickFirstText(raw.utmContent),
    utmTerm: pickFirstText(raw.utmTerm),
    creator: pickFirstText(raw.creator, raw.creatorHandle, raw.creator_handle),
    campaignVariant: pickFirstText(raw.campaignVariant, raw.variant),
    offerCode: pickFirstText(raw.offerCode, raw.offer, raw.coupon),
    community: pickFirstText(raw.community, raw.subreddit),
    postId: pickFirstText(raw.postId, raw.post_id),
    commentId: pickFirstText(raw.commentId, raw.comment_id),
    ctaId: pickFirstText(raw.ctaId),
    ctaPlacement: pickFirstText(raw.ctaPlacement),
    planId: pickFirstText(raw.planId),
    linkSlug: pickFirstText(raw.linkSlug, raw.destinationSlug),
    destinationPath: pickFirstText(raw.destinationPath),
    pipelineStatus: pickFirstText(raw.pipelineStatus, raw.workflowSprintStatus, raw.status),
    reasonCode,
    reasonDetail: pickFirstText(raw.reasonDetail, raw.reasonText, raw.otherReason, raw.notes),
    integration: pickFirstText(raw.integration, raw.actionIntegration),
    actionOperation: pickFirstText(raw.actionOperation, raw.operationId),
    endpoint: pickFirstText(raw.endpoint, raw.apiPath),
    decisionMode: pickFirstText(raw.decisionMode, raw.executionMode),
    actionStatus: pickFirstText(raw.actionStatus, raw.status),
    accepted: raw.accepted === undefined || raw.accepted === null ? null : Boolean(raw.accepted),
    pricingInterest: pickFirstText(raw.pricingInterest, raw.interestLevel),
    seoQuery: pickFirstText(raw.seoQuery, raw.query),
    seoSurface: pickFirstText(raw.seoSurface, raw.searchSurface, raw.surface),
    sectionId: pickFirstText(raw.sectionId, raw.section),
    sectionLabel: pickFirstText(raw.sectionLabel),
    lastVisibleSection: pickFirstText(raw.lastVisibleSection, raw.visibleSection),
    dwellBucket: pickFirstText(raw.dwellBucket, raw.engagementBucket),
    scrollBucket: pickFirstText(raw.scrollBucket),
    engagementMs: normalizeInteger(raw.engagementMs),
    maxScrollPercent: normalizeInteger(raw.maxScrollPercent ?? raw.scrollPercent),
    buyerEmailFocused: Boolean(raw.buyerEmailFocused),
    buyerEmailCaptured: Boolean(raw.buyerEmailCaptured),
    checkoutIntentClassification: pickFirstText(raw.checkoutIntentClassification),
    trafficChannel: inferTrafficChannel(raw, referrerHost),
    failureCode: pickFirstText(raw.failureCode),
    httpStatus: normalizeInteger(raw.httpStatus),
    userAgent: pickFirstText(raw.userAgent, headers['user-agent']),
    isBot: pickFirstText(raw.isBot),
    interstitialSampled: pickFirstText(raw.interstitialSampled),
    interstitialSampleRate: normalizeRate(raw.interstitialSampleRate),
    attributionTagged: Boolean(
      pickFirstText(raw.utmSource, raw.utmMedium, raw.utmCampaign, raw.utmContent, raw.utmTerm)
    ),
  };

  const audience = classifyTelemetryAudience(entry, raw);
  entry.audience = audience.audience;
  entry.trafficAudience = audience.audience;
  entry.audienceReasons = audience.reasons;
  entry.isExternal = audience.isExternal;
  entry.isInternal = audience.isInternal;
  entry.isTest = audience.isTest;
  entry.isBotTraffic = audience.isBot;

  return entry;
}

function appendTelemetryEvent(feedbackDir, payload = {}, headers = {}) {
  const entry = sanitizeTelemetryPayload(payload, headers);
  const telemetryPath = getTelemetryPath(feedbackDir);
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  fs.appendFileSync(telemetryPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  return entry;
}

const DEFAULT_BOUNDED_TELEMETRY_TAIL_BYTES = 8 * 1024 * 1024;

function readTelemetryText(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return '';
  const maxBytes = Number(options.maxBytes || 0);
  if (maxBytes > 0) {
    const stats = fs.statSync(filePath);
    if (stats.size > maxBytes) {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        fs.readSync(fd, buffer, 0, maxBytes, stats.size - maxBytes);
        const text = buffer.toString('utf-8');
        const firstNewline = text.indexOf('\n');
        return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
      } finally {
        fs.closeSync(fd);
      }
    }
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function loadTelemetryEventsFromPath(filePath, options = {}) {
  const raw = readTelemetryText(filePath, options).trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        const normalized = sanitizeTelemetryPayload(parsed);
        return {
          ...normalized,
          receivedAt: pickFirstText(parsed.receivedAt, parsed.timestamp) || normalized.receivedAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadTelemetryEvents(feedbackDir, options = {}) {
  const diagnostics = getTelemetrySourceDiagnostics(feedbackDir);
  const merged = [];
  const seen = new Set();

  for (const filePath of diagnostics.activePaths) {
    const rows = loadTelemetryEventsFromPath(filePath, options);
    for (const row of rows) {
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }

  return merged;
}

function summarizeRecentEvents(events) {
  return events
    .slice(-5)
    .reverse()
    .map((entry) => ({
      receivedAt: entry.receivedAt || null,
      clientType: entry.clientType || null,
      eventType: entry.eventType || null,
      source: entry.source || null,
      utmCampaign: entry.utmCampaign || null,
      ctaId: entry.ctaId || null,
      page: entry.page || null,
      linkSlug: entry.linkSlug || null,
      reasonCode: entry.reasonCode || null,
      creator: entry.creator || null,
      community: entry.community || null,
      offerCode: entry.offerCode || null,
      campaignVariant: entry.campaignVariant || null,
      audience: entry.audience || 'external',
      audienceReasons: entry.audienceReasons || [],
    }));
}

function summarizeExternalTrafficQuality(events) {
  const byAudience = {};
  const byExclusionReason = {};
  const externalVisitors = new Set();
  const externalSessions = new Set();
  const externalCheckoutStarters = new Set();
  const pageViewsBySource = {};
  const pageViewsByPath = {};
  const pageViewsByTrafficChannel = {};
  const checkoutStartsBySource = {};
  const checkoutStartsByTrafficChannel = {};
  const buyerLossReasons = {};
  const visitorPaths = new Map();
  let externalEvents = 0;
  let excludedEvents = 0;
  let externalWebEvents = 0;
  let externalPageViews = 0;
  let externalCtaClicks = 0;
  let externalCheckoutStarts = 0;
  let externalBuyerLossSignals = 0;

  for (const entry of events) {
    const audience = entry.audience || 'external';
    incrementCounter(byAudience, audience);
    if (audience !== 'external') {
      excludedEvents += 1;
      const reasons = Array.isArray(entry.audienceReasons) && entry.audienceReasons.length > 0
        ? entry.audienceReasons
        : [`${audience}_traffic`];
      for (const reason of reasons) incrementCounter(byExclusionReason, reason);
      continue;
    }

    externalEvents += 1;
    if ((entry.clientType || entry.client) !== 'web') continue;

    externalWebEvents += 1;
    const visitorKey = pickFirstText(entry.visitorId, entry.installId, entry.sessionId);
    if (visitorKey) externalVisitors.add(visitorKey);
    if (entry.sessionId) externalSessions.add(entry.sessionId);

    const eventType = entry.eventType || entry.event;
    if (visitorKey) {
      const pathRow = visitorPaths.get(visitorKey) || {
        visitorKey,
        firstSeenAt: entry.receivedAt || null,
        lastSeenAt: entry.receivedAt || null,
        source: entry.source || null,
        trafficChannel: entry.trafficChannel || null,
        events: [],
        pages: [],
        checkoutStarts: 0,
      };
      if (!pathRow.firstSeenAt || String(entry.receivedAt || '') < pathRow.firstSeenAt) {
        pathRow.firstSeenAt = entry.receivedAt || null;
      }
      if (!pathRow.lastSeenAt || String(entry.receivedAt || '') > pathRow.lastSeenAt) {
        pathRow.lastSeenAt = entry.receivedAt || null;
      }
      pathRow.events.push({
        at: entry.receivedAt || null,
        eventType,
        page: entry.page || entry.landingPath || null,
        ctaId: entry.ctaId || null,
      });
      if ((entry.page || entry.landingPath) && !pathRow.pages.includes(entry.page || entry.landingPath)) {
        pathRow.pages.push(entry.page || entry.landingPath);
      }
      if (isCheckoutStartEvent(eventType)) {
        pathRow.checkoutStarts += 1;
      }
      visitorPaths.set(visitorKey, pathRow);
    }

    if (eventType === 'landing_page_view') {
      externalPageViews += 1;
      incrementCounter(pageViewsBySource, entry.source);
      incrementCounter(pageViewsByPath, entry.page);
      incrementCounter(pageViewsByTrafficChannel, entry.trafficChannel);
    }

    if (isMarketingClickEvent(eventType)) {
      externalCtaClicks += 1;
    }

    if (isCheckoutStartEvent(eventType)) {
      externalCheckoutStarts += 1;
      incrementCounter(checkoutStartsBySource, entry.source);
      incrementCounter(checkoutStartsByTrafficChannel, entry.trafficChannel);
      const starterKey = pickFirstText(
        entry.acquisitionId,
        entry.visitorId,
        entry.sessionId,
        entry.installId,
        entry.traceId
      );
      if (starterKey) externalCheckoutStarters.add(starterKey);
    }

    if (eventType === 'checkout_cancelled' || eventType === 'checkout_abandoned' || eventType === 'reason_not_buying') {
      externalBuyerLossSignals += 1;
      incrementCounter(buyerLossReasons, entry.reasonCode);
    }
  }

  const topPath = getTopCounterEntry(pageViewsByPath);
  const topSource = getTopCounterEntry(pageViewsBySource);
  const topTrafficChannel = getTopCounterEntry(pageViewsByTrafficChannel);
  const topExclusionReason = getTopCounterEntry(byExclusionReason);

  return {
    rawEvents: events.length,
    externalEvents,
    excludedEvents,
    internalEvents: byAudience.internal || 0,
    testEvents: byAudience.test || 0,
    botEvents: byAudience.bot || 0,
    exclusionRate: safeRate(excludedEvents, events.length),
    byAudience,
    byExclusionReason,
    topExclusionReason: topExclusionReason ? { key: topExclusionReason[0], count: topExclusionReason[1] } : null,
    external: {
      totalEvents: externalWebEvents,
      uniqueVisitors: externalVisitors.size,
      uniqueSessions: externalSessions.size,
      uniqueCheckoutStarters: externalCheckoutStarters.size,
      pageViews: externalPageViews,
      ctaClicks: externalCtaClicks,
      checkoutStarts: externalCheckoutStarts,
      buyerLossSignals: externalBuyerLossSignals,
      pageViewToCheckoutRate: safeRate(externalCheckoutStarts, externalPageViews),
      visitorToCheckoutRate: safeRate(externalCheckoutStarts, externalVisitors.size),
      bySource: pageViewsBySource,
      byPath: pageViewsByPath,
      byTrafficChannel: pageViewsByTrafficChannel,
      checkoutStartsBySource,
      checkoutStartsByTrafficChannel,
      buyerLossReasons,
      topSource: topSource ? { key: topSource[0], count: topSource[1] } : null,
      topPath: topPath ? { key: topPath[0], count: topPath[1] } : null,
      topTrafficChannel: topTrafficChannel ? { key: topTrafficChannel[0], count: topTrafficChannel[1] } : null,
      visitorPaths: Array.from(visitorPaths.values())
        .sort((a, b) => String(a.firstSeenAt || '').localeCompare(String(b.firstSeenAt || '')))
        .slice(0, 50),
    },
    verdict: externalEvents > 0
      ? (excludedEvents > externalEvents ? 'polluted_but_usable' : 'usable')
      : (events.length > 0 ? 'polluted_no_external_signal' : 'missing'),
  };
}

function getTelemetrySummary(feedbackDir, options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  const telemetryLoadOptions = analyticsWindow.bounded
    ? { maxBytes: Number(options.telemetryTailBytes || DEFAULT_BOUNDED_TELEMETRY_TAIL_BYTES) }
    : {};
  const events = filterEntriesForWindow(
    loadTelemetryEvents(feedbackDir, telemetryLoadOptions),
    analyticsWindow,
    (entry) => entry && (entry.receivedAt || entry.timestamp)
  );
  const trafficQuality = summarizeExternalTrafficQuality(events);
  const byClientType = {};
  const byEventType = {};
  const webVisitors = new Set();
  const webSessions = new Set();
  const webCheckoutStarters = new Set();
  const cliInstalls = new Set();
  const pageViewsBySource = {};
  const pageViewsByCampaign = {};
  const pageViewsByPath = {};
  const pageViewsByTrafficChannel = {};
  const pageViewsByCreator = {};
  const pageViewsByCommunity = {};
  const pageViewsByOfferCode = {};
  const pageViewsByCampaignVariant = {};
  const ctaClicksBySource = {};
  const ctaClicksByCampaign = {};
  const ctaClicksByTrafficChannel = {};
  const ctaClicksByCreator = {};
  const ctaClicksByCommunity = {};
  const ctaClicksByOfferCode = {};
  const ctaClicksByCampaignVariant = {};
  const checkoutStartsBySource = {};
  const checkoutStartsByCampaign = {};
  const checkoutStartsByTrafficChannel = {};
  const checkoutStartsByCreator = {};
  const checkoutStartsByCommunity = {};
  const checkoutStartsByOfferCode = {};
  const checkoutStartsByCampaignVariant = {};
  const byCtaId = {};
  const byReferrerHost = {};
  const checkoutFailuresByCode = {};
  const checkoutFailuresByStatus = {};
  const sessionLookupFailuresByCode = {};
  const sessionLookupFailuresByStatus = {};
  const cancellationsByReason = {};
  const abandonmentsByReason = {};
  const buyerLossReasons = {};
  const pricingInterestByLevel = {};
  const seoLandingViewsBySurface = {};
  const seoLandingViewsByQuery = {};
  const trackedLinkHitsBySlug = {};
  const trackedLinkCheckoutStartsBySlug = {};
  const sectionViewsById = {};
  const pageExitsByLastVisibleSection = {};
  const pageExitsByDwellBucket = {};
  const pageExitsByScrollBucket = {};
  const ctaImpressionsById = {};
  const ctaImpressionsByPlacement = {};
  const cliByPlatform = {};
  const cliByVersion = {};
  let pageViews = 0;
  let ctaClicks = 0;
  let ctaImpressions = 0;
  let checkoutStarts = 0;
  let diagnosticCheckoutStarts = 0;
  let checkoutInterstitialViews = 0;
  let checkoutBotDeflections = 0;
  let checkoutInterstitialClicks = 0;
  let checkoutInterstitialProConfirms = 0;
  let checkoutInterstitialWorkflowIntakeClicks = 0;
  let checkoutInterstitialTeamPathClicks = 0;
  let checkoutInterstitialDiagnosticCheckoutClicks = 0;
  let checkoutInterstitialWorkflowSprintCheckoutClicks = 0;
  let checkoutFailures = 0;
  let checkoutCancelled = 0;
  let checkoutAbandoned = 0;
  let checkoutSuccessPageViews = 0;
  let checkoutCancelPageViews = 0;
  let checkoutPaidConfirmations = 0;
  let checkoutPending = 0;
  let checkoutLookupFailures = 0;
  let buyerLossSignals = 0;
  let pricingInterestEvents = 0;
  let seoLandingViews = 0;
  let pageExitEvents = 0;
  let emailFocusEvents = 0;
  let emailAbandonEvents = 0;
  let webEvents = 0;
  let webEventsWithVisitorId = 0;
  let webEventsWithSessionId = 0;
  let webEventsWithAcquisitionId = 0;
  let attributedPageViews = 0;
  let attributedCheckoutStarts = 0;
  let latestSeenAt = null;
  let exitEngagementMsTotal = 0;
  let exitEngagementMsCount = 0;
  let exitScrollPercentTotal = 0;
  let exitScrollPercentCount = 0;
  let chatgptActionCalls = 0;
  let chatgptActionAccepted = 0;
  const chatgptActionsByOperation = {};
  const chatgptActionsByEndpoint = {};
  const chatgptActionsByStatus = {};
  const chatgptActionsByDecisionMode = {};

  for (const entry of events) {
    incrementCounter(byClientType, entry.clientType || entry.client || 'unknown');
    incrementCounter(byEventType, entry.eventType || entry.event || 'unknown');
    if (!latestSeenAt || String(entry.receivedAt || '') > latestSeenAt) {
      latestSeenAt = entry.receivedAt || null;
    }

    if ((entry.clientType || entry.client) === 'web') {
      webEvents += 1;
      const visitorKey = pickFirstText(entry.visitorId, entry.installId, entry.sessionId);
      if (visitorKey) webVisitors.add(visitorKey);
      if (entry.sessionId) webSessions.add(entry.sessionId);
      if (entry.visitorId) webEventsWithVisitorId += 1;
      if (entry.sessionId) webEventsWithSessionId += 1;
      if (entry.acquisitionId) webEventsWithAcquisitionId += 1;
      if (entry.referrerHost) incrementCounter(byReferrerHost, entry.referrerHost);

      if ((entry.eventType || entry.event) === 'landing_page_view') {
        pageViews += 1;
        incrementCounter(pageViewsBySource, entry.source);
        incrementCounter(pageViewsByCampaign, entry.utmCampaign);
        incrementCounter(pageViewsByPath, entry.page);
        incrementCounter(pageViewsByTrafficChannel, entry.trafficChannel);
        incrementCounter(pageViewsByCreator, entry.creator);
        incrementCounter(pageViewsByCommunity, entry.community);
        incrementCounter(pageViewsByOfferCode, entry.offerCode);
        incrementCounter(pageViewsByCampaignVariant, entry.campaignVariant);
        if (entry.attributionTagged) attributedPageViews += 1;
      }

      if (isMarketingClickEvent(entry.eventType || entry.event)) {
        ctaClicks += 1;
        incrementCounter(ctaClicksBySource, entry.source);
        incrementCounter(ctaClicksByCampaign, entry.utmCampaign);
        incrementCounter(ctaClicksByTrafficChannel, entry.trafficChannel);
        incrementCounter(ctaClicksByCreator, entry.creator);
        incrementCounter(ctaClicksByCommunity, entry.community);
        incrementCounter(ctaClicksByOfferCode, entry.offerCode);
        incrementCounter(ctaClicksByCampaignVariant, entry.campaignVariant);
        incrementCounter(byCtaId, entry.ctaId);
        if (entry.linkSlug && (entry.eventType || entry.event) === 'cta_click') {
          incrementCounter(trackedLinkHitsBySlug, entry.linkSlug);
        }
      }

      if ((entry.eventType || entry.event) === 'checkout_interstitial_view') {
        checkoutInterstitialViews += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_bot_deflected') {
        checkoutBotDeflections += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_interstitial_cta_clicked') {
        checkoutInterstitialClicks += 1;
        if (entry.ctaId === 'pro_checkout_confirmed') {
          checkoutInterstitialProConfirms += 1;
        } else if (entry.ctaId === 'workflow_sprint_intake') {
          checkoutInterstitialWorkflowIntakeClicks += 1;
        } else if (entry.ctaId === 'team_paid_path') {
          checkoutInterstitialTeamPathClicks += 1;
        } else if (entry.ctaId === 'sprint_diagnostic_checkout') {
          checkoutInterstitialDiagnosticCheckoutClicks += 1;
        } else if (entry.ctaId === 'workflow_sprint_checkout') {
          checkoutInterstitialWorkflowSprintCheckoutClicks += 1;
        }
      }

      if (isCheckoutStartEvent(entry.eventType || entry.event)) {
        checkoutStarts += 1;
        if ((entry.eventType || entry.event) === 'diagnostic_checkout_confirmed') {
          diagnosticCheckoutStarts += 1;
        }
        incrementCounter(checkoutStartsBySource, entry.source);
        incrementCounter(checkoutStartsByCampaign, entry.utmCampaign);
        incrementCounter(checkoutStartsByTrafficChannel, entry.trafficChannel);
        incrementCounter(checkoutStartsByCreator, entry.creator);
        incrementCounter(checkoutStartsByCommunity, entry.community);
        incrementCounter(checkoutStartsByOfferCode, entry.offerCode);
        incrementCounter(checkoutStartsByCampaignVariant, entry.campaignVariant);
        if (entry.linkSlug) incrementCounter(trackedLinkCheckoutStartsBySlug, entry.linkSlug);
        const starterKey = pickFirstText(
          entry.acquisitionId,
          entry.visitorId,
          entry.sessionId,
          entry.installId,
          entry.traceId
        );
        if (starterKey) webCheckoutStarters.add(starterKey);
        if (entry.attributionTagged) attributedCheckoutStarts += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_api_failed') {
        checkoutFailures += 1;
        incrementCounter(checkoutFailuresByCode, entry.failureCode);
        incrementCounter(
          checkoutFailuresByStatus,
          entry.httpStatus === null ? null : String(entry.httpStatus)
        );
      }

      if ((entry.eventType || entry.event) === 'checkout_success_page_view') {
        checkoutSuccessPageViews += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_cancel_page_view') {
        checkoutCancelPageViews += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_paid_confirmed') {
        checkoutPaidConfirmations += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_session_pending') {
        checkoutPending += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_session_lookup_failed') {
        checkoutLookupFailures += 1;
        incrementCounter(sessionLookupFailuresByCode, entry.failureCode);
        incrementCounter(
          sessionLookupFailuresByStatus,
          entry.httpStatus === null ? null : String(entry.httpStatus)
        );
      }

      if ((entry.eventType || entry.event) === 'checkout_cancelled') {
        checkoutCancelled += 1;
        incrementCounter(cancellationsByReason, entry.reasonCode);
        incrementCounter(buyerLossReasons, entry.reasonCode);
        buyerLossSignals += 1;
      }

      if ((entry.eventType || entry.event) === 'checkout_abandoned') {
        checkoutAbandoned += 1;
        incrementCounter(abandonmentsByReason, entry.reasonCode);
        incrementCounter(buyerLossReasons, entry.reasonCode);
        buyerLossSignals += 1;
      }

      if ((entry.eventType || entry.event) === 'reason_not_buying') {
        incrementCounter(buyerLossReasons, entry.reasonCode);
        buyerLossSignals += 1;
      }

      if ((entry.eventType || entry.event) === 'section_view') {
        incrementCounter(sectionViewsById, entry.sectionId);
      }

      if ((entry.eventType || entry.event) === 'cta_impression') {
        ctaImpressions += 1;
        incrementCounter(ctaImpressionsById, entry.ctaId);
        incrementCounter(ctaImpressionsByPlacement, entry.ctaPlacement);
      }

      if ((entry.eventType || entry.event) === 'page_exit') {
        pageExitEvents += 1;
        incrementCounter(pageExitsByLastVisibleSection, entry.lastVisibleSection);
        incrementCounter(pageExitsByDwellBucket, entry.dwellBucket);
        incrementCounter(pageExitsByScrollBucket, entry.scrollBucket);
        if (entry.engagementMs !== null) {
          exitEngagementMsTotal += entry.engagementMs;
          exitEngagementMsCount += 1;
        }
        if (entry.maxScrollPercent !== null) {
          exitScrollPercentTotal += entry.maxScrollPercent;
          exitScrollPercentCount += 1;
        }
      }

      if ((entry.eventType || entry.event) === 'buyer_email_focus') {
        emailFocusEvents += 1;
      }

      if ((entry.eventType || entry.event) === 'buyer_email_abandon') {
        emailAbandonEvents += 1;
      }

      if ((entry.eventType || entry.event) === 'pricing_interest') {
        pricingInterestEvents += 1;
        incrementCounter(pricingInterestByLevel, entry.pricingInterest);
      }

      if ((entry.eventType || entry.event) === 'seo_landing_view') {
        seoLandingViews += 1;
        incrementCounter(seoLandingViewsBySurface, entry.seoSurface);
        incrementCounter(seoLandingViewsByQuery, entry.seoQuery);
      }
    }

    if (
      String(entry.eventType || entry.event || '').startsWith('chatgpt_action_') ||
      entry.integration === 'chatgpt_gpt'
    ) {
      chatgptActionCalls += 1;
      if (entry.accepted === true) chatgptActionAccepted += 1;
      incrementCounter(chatgptActionsByOperation, entry.actionOperation);
      incrementCounter(chatgptActionsByEndpoint, entry.endpoint);
      incrementCounter(chatgptActionsByStatus, entry.actionStatus);
      incrementCounter(chatgptActionsByDecisionMode, entry.decisionMode);
    }

    if ((entry.clientType || entry.client) === 'cli') {
      if (entry.installId) cliInstalls.add(entry.installId);
      incrementCounter(cliByPlatform, entry.platform);
      incrementCounter(cliByVersion, entry.version);
    }
  }

  const checkoutConversionBySource = {};
  for (const sourceKey of new Set([...Object.keys(pageViewsBySource), ...Object.keys(checkoutStartsBySource)])) {
    checkoutConversionBySource[sourceKey] = safeRate(
      checkoutStartsBySource[sourceKey] || 0,
      pageViewsBySource[sourceKey] || 0
    );
  }

  const checkoutConversionByCampaign = {};
  for (const campaignKey of new Set([...Object.keys(pageViewsByCampaign), ...Object.keys(checkoutStartsByCampaign)])) {
    checkoutConversionByCampaign[campaignKey] = safeRate(
      checkoutStartsByCampaign[campaignKey] || 0,
      pageViewsByCampaign[campaignKey] || 0
    );
  }

  const checkoutConversionByTrafficChannel = {};
  for (const channelKey of new Set([...Object.keys(pageViewsByTrafficChannel), ...Object.keys(checkoutStartsByTrafficChannel)])) {
    checkoutConversionByTrafficChannel[channelKey] = safeRate(
      checkoutStartsByTrafficChannel[channelKey] || 0,
      pageViewsByTrafficChannel[channelKey] || 0
    );
  }

  const trackedLinkConversionBySlug = {};
  for (const slugKey of new Set([
    ...Object.keys(trackedLinkHitsBySlug),
    ...Object.keys(trackedLinkCheckoutStartsBySlug),
  ])) {
    trackedLinkConversionBySlug[slugKey] = safeRate(
      trackedLinkCheckoutStartsBySlug[slugKey] || 0,
      trackedLinkHitsBySlug[slugKey] || 0
    );
  }
  const installCopies = byEventType.install_copy || 0;
  const gptOpens = (byEventType.chatgpt_gpt_open || 0) + (byEventType.chatgpt_gpt_click || 0);
  const trialEmails = byEventType.trial_email_captured || 0;
  const proConversions = checkoutPaidConfirmations;

  return {
    window: serializeAnalyticsWindow(analyticsWindow),
    totalEvents: events.length,
    latestSeenAt,
    trafficQuality,
    byClientType,
    byEventType,
    conversionFunnel: {
      landingViews: pageViews,
      installCopies,
      gptOpens,
      gptActionCalls: chatgptActionCalls,
      checkoutStarts,
      diagnosticCheckoutStarts,
      checkoutInterstitialViews,
      checkoutInterstitialClicks,
      trialEmails,
      proConversions,
      landingToInstallCopyRate: safeRate(installCopies, pageViews),
      landingToGptOpenRate: safeRate(gptOpens, pageViews),
      gptOpenToActionRate: safeRate(chatgptActionCalls, gptOpens),
      landingToCheckoutRate: safeRate(checkoutStarts, pageViews),
      checkoutInterstitialClickRate: safeRate(checkoutInterstitialClicks, checkoutInterstitialViews),
      checkoutInterstitialProConfirmRate: safeRate(checkoutInterstitialProConfirms, checkoutInterstitialViews),
      checkoutToTrialEmailRate: safeRate(trialEmails, checkoutStarts),
      checkoutToProConversionRate: safeRate(proConversions, checkoutStarts),
    },
    web: {
      totalEvents: webEvents,
      uniqueVisitors: webVisitors.size,
      uniqueSessions: webSessions.size,
      uniqueCheckoutStarters: webCheckoutStarters.size,
      pageViews,
      ctaClicks,
      checkoutStarts,
      diagnosticCheckoutStarts,
      checkoutInterstitialViews,
      checkoutBotDeflections,
      checkoutInterstitialClicks,
      checkoutInterstitialProConfirms,
      checkoutInterstitialWorkflowIntakeClicks,
      checkoutInterstitialTeamPathClicks,
      checkoutInterstitialDiagnosticCheckoutClicks,
      checkoutInterstitialWorkflowSprintCheckoutClicks,
      checkoutFailures,
      checkoutCancelled,
      checkoutAbandoned,
      checkoutSuccessPageViews,
      checkoutCancelPageViews,
      checkoutPaidConfirmations,
      checkoutPending,
      checkoutLookupFailures,
      buyerLossSignals,
      pricingInterestEvents,
      seoLandingViews,
      ctaImpressions,
      pageExitEvents,
      emailFocusEvents,
      emailAbandonEvents,
      pageViewToCheckoutRate: safeRate(checkoutStarts, pageViews),
      visitorToCheckoutRate: safeRate(checkoutStarts, webVisitors.size),
      visitorIdCoverageRate: safeRate(webEventsWithVisitorId, webEvents),
      sessionIdCoverageRate: safeRate(webEventsWithSessionId, webEvents),
      acquisitionIdCoverageRate: safeRate(webEventsWithAcquisitionId, webEvents),
      attributedPageViews,
      attributedCheckoutStarts,
      attributionCoverageRate: safeRate(attributedPageViews, pageViews),
      averageExitEngagementMs: exitEngagementMsCount > 0
        ? Math.round(exitEngagementMsTotal / exitEngagementMsCount)
        : 0,
      averageExitScrollPercent: exitScrollPercentCount > 0
        ? Math.round(exitScrollPercentTotal / exitScrollPercentCount)
        : 0,
    },
    cli: {
      uniqueInstalls: cliInstalls.size,
      initPings: byEventType.cli_init || 0,
      byPlatform: cliByPlatform,
      byVersion: cliByVersion,
    },
    chatgpt: {
      gptOpens,
      actionCalls: chatgptActionCalls,
      acceptedActionCalls: chatgptActionAccepted,
      openToActionRate: safeRate(chatgptActionCalls, gptOpens),
      acceptedActionRate: safeRate(chatgptActionAccepted, chatgptActionCalls),
      byOperation: chatgptActionsByOperation,
      byEndpoint: chatgptActionsByEndpoint,
      byStatus: chatgptActionsByStatus,
      byDecisionMode: chatgptActionsByDecisionMode,
    },
    marketing: {
      pageViewsBySource,
      pageViewsByCampaign,
      pageViewsByPath,
      pageViewsByTrafficChannel,
      pageViewsByCreator,
      pageViewsByCommunity,
      pageViewsByOfferCode,
      pageViewsByCampaignVariant,
      ctaClicksBySource,
      ctaClicksByCampaign,
      ctaClicksByTrafficChannel,
      ctaClicksByCreator,
      ctaClicksByCommunity,
      ctaClicksByOfferCode,
      ctaClicksByCampaignVariant,
      checkoutStartsBySource,
      checkoutStartsByCampaign,
      checkoutStartsByTrafficChannel,
      checkoutStartsByCreator,
      checkoutStartsByCommunity,
      checkoutStartsByOfferCode,
      checkoutStartsByCampaignVariant,
      byCtaId,
      byReferrerHost,
      checkoutFailuresByCode,
      checkoutFailuresByStatus,
      sessionLookupFailuresByCode,
      sessionLookupFailuresByStatus,
      cancellationsByReason,
      abandonmentsByReason,
      buyerLossReasons,
      pricingInterestByLevel,
      seoLandingViewsBySurface,
      seoLandingViewsByQuery,
      sectionViewsById,
      pageExitsByLastVisibleSection,
      pageExitsByDwellBucket,
      pageExitsByScrollBucket,
      ctaImpressionsById,
      ctaImpressionsByPlacement,
      checkoutConversionBySource,
      checkoutConversionByCampaign,
      checkoutConversionByTrafficChannel,
      trackedLinkHitsBySlug,
      trackedLinkCheckoutStartsBySlug,
      trackedLinkConversionBySlug,
    },
    recent: summarizeRecentEvents(events),
  };
}

function getTopCounterEntry(counter) {
  return Object.entries(counter || {})
    .sort((a, b) => b[1] - a[1])[0] || null;
}

function getTelemetryAnalytics(feedbackDir, options = {}) {
  const summary = getTelemetrySummary(feedbackDir, options);
  const topSource = getTopCounterEntry(summary.marketing.pageViewsBySource);
  const topCampaign = getTopCounterEntry(summary.marketing.pageViewsByCampaign);
  const topCta = getTopCounterEntry(summary.marketing.byCtaId);
  const topReferrerHost = getTopCounterEntry(summary.marketing.byReferrerHost);
  const topPath = getTopCounterEntry(summary.marketing.pageViewsByPath);
  const topTrafficChannel = getTopCounterEntry(summary.marketing.pageViewsByTrafficChannel);
  const topCreator = getTopCounterEntry(summary.marketing.pageViewsByCreator);
  const topCommunity = getTopCounterEntry(summary.marketing.pageViewsByCommunity);
  const topOfferCode = getTopCounterEntry(summary.marketing.pageViewsByOfferCode);
  const topCampaignVariant = getTopCounterEntry(summary.marketing.pageViewsByCampaignVariant);
  const topBuyerLossReason = getTopCounterEntry(summary.marketing.buyerLossReasons);
  const topSeoSurface = getTopCounterEntry(summary.marketing.seoLandingViewsBySurface);
  const topSeoQuery = getTopCounterEntry(summary.marketing.seoLandingViewsByQuery);
  const topViewedSection = getTopCounterEntry(summary.marketing.sectionViewsById);
  const topExitSection = getTopCounterEntry(summary.marketing.pageExitsByLastVisibleSection);
  const topExitDwellBucket = getTopCounterEntry(summary.marketing.pageExitsByDwellBucket);
  const topImpressionCta = getTopCounterEntry(summary.marketing.ctaImpressionsById);
  const impressionToClickRateById = {};
  for (const ctaId of new Set([
    ...Object.keys(summary.marketing.ctaImpressionsById || {}),
    ...Object.keys(summary.marketing.byCtaId || {}),
  ])) {
    impressionToClickRateById[ctaId] = safeRate(
      (summary.marketing.byCtaId || {})[ctaId] || 0,
      (summary.marketing.ctaImpressionsById || {})[ctaId] || 0
    );
  }

  return {
    window: summary.window,
    totalEvents: summary.totalEvents,
    latestSeenAt: summary.latestSeenAt,
    trafficQuality: summary.trafficQuality,
    qualified: summary.trafficQuality.external,
    byClientType: summary.byClientType,
    byEventType: summary.byEventType,
    conversionFunnel: summary.conversionFunnel,
    chatgpt: summary.chatgpt,
    visitors: {
      totalEvents: summary.web.totalEvents,
      uniqueVisitors: summary.web.uniqueVisitors,
      uniqueSessions: summary.web.uniqueSessions,
      pageViews: summary.web.pageViews,
      attributedPageViews: summary.web.attributedPageViews,
      attributionCoverageRate: summary.web.attributionCoverageRate,
      visitorIdCoverageRate: summary.web.visitorIdCoverageRate,
      sessionIdCoverageRate: summary.web.sessionIdCoverageRate,
      acquisitionIdCoverageRate: summary.web.acquisitionIdCoverageRate,
      bySource: summary.marketing.pageViewsBySource,
      byCampaign: summary.marketing.pageViewsByCampaign,
      byPath: summary.marketing.pageViewsByPath,
      byTrafficChannel: summary.marketing.pageViewsByTrafficChannel,
      byCreator: summary.marketing.pageViewsByCreator,
      byCommunity: summary.marketing.pageViewsByCommunity,
      byOfferCode: summary.marketing.pageViewsByOfferCode,
      byCampaignVariant: summary.marketing.pageViewsByCampaignVariant,
      byReferrerHost: summary.marketing.byReferrerHost,
      topSource: topSource ? { key: topSource[0], count: topSource[1] } : null,
      topCampaign: topCampaign ? { key: topCampaign[0], count: topCampaign[1] } : null,
      topPath: topPath ? { key: topPath[0], count: topPath[1] } : null,
      topTrafficChannel: topTrafficChannel ? { key: topTrafficChannel[0], count: topTrafficChannel[1] } : null,
      topCreator: topCreator ? { key: topCreator[0], count: topCreator[1] } : null,
      topCommunity: topCommunity ? { key: topCommunity[0], count: topCommunity[1] } : null,
      topOfferCode: topOfferCode ? { key: topOfferCode[0], count: topOfferCode[1] } : null,
      topCampaignVariant: topCampaignVariant ? { key: topCampaignVariant[0], count: topCampaignVariant[1] } : null,
      topReferrerHost: topReferrerHost ? { key: topReferrerHost[0], count: topReferrerHost[1] } : null,
    },
    ctas: {
      totalClicks: summary.web.ctaClicks,
      checkoutStarts: summary.web.checkoutStarts,
      diagnosticCheckoutStarts: summary.web.diagnosticCheckoutStarts,
      checkoutInterstitialViews: summary.web.checkoutInterstitialViews,
      checkoutBotDeflections: summary.web.checkoutBotDeflections,
      checkoutInterstitialClicks: summary.web.checkoutInterstitialClicks,
      checkoutInterstitialProConfirms: summary.web.checkoutInterstitialProConfirms,
      checkoutInterstitialWorkflowIntakeClicks: summary.web.checkoutInterstitialWorkflowIntakeClicks,
      checkoutInterstitialTeamPathClicks: summary.web.checkoutInterstitialTeamPathClicks,
      checkoutInterstitialDiagnosticCheckoutClicks: summary.web.checkoutInterstitialDiagnosticCheckoutClicks,
      checkoutInterstitialWorkflowSprintCheckoutClicks: summary.web.checkoutInterstitialWorkflowSprintCheckoutClicks,
      uniqueCheckoutStarters: summary.web.uniqueCheckoutStarters,
      checkoutFailures: summary.web.checkoutFailures,
      checkoutCancelled: summary.web.checkoutCancelled,
      checkoutAbandoned: summary.web.checkoutAbandoned,
      ctaImpressions: summary.web.ctaImpressions,
      successPageViews: summary.web.checkoutSuccessPageViews,
      cancelPageViews: summary.web.checkoutCancelPageViews,
      paidConfirmations: summary.web.checkoutPaidConfirmations,
      sessionPending: summary.web.checkoutPending,
      lookupFailures: summary.web.checkoutLookupFailures,
      failuresByCode: summary.marketing.checkoutFailuresByCode,
      failuresByStatus: summary.marketing.checkoutFailuresByStatus,
      lookupFailuresByCode: summary.marketing.sessionLookupFailuresByCode,
      lookupFailuresByStatus: summary.marketing.sessionLookupFailuresByStatus,
      cancellationReasons: summary.marketing.cancellationsByReason,
      abandonmentReasons: summary.marketing.abandonmentsByReason,
      bySource: summary.marketing.ctaClicksBySource,
      byCampaign: summary.marketing.ctaClicksByCampaign,
      byTrafficChannel: summary.marketing.ctaClicksByTrafficChannel,
      byCreator: summary.marketing.ctaClicksByCreator,
      byCommunity: summary.marketing.ctaClicksByCommunity,
      byOfferCode: summary.marketing.ctaClicksByOfferCode,
      byCampaignVariant: summary.marketing.ctaClicksByCampaignVariant,
      checkoutStartsBySource: summary.marketing.checkoutStartsBySource,
      checkoutStartsByCampaign: summary.marketing.checkoutStartsByCampaign,
      checkoutStartsByTrafficChannel: summary.marketing.checkoutStartsByTrafficChannel,
      checkoutStartsByCreator: summary.marketing.checkoutStartsByCreator,
      checkoutStartsByCommunity: summary.marketing.checkoutStartsByCommunity,
      checkoutStartsByOfferCode: summary.marketing.checkoutStartsByOfferCode,
      checkoutStartsByCampaignVariant: summary.marketing.checkoutStartsByCampaignVariant,
      byId: summary.marketing.byCtaId,
      topCta: topCta ? { key: topCta[0], count: topCta[1] } : null,
      pageViewToCheckoutRate: summary.web.pageViewToCheckoutRate,
      visitorToCheckoutRate: summary.web.visitorToCheckoutRate,
      clickToCheckoutRate: safeRate(summary.web.checkoutStarts, summary.web.ctaClicks),
      checkoutInterstitialClickRate: safeRate(
        summary.web.checkoutInterstitialClicks,
        summary.web.checkoutInterstitialViews
      ),
      checkoutInterstitialProConfirmRate: safeRate(
        summary.web.checkoutInterstitialProConfirms,
        summary.web.checkoutInterstitialViews
      ),
      checkoutInterstitialWorkflowIntakeRate: safeRate(
        summary.web.checkoutInterstitialWorkflowIntakeClicks,
        summary.web.checkoutInterstitialViews
      ),
      checkoutInterstitialTeamPathRate: safeRate(
        summary.web.checkoutInterstitialTeamPathClicks,
        summary.web.checkoutInterstitialViews
      ),
      checkoutInterstitialDiagnosticCheckoutRate: safeRate(
        summary.web.checkoutInterstitialDiagnosticCheckoutClicks,
        summary.web.checkoutInterstitialViews
      ),
      checkoutInterstitialWorkflowSprintCheckoutRate: safeRate(
        summary.web.checkoutInterstitialWorkflowSprintCheckoutClicks,
        summary.web.checkoutInterstitialViews
      ),
      cancellationRate: safeRate(summary.web.checkoutCancelled, summary.web.checkoutStarts),
      abandonmentRate: safeRate(summary.web.checkoutAbandoned, summary.web.checkoutStarts),
      paidConfirmationRate: safeRate(summary.web.checkoutPaidConfirmations, summary.web.checkoutStarts),
      successPageViewRate: safeRate(summary.web.checkoutSuccessPageViews, summary.web.checkoutStarts),
      conversionByTrafficChannel: summary.marketing.checkoutConversionByTrafficChannel,
    },
    behavior: {
      sectionViewsById: summary.marketing.sectionViewsById,
      ctaImpressionsById: summary.marketing.ctaImpressionsById,
      ctaImpressionsByPlacement: summary.marketing.ctaImpressionsByPlacement,
      pageExits: summary.web.pageExitEvents,
      exitsByLastVisibleSection: summary.marketing.pageExitsByLastVisibleSection,
      exitsByDwellBucket: summary.marketing.pageExitsByDwellBucket,
      exitsByScrollBucket: summary.marketing.pageExitsByScrollBucket,
      emailFocusEvents: summary.web.emailFocusEvents,
      emailAbandonEvents: summary.web.emailAbandonEvents,
      emailAbandonRate: safeRate(summary.web.emailAbandonEvents, summary.web.emailFocusEvents),
      averageExitEngagementMs: summary.web.averageExitEngagementMs,
      averageExitScrollPercent: summary.web.averageExitScrollPercent,
      impressionToClickRateById,
      topViewedSection: topViewedSection ? { key: topViewedSection[0], count: topViewedSection[1] } : null,
      topExitSection: topExitSection ? { key: topExitSection[0], count: topExitSection[1] } : null,
      topExitDwellBucket: topExitDwellBucket ? { key: topExitDwellBucket[0], count: topExitDwellBucket[1] } : null,
      topImpressionCta: topImpressionCta ? { key: topImpressionCta[0], count: topImpressionCta[1] } : null,
    },
    buyerLoss: {
      totalSignals: summary.web.buyerLossSignals,
      reasonsByCode: summary.marketing.buyerLossReasons,
      cancellationReasons: summary.marketing.cancellationsByReason,
      abandonmentReasons: summary.marketing.abandonmentsByReason,
      topReason: topBuyerLossReason ? { key: topBuyerLossReason[0], count: topBuyerLossReason[1] } : null,
    },
    pricing: {
      pricingInterestEvents: summary.web.pricingInterestEvents,
      interestByLevel: summary.marketing.pricingInterestByLevel,
    },
    seo: {
      landingViews: summary.web.seoLandingViews,
      bySurface: summary.marketing.seoLandingViewsBySurface,
      byQuery: summary.marketing.seoLandingViewsByQuery,
      topSurface: topSeoSurface ? { key: topSeoSurface[0], count: topSeoSurface[1] } : null,
      topQuery: topSeoQuery ? { key: topSeoQuery[0], count: topSeoQuery[1] } : null,
    },
    trackedLinks: (() => {
      const hits = summary.marketing.trackedLinkHitsBySlug || {};
      const conversions = summary.marketing.trackedLinkCheckoutStartsBySlug || {};
      const conversionRate = summary.marketing.trackedLinkConversionBySlug || {};
      const totalHits = Object.values(hits).reduce((acc, n) => acc + n, 0);
      const totalCheckoutStarts = Object.values(conversions).reduce((acc, n) => acc + n, 0);
      const top = getTopCounterEntry(hits);
      const bySlug = {};
      for (const slug of new Set([...Object.keys(hits), ...Object.keys(conversions)])) {
        bySlug[slug] = {
          hits: hits[slug] || 0,
          checkoutStarts: conversions[slug] || 0,
          conversionRate: conversionRate[slug] || 0,
        };
      }
      return {
        totalHits,
        totalCheckoutStarts,
        overallConversionRate: safeRate(totalCheckoutStarts, totalHits),
        bySlug,
        topSlug: top ? { key: top[0], count: top[1] } : null,
      };
    })(),
    cli: summary.cli,
    recent: summary.recent,
  };
}

const appendTelemetryPing = appendTelemetryEvent;

module.exports = {
  TELEMETRY_FILE_NAME,
  sanitizeTelemetryPayload,
  classifyTelemetryAudience,
  appendTelemetryPing,
  appendTelemetryEvent,
  getTelemetrySourceDiagnostics,
  loadTelemetryEvents,
  getTelemetryAnalytics,
  inferTrafficChannel,
};
