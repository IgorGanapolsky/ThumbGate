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

function safeRate(num, den) {
  if (!den) return 0;
  return Number((num / den).toFixed(4));
}

function isMarketingClickEvent(eventType) {
  return MARKETING_CLICK_EVENT_TYPES.has(String(eventType || '').toLowerCase());
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
    pricingInterest: pickFirstText(raw.pricingInterest, raw.interestLevel),
    seoQuery: pickFirstText(raw.seoQuery, raw.query),
    seoSurface: pickFirstText(raw.seoSurface, raw.searchSurface, raw.surface),
    trafficChannel: inferTrafficChannel(raw, referrerHost),
    failureCode: pickFirstText(raw.failureCode),
    httpStatus: normalizeInteger(raw.httpStatus),
    userAgent: pickFirstText(raw.userAgent, headers['user-agent']),
    attributionTagged: Boolean(
      pickFirstText(raw.utmSource, raw.utmMedium, raw.utmCampaign, raw.utmContent, raw.utmTerm)
    ),
  };

  return entry;
}

function appendTelemetryEvent(feedbackDir, payload = {}, headers = {}) {
  const entry = sanitizeTelemetryPayload(payload, headers);
  const telemetryPath = getTelemetryPath(feedbackDir);
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  fs.appendFileSync(telemetryPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  return entry;
}

function loadTelemetryEventsFromPath(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
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

function loadTelemetryEvents(feedbackDir) {
  const diagnostics = getTelemetrySourceDiagnostics(feedbackDir);
  const merged = [];
  const seen = new Set();

  for (const filePath of diagnostics.activePaths) {
    const rows = loadTelemetryEventsFromPath(filePath);
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
    }));
}

function getTelemetrySummary(feedbackDir, options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  const events = filterEntriesForWindow(
    loadTelemetryEvents(feedbackDir),
    analyticsWindow,
    (entry) => entry && (entry.receivedAt || entry.timestamp)
  );
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
  const cliByPlatform = {};
  const cliByVersion = {};
  let pageViews = 0;
  let ctaClicks = 0;
  let checkoutStarts = 0;
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
  let webEvents = 0;
  let webEventsWithVisitorId = 0;
  let webEventsWithSessionId = 0;
  let webEventsWithAcquisitionId = 0;
  let attributedPageViews = 0;
  let attributedCheckoutStarts = 0;
  let latestSeenAt = null;

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
      }

      if ((entry.eventType || entry.event) === 'checkout_start' || (entry.eventType || entry.event) === 'checkout_bootstrap') {
        checkoutStarts += 1;
        incrementCounter(checkoutStartsBySource, entry.source);
        incrementCounter(checkoutStartsByCampaign, entry.utmCampaign);
        incrementCounter(checkoutStartsByTrafficChannel, entry.trafficChannel);
        incrementCounter(checkoutStartsByCreator, entry.creator);
        incrementCounter(checkoutStartsByCommunity, entry.community);
        incrementCounter(checkoutStartsByOfferCode, entry.offerCode);
        incrementCounter(checkoutStartsByCampaignVariant, entry.campaignVariant);
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
  const installCopies = byEventType.install_copy || 0;
  const gptOpens = (byEventType.chatgpt_gpt_open || 0) + (byEventType.chatgpt_gpt_click || 0);
  const trialEmails = byEventType.trial_email_captured || 0;
  const proConversions = checkoutPaidConfirmations;

  return {
    window: serializeAnalyticsWindow(analyticsWindow),
    totalEvents: events.length,
    latestSeenAt,
    byClientType,
    byEventType,
    conversionFunnel: {
      landingViews: pageViews,
      installCopies,
      gptOpens,
      checkoutStarts,
      trialEmails,
      proConversions,
      landingToInstallCopyRate: safeRate(installCopies, pageViews),
      landingToGptOpenRate: safeRate(gptOpens, pageViews),
      landingToCheckoutRate: safeRate(checkoutStarts, pageViews),
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
      pageViewToCheckoutRate: safeRate(checkoutStarts, pageViews),
      visitorToCheckoutRate: safeRate(checkoutStarts, webVisitors.size),
      visitorIdCoverageRate: safeRate(webEventsWithVisitorId, webEvents),
      sessionIdCoverageRate: safeRate(webEventsWithSessionId, webEvents),
      acquisitionIdCoverageRate: safeRate(webEventsWithAcquisitionId, webEvents),
      attributedPageViews,
      attributedCheckoutStarts,
      attributionCoverageRate: safeRate(attributedPageViews, pageViews),
    },
    cli: {
      uniqueInstalls: cliInstalls.size,
      initPings: byEventType.cli_init || 0,
      byPlatform: cliByPlatform,
      byVersion: cliByVersion,
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
      checkoutConversionBySource,
      checkoutConversionByCampaign,
      checkoutConversionByTrafficChannel,
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

  return {
    window: summary.window,
    totalEvents: summary.totalEvents,
    latestSeenAt: summary.latestSeenAt,
    byClientType: summary.byClientType,
    byEventType: summary.byEventType,
    conversionFunnel: summary.conversionFunnel,
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
      uniqueCheckoutStarters: summary.web.uniqueCheckoutStarters,
      checkoutFailures: summary.web.checkoutFailures,
      checkoutCancelled: summary.web.checkoutCancelled,
      checkoutAbandoned: summary.web.checkoutAbandoned,
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
      cancellationRate: safeRate(summary.web.checkoutCancelled, summary.web.checkoutStarts),
      abandonmentRate: safeRate(summary.web.checkoutAbandoned, summary.web.checkoutStarts),
      paidConfirmationRate: safeRate(summary.web.checkoutPaidConfirmations, summary.web.checkoutStarts),
      successPageViewRate: safeRate(summary.web.checkoutSuccessPageViews, summary.web.checkoutStarts),
      conversionByTrafficChannel: summary.marketing.checkoutConversionByTrafficChannel,
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
    cli: summary.cli,
    recent: summary.recent,
  };
}

const appendTelemetryPing = appendTelemetryEvent;

module.exports = {
  TELEMETRY_FILE_NAME,
  sanitizeTelemetryPayload,
  appendTelemetryPing,
  appendTelemetryEvent,
  getTelemetrySourceDiagnostics,
  loadTelemetryEvents,
  getTelemetryAnalytics,
  inferTrafficChannel,
};
