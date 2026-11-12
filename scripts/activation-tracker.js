'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const { trackEvent, getInstallId, classifyInstall, INSTALL_ID_PATH } = require('./cli-telemetry');

const DEFAULT_API_HOST = 'https://thumbgate.ai';
const MARKER_DIR = path.join(path.dirname(INSTALL_ID_PATH), 'activation');
const MARKER_PATH = path.join(MARKER_DIR, 'first-rule-promoted.json');
const FIRST_BLOCK_MARKER_PATH = path.join(MARKER_DIR, 'first-blocked-call.json');
const ACTIVATION_RECORDED_PATH = path.join(path.dirname(INSTALL_ID_PATH), 'activation-recorded.json');
function readMarker() {
  try {
    if (!fs.existsSync(MARKER_PATH)) return null;
    return JSON.parse(fs.readFileSync(MARKER_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeMarker(record) {
  try {
    if (!fs.existsSync(MARKER_DIR)) fs.mkdirSync(MARKER_DIR, { recursive: true });
    fs.writeFileSync(MARKER_PATH, JSON.stringify(record, null, 2));
  } catch {
    
    
  }
}

function computeDaysSinceInstall() {
  try {
    if (!fs.existsSync(INSTALL_ID_PATH)) return null;
    const installed = fs.statSync(INSTALL_ID_PATH).mtimeMs;
    if (!Number.isFinite(installed) || installed <= 0) return null;
    const diffMs = Date.now() - installed;
    if (diffMs < 0) return 0;
    
    
    return Math.round((diffMs / 86_400_000) * 10) / 10;
  } catch {
    return null;
  }
}

function computeMinutesSinceInstall() {
  try {
    if (!fs.existsSync(INSTALL_ID_PATH)) return null;
    const installed = fs.statSync(INSTALL_ID_PATH).mtimeMs;
    if (!Number.isFinite(installed) || installed <= 0) return null;
    return Math.round((Math.max(0, Date.now() - installed) / 60_000) * 10) / 10;
  } catch { 
    return null;
  }
}

function writeFirstBlockMarker(data) {
  try {
    if (!fs.existsSync(MARKER_DIR)) fs.mkdirSync(MARKER_DIR, { recursive: true });
    fs.writeFileSync(FIRST_BLOCK_MARKER_PATH, JSON.stringify(data, null, 2));
  } catch {  }
}

function recordFirstRulePromotion(metadata = {}) {
  if (readMarker()) return false; 

  if (process.env.THUMBGATE_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1') {
    
    
    writeMarker({
      installId: getInstallId(),
      promotedAt: new Date().toISOString(),
      telemetryOptOut: true,
    });
    return false;
  }

  const installId = getInstallId();
  const daysToFirstRule = computeDaysSinceInstall();
  const visitorType = classifyInstall();

  writeMarker({
    installId,
    promotedAt: new Date().toISOString(),
    daysToFirstRule,
    visitorType,
    ...metadata,
  });

  trackEvent('activation_first_rule_promoted', {
    daysToFirstRule,
    visitorType,
    ...metadata,
  });
  return true;
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {  }
}

function resolveActivationAccountAuth(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || os.homedir();
  const operatorCfg = readJsonSafe(path.join(homeDir, '.config', 'thumbgate', 'operator.json'));
  const signedLic = readJsonSafe(path.join(homeDir, '.config', 'thumbgate', 'license.json'));
  const localLic = readJsonSafe(path.join(homeDir, '.thumbgate', 'license.json'));
  const candidates = [
    options.apiKey,
    env.THUMBGATE_API_KEY,
    env.THUMBGATE_PRO_KEY,
    env.THUMBGATE_LICENSE,
    signedLic && (signedLic.license || signedLic.token || signedLic.key),
    localLic && (localLic.key || localLic.license || localLic.token),
    env.THUMBGATE_OPERATOR_KEY,
    operatorCfg && operatorCfg.operatorKey,
  ];
  let apiKey = '';
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      apiKey = c.trim();
      break;
    }
  }
  const apiBaseUrl = String(
    options.apiBaseUrl
    || env.THUMBGATE_API_URL
    || env.THUMBGATE_BILLING_API_BASE_URL
    || (operatorCfg && operatorCfg.baseUrl)
    || DEFAULT_API_HOST
  ).trim().replace(/\/+$/, '');
  return { apiKey, apiBaseUrl };
}

function postActivationEvent(endpointUrl, apiKey, bodyObj, awaitDelivery = false) {
  const payload = JSON.stringify(bodyObj);
  const parsed = new URL(endpointUrl);
  const transport = parsed.protocol === 'http:' ? http : https;
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const send = (resolve) => {
    try {
      const req = transport.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers,
        timeout: 2000,
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { if (raw.length < 4096) raw += chunk; });
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode }));
      });
      req.on('error', () => resolve({ ok: false, statusCode: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0 }); });
      if (!awaitDelivery) req.on('socket', (s) => s.unref());
      req.end(payload);
    } catch {
      resolve({ ok: false, statusCode: 0 });
    }
  };
  if (awaitDelivery) return new Promise(send);
  send(() => {});
  return { ok: true, dispatched: true };
}

