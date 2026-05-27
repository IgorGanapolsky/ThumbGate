'use strict';

const STAGE_ORDER = [
  'landing',
  'pricing',
  'checkout_viewed',
  'email_submitted',
  'stripe_redirect',
  'purchase',
];

function parseTimestamp(row) {
  const raw = row && (row.timestamp || row.receivedAt || row.ts);
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function pickText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function extractSessionId(row) {
  return pickText(
    row.sessionId,
    row.visitorSessionId,
    row.visitor_session_id,
    row.attribution && row.attribution.sessionId,
    row.metadata && row.metadata.sessionId,
    row.stripeSessionId,
    row.traceId,
    row.acquisitionId,
  );
}

function extractVisitorId(row) {
  return pickText(
    row.visitorId,
    row.visitor_id,
    row.installId,
    row.attribution && row.attribution.visitorId,
    row.metadata && row.metadata.visitorId,
  );
}

function extractPath(row) {
  return pickText(
    row.path,
    row.page,
    row.landingPath,
    row.landing_path,
    row.attribution && row.attribution.landingPath,
  );
}

function classifyStage(row) {
  const event = String(row.eventType || row.event || '').toLowerCase();
  const stage = String(row.stage || '').toLowerCase();
  const path = extractPath(row).toLowerCase();
  const cta = String(row.ctaId || row.cta_id || '').toLowerCase();

  if (/purchase|paid|checkout\.session\.completed/.test(event) || stage === 'purchase') return 'purchase';
  if (/stripe_redirect|stripe redirect|redirect started/.test(event) || stage === 'stripe_redirect') return 'stripe_redirect';
  if (/email_submitted|email submitted|checkout_interstitial_cta_clicked/.test(event)) return 'email_submitted';
  if (/checkout/.test(path) || /checkout.*view|checkout pro viewed/.test(event)) return 'checkout_viewed';
  if (/pricing/.test(path) || /pricing/.test(cta) || /pricing_cta/.test(event)) return 'pricing';
  if (/landing|page_view|landing_page_view|discovery/.test(event) || stage === 'discovery') return 'landing';
  return null;
}

function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? -1 : index;
}

function nextMissingStage(maxStage) {
  const index = stageRank(maxStage);
  if (index < 0) return 'unknown';
  if (maxStage === 'purchase') return 'converted';
  return STAGE_ORDER[index + 1] || 'unknown';
}

function buildVisitorJourneySummary({ telemetryRows = [], funnelRows = [], limit = 100 } = {}) {
  const sessions = new Map();
  const stageCounts = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, 0]));

  function ingest(row, source) {
    const ts = parseTimestamp(row);
    if (ts == null) return;
    const sessionId = extractSessionId(row) || `anonymous:${extractVisitorId(row) || ts}`;
    const visitorId = extractVisitorId(row) || null;
    const stage = classifyStage(row);
    const path = extractPath(row);
    const existing = sessions.get(sessionId) || {
      sessionId,
      visitorId,
      firstSeen: new Date(ts).toISOString(),
      lastSeen: new Date(ts).toISOString(),
      maxStage: null,
      dropoffStage: 'unknown',
      events: [],
      paths: [],
      ctas: [],
      sources: [],
      visitorType: row.visitorType || null,
      utm: {},
      referrerHost: pickText(row.referrerHost, row.referrer_host, row.referrer),
    };

    existing.visitorId = existing.visitorId || visitorId;
    existing.firstSeen = new Date(Math.min(Date.parse(existing.firstSeen), ts)).toISOString();
    existing.lastSeen = new Date(Math.max(Date.parse(existing.lastSeen), ts)).toISOString();
    existing.sources.push(source);
    if (stage) {
      stageCounts[stage] += 1;
      if (stageRank(stage) > stageRank(existing.maxStage)) existing.maxStage = stage;
    }
    if (path && !existing.paths.includes(path)) existing.paths.push(path);
    const cta = pickText(row.ctaId, row.cta_id);
    if (cta && !existing.ctas.includes(cta)) existing.ctas.push(cta);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = pickText(row[key], row.attribution && row.attribution[key]);
      if (value && !existing.utm[key]) existing.utm[key] = value;
    }
    existing.events.push({
      timestamp: new Date(ts).toISOString(),
      source,
      eventType: pickText(row.eventType, row.event, row.stage, 'unknown'),
      stage,
      path: path || null,
      ctaId: cta || null,
    });
    sessions.set(sessionId, existing);
  }

  for (const row of telemetryRows) ingest(row, 'telemetry');
  for (const row of funnelRows) ingest(row, 'funnel');

  const journeys = [...sessions.values()].map((session) => {
    session.sources = [...new Set(session.sources)];
    session.events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    session.maxStage = session.maxStage || 'unknown';
    session.dropoffStage = nextMissingStage(session.maxStage);
    session.eventCount = session.events.length;
    return session;
  }).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));

  const dropoffCounts = {};
  for (const journey of journeys) {
    dropoffCounts[journey.dropoffStage] = (dropoffCounts[journey.dropoffStage] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionCount: journeys.length,
    stageCounts,
    dropoffCounts,
    journeys: journeys.slice(0, Math.max(1, Math.min(Number(limit) || 100, 500))),
    truncated: journeys.length > Math.max(1, Math.min(Number(limit) || 100, 500)),
  };
}

module.exports = {
  STAGE_ORDER,
  buildVisitorJourneySummary,
  classifyStage,
  extractSessionId,
  extractVisitorId,
};
