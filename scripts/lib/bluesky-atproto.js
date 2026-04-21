'use strict';

/**
 * Shared AT Protocol helpers for Bluesky engagement scripts.
 *
 * Extracted 2026-04-21 to deduplicate the https.request / createSession /
 * pdsHost wiring that was previously copy-pasted across
 * social-reply-monitor-bluesky.js, bluesky-list-actionable.js, and
 * bluesky-delete-replies.js. Keeping all ATProto transport logic in one
 * module also gives SonarCloud a single target for coverage metrics and
 * stops three scripts from drifting on retry / header / error behavior.
 */

const https = require('node:https');

const DEFAULT_PDS_HOST = 'bsky.social';

/**
 * Low-level JSON-over-HTTPS helper used by every ATProto call in this repo.
 *
 * @param {string} method — HTTP method ('GET' | 'POST' | ...).
 * @param {string} host — e.g. 'bsky.social' or the user's PDS host.
 * @param {string} urlPath — XRPC path, e.g. '/xrpc/com.atproto.server.createSession'.
 * @param {{ headers?: Record<string,string>, body?: unknown, request?: Function }} [opts]
 *   — opts.request lets tests inject a fake https.request without monkey-patching.
 * @returns {Promise<{ status: number|undefined, json: any, raw?: string }>}
 */
function atprotoRequest(method, host, urlPath, opts = {}) {
  const requestFn = opts.request || https.request;
  return new Promise((resolve, reject) => {
    const payload = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {
      ...(opts.headers || {}),
      ...(payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : {}),
    };
    const req = requestFn(
      { host, path: urlPath, method, headers },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : {} });
          } catch {
            resolve({ status: res.statusCode, json: {}, raw: buf });
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Resolve the authenticated user's personal data server (PDS) host from the
 * didDoc returned by createSession. Authenticated XRPC calls must target the
 * user's real PDS, not `bsky.social` — hitting bsky.social for a federated
 * user returns 502 UpstreamFailure. Returns null if the didDoc is malformed.
 */
function resolvePdsHost(didDoc) {
  const services = didDoc && Array.isArray(didDoc.service) ? didDoc.service : [];
  const pds = services.find(
    (s) => s && (s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'),
  );
  if (!pds || !pds.serviceEndpoint) return null;
  try {
    return new URL(pds.serviceEndpoint).host;
  } catch {
    return null;
  }
}

/**
 * Authenticate against Bluesky using a handle + app password. Never accepts
 * the account login password; callers must generate app passwords at
 * https://bsky.app/settings/app-passwords so they are scoped + revocable.
 *
 * Returns a session object carrying the access JWT, DID, handle, and the
 * caller's real PDS host. Throws if BLUESKY_HANDLE or BLUESKY_APP_PASSWORD
 * are missing or if the create-session call fails.
 */
async function createSession({ env = process.env, request: requestFn } = {}) {
  const identifier = env.BLUESKY_HANDLE;
  const password = env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) {
    throw new Error('Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD');
  }
  const res = await atprotoRequest(
    'POST',
    DEFAULT_PDS_HOST,
    '/xrpc/com.atproto.server.createSession',
    { body: { identifier, password }, request: requestFn },
  );
  if (res.status !== 200 || !res.json.accessJwt) {
    const detail = res.json && res.json.error ? res.json.error : 'unknown';
    throw new Error(`Bluesky auth failed (status=${res.status}): ${detail}`);
  }
  return {
    accessJwt: res.json.accessJwt,
    did: res.json.did,
    handle: res.json.handle,
    pdsHost: resolvePdsHost(res.json.didDoc) || DEFAULT_PDS_HOST,
  };
}

/**
 * Parse an at:// URI of the form `at://<did>/<collection>/<rkey>`.
 * Returns null for malformed inputs so callers can decide how to fail.
 */
function parseAtUri(uri) {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri || '');
  if (!match) return null;
  return { did: match[1], collection: match[2], rkey: match[3] };
}

/**
 * Narrow test for transient Bluesky upstream failures. The appview
 * occasionally returns 5xx during incidents; schedulers should exit 0 in
 * that case so the orchestrator doesn't mark the run as a hard failure.
 */
function isTransientAtprotoError(err) {
  const msg = String((err && err.message) || '');
  return /\b(502|503|504|UpstreamFailure|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b/.test(msg);
}

module.exports = {
  DEFAULT_PDS_HOST,
  atprotoRequest,
  resolvePdsHost,
  createSession,
  parseAtUri,
  isTransientAtprotoError,
};