function spawnDetachedFirstBlockWorker(markerPath, apiKey, apiBaseUrl, env) {
  try {
    const childEnv = { ...env };
    if (apiKey) childEnv.THUMBGATE_API_KEY = apiKey;
    if (apiBaseUrl) childEnv.THUMBGATE_API_URL = apiBaseUrl;
    const child = spawn(process.execPath, [__filename, '--deliver-first-block', markerPath], {
      detached: true,
      stdio: 'ignore',
      env: childEnv,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function reportFirstBlockActivation(metadata = {}) {
  const env = metadata.env || process.env;
  const stateDir = metadata.stateDir || env.THUMBGATE_STATE_DIR || path.dirname(INSTALL_ID_PATH);
  const markerPath = path.join(stateDir, 'activation-recorded.json');
  const existing = readJsonSafe(markerPath) || {};
  const firstBlockAt = existing.firstBlockAt || metadata.firstBlockAt || existing.blockedAt || new Date().toISOString();
  const { apiKey, apiBaseUrl } = resolveActivationAccountAuth(metadata);

  if (existing.firstBlockReportedAt || (!apiKey && existing.firstBlockAnonReportedAt)) {
    if (!existing.firstBlockAt || existing.event !== 'first_block') {
      writeJsonSafe(markerPath, { ...existing, firstBlockAt, event: 'first_block', at: existing.at || firstBlockAt });
    }
    return metadata.awaitDelivery
      ? Promise.resolve({ reported: false, alreadyReported: true, firstBlockAt })
      : { reported: false, alreadyReported: true, firstBlockAt };
  }

  const installId = metadata.installId || getInstallId();
  const gateId = metadata.gateId || existing.gateId || undefined;
  const nextMarker = {
    ...existing,
    at: existing.at || firstBlockAt,
    firstBlockAt,
    event: 'first_block',
    ...(gateId ? { gateId } : {}),
  };
  const optedOut = env.THUMBGATE_NO_TELEMETRY === '1' || env.DO_NOT_TRACK === '1';
  const inIsolatedTest = Boolean(env.NODE_TEST_CONTEXT || env.NODE_ENV === 'test')
    && !metadata.apiBaseUrl
    && !env.THUMBGATE_API_URL;
  if (optedOut || inIsolatedTest) {
    writeJsonSafe(markerPath, nextMarker);
    return metadata.awaitDelivery
      ? Promise.resolve({ reported: false, firstBlockAt })
      : { reported: false, firstBlockAt };
  }

  const eventPayload = {
    event: 'first_block',
    eventType: 'first_block',
    clientType: 'cli',
    firstBlockAt,
    installId,
    ...(gateId ? { gateId: String(gateId).slice(0, 120) } : {}),
  };

  if (metadata.awaitDelivery) {
    writeJsonSafe(markerPath, nextMarker);
    const targetUrl = apiKey
      ? `${apiBaseUrl}/v1/activation/first-block`
      : `${apiBaseUrl}/v1/telemetry/ping`;
    return postActivationEvent(targetUrl, apiKey, eventPayload, true).then((res) => {
      if (res.ok) {
        const latest = readJsonSafe(markerPath) || nextMarker;
        const stamp = new Date().toISOString();
        writeJsonSafe(markerPath, {
          ...latest,
          at: latest.at || firstBlockAt,
          firstBlockAt: latest.firstBlockAt || firstBlockAt,
          event: 'first_block',
          ...(apiKey ? { firstBlockReportedAt: stamp } : { firstBlockAnonReportedAt: stamp }),
        });
      }
      return { reported: Boolean(res.ok), statusCode: res.statusCode, firstBlockAt };
    });
  }

  const lastAttemptMs = existing.firstBlockDispatchAttemptAt ? Date.parse(existing.firstBlockDispatchAttemptAt) : 0;
  if (Number.isFinite(lastAttemptMs) && Date.now() - lastAttemptMs < 10_000) {
    return { reported: false, inFlight: true, firstBlockAt };
  }
  nextMarker.firstBlockDispatchAttemptAt = new Date().toISOString();
  writeJsonSafe(markerPath, nextMarker);
  const spawned = spawnDetachedFirstBlockWorker(markerPath, apiKey, apiBaseUrl, env);
  return { reported: spawned, dispatched: spawned, firstBlockAt };
}

function recordFirstBlockedToolCall(metadata = {}) {
  let alreadyMarked = false;
  try {
    alreadyMarked = fs.existsSync(FIRST_BLOCK_MARKER_PATH);
  } catch { 
    return false;
  }
  const firstBlockAt = new Date().toISOString();
  try { reportFirstBlockActivation({ ...metadata, firstBlockAt }); } catch {  }
  if (alreadyMarked) return false;
  const installId = getInstallId();
  const minutesSinceInstall = computeMinutesSinceInstall();
  const visitorType = classifyInstall();
  const optedOut = process.env.THUMBGATE_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1';
  writeFirstBlockMarker({
    installId,
    blockedAt: firstBlockAt,
    minutesSinceInstall,
    ...(optedOut ? { telemetryOptOut: true } : { visitorType, ...metadata }),
  });
  if (optedOut) return false;
  trackEvent('first_blocked_tool_call', { minutesSinceInstall, visitorType, ...metadata });
  return true;
}

function extractEntryBlockMinutes(e) {
  if (typeof e.minutesSinceInstall === 'number' && Number.isFinite(e.minutesSinceInstall)) return e.minutesSinceInstall;
  if (typeof e.minutesToFirstBlock === 'number' && Number.isFinite(e.minutesToFirstBlock)) return e.minutesToFirstBlock;
  const ms = typeof e.signupToFirstBlockMs === 'number' && Number.isFinite(e.signupToFirstBlockMs)
    ? e.signupToFirstBlockMs
    : e.elapsedSinceOpenMs;
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.round((ms / 60_000) * 10) / 10 : null;
}

function summarizeFirstBlockEvents(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { count: 0, medianMinutes: null, under5MinutesCount: 0 };
  }
  let count = 0;
  const minutesList = [];
  for (const e of entries) {
    if ((e?.eventType || e?.event) !== 'first_blocked_tool_call') continue;
    if (e.visitorType === 'bot' || e.visitorType === 'ci') continue;
    count += 1;
    const m = extractEntryBlockMinutes(e);
    if (m !== null && m >= 0) minutesList.push(m);
  }
  if (count === 0 || minutesList.length === 0) {
    return { count, medianMinutes: null, under5MinutesCount: 0 };
  }
  minutesList.sort((a, b) => a - b);
  const mid = Math.floor(minutesList.length / 2);
  const rawMedian = minutesList.length % 2 === 0
    ? (minutesList[mid - 1] + minutesList[mid]) / 2
    : minutesList[mid];
  return {
    count,
    medianMinutes: Math.round(rawMedian * 10) / 10,
    under5MinutesCount: minutesList.filter((v) => v <= 5).length,
  };
}

function resetForTesting() {
  try {
    if (fs.existsSync(MARKER_PATH)) fs.unlinkSync(MARKER_PATH);
    if (fs.existsSync(FIRST_BLOCK_MARKER_PATH)) fs.unlinkSync(FIRST_BLOCK_MARKER_PATH);
    if (fs.existsSync(ACTIVATION_RECORDED_PATH)) fs.unlinkSync(ACTIVATION_RECORDED_PATH);
  } catch {  }
}

module.exports = {
  recordFirstRulePromotion,
  recordFirstBlockedToolCall,
  reportFirstBlockActivation,
  resolveActivationAccountAuth,
  summarizeFirstBlockEvents,
  computeDaysSinceInstall,
  computeMinutesSinceInstall,
  readMarker,
  writeMarker,
  MARKER_PATH,
  FIRST_BLOCK_MARKER_PATH,
  ACTIVATION_RECORDED_PATH,
  resetForTesting,
};

if (require.main === module && process.argv[2] === '--deliver-first-block' && process.argv[3]) {
  const targetMarker = path.resolve(process.argv[3]);
  reportFirstBlockActivation({
    stateDir: path.dirname(targetMarker),
    awaitDelivery: true,
  }).catch(() => {});
}
