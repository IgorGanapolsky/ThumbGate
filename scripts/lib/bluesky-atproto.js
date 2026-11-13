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

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
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
    const isBinary = Buffer.isBuffer(opts.rawBody);
    const payload = isBinary ? opts.rawBody : opts.body ? JSON.stringify(opts.body) : null;
    const headers = opts.headers ? { ...opts.headers } : {};
    if (payload) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = isBinary ? 'application/octet-stream' : 'application/json';
      }
      headers['Content-Length'] = Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload);
    }
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
  const services = Array.isArray(didDoc?.service) ? didDoc.service : [];
  const pds = services.find(
    (s) => s && (s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'),
  );
  if (!pds?.serviceEndpoint) return null;
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
    const detail = res.json?.error || 'unknown';
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
  const msg = String(err?.message || '');
  return /\b(502|503|504|UpstreamFailure|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b/.test(msg);
}

/**
 * Sanitize a user-controlled string for log lines. Strips CR/LF and other
 * control characters so attacker handles / post text can't forge log entries
 * (CWE-117 / SonarCloud S5145). Truncates at 200 chars to keep logs readable.
 */
function sanitizeForLog(value) {
  if (value == null) return '';
  const str = String(value);
  // eslint-disable-next-line no-control-regex
  return str.replaceAll(/[\x00-\x1f\x7f]/g, '?').slice(0, 200);
}

function inferMimeType(filePath = '') {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

async function uploadBlob(session, imageInput, opts = {}) {
  const rawBody = Buffer.isBuffer(imageInput)
    ? imageInput
    : fs.readFileSync(typeof imageInput === 'string' ? imageInput : imageInput.path);
  const mimeType =
    opts.mimeType ||
    (typeof imageInput === 'object' && imageInput?.mimeType) ||
    inferMimeType(typeof imageInput === 'string' ? imageInput : imageInput?.path);
  const { status, json } = await atprotoRequest(
    'POST',
    session.pdsHost || DEFAULT_PDS_HOST,
    '/xrpc/com.atproto.repo.uploadBlob',
    {
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        'Content-Type': mimeType,
      },
      rawBody,
      request: opts.request,
    },
  );
  if (status !== 200 || !json?.blob) {
    throw new Error(`Bluesky uploadBlob failed: ${status} ${json?.error || ''}`.trim());
  }
  return json.blob;
}

async function buildImagesEmbed(session, images = [], opts = {}) {
  const valid = (Array.isArray(images) ? images : []).filter((item) => {
    if (!item) return false;
    if (Buffer.isBuffer(item) || Buffer.isBuffer(item.data)) return true;
    const p = typeof item === 'string' ? item : item.path;
    return p && fs.existsSync(p);
  });
  if (!valid.length) return null;
  const uploaded = [];
  for (const item of valid.slice(0, 4)) {
    const p = typeof item === 'string' ? item : item.path;
    const alt = (typeof item === 'object' && item.alt) || 'Product screenshot and architecture preview';
    const aspectRatio = typeof item === 'object' && item.aspectRatio ? item.aspectRatio : undefined;
    const blob = await uploadBlob(session, item.data || p, {
      mimeType: typeof item === 'object' ? item.mimeType : undefined,
      request: opts.request,
    });
    const imgEntry = { alt, image: blob };
    if (aspectRatio && aspectRatio.width && aspectRatio.height) {
      imgEntry.aspectRatio = aspectRatio;
    }
    uploaded.push(imgEntry);
  }
  return {
    $type: 'app.bsky.embed.images',
    images: uploaded,
  };
}

function buildRichTextFacets(text = '') {
  const str = String(text || '');
  if (!str) return [];
  const facets = [];
  const urlRegex = /(https?:\/\/[^\s)\]]+)|(\b(?:[a-z0-9-]+\.)+(?:ai|io|com|dev|app|org)(?:\/[^\s)\]]*)?)/gi;
  let match;
  while ((match = urlRegex.exec(str)) !== null) {
    let rawMatch = match[0];
    while (/[.,;:!?]$/.test(rawMatch)) {
      rawMatch = rawMatch.slice(0, -1);
    }
    if (!rawMatch) continue;
    const byteStart = Buffer.byteLength(str.slice(0, match.index), 'utf8');
    const byteEnd = byteStart + Buffer.byteLength(rawMatch, 'utf8');
    const uri = /^https?:\/\//i.test(rawMatch) ? rawMatch : `https://${rawMatch}`;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  const tagRegex = /(?:^|\s)(#[A-Za-z][A-Za-z0-9_]{1,63})/g;
  while ((match = tagRegex.exec(str)) !== null) {
    const tagWithHash = match[1];
    const tagStartChar = match.index + match[0].indexOf(tagWithHash);
    const byteStart = Buffer.byteLength(str.slice(0, tagStartChar), 'utf8');
    const byteEnd = byteStart + Buffer.byteLength(tagWithHash, 'utf8');
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithHash.slice(1) }],
    });
  }
  return facets;
}

async function deleteRecord(session, uriOrRkey, collection = 'app.bsky.feed.post', opts = {}) {
  const parsed = parseAtUri(uriOrRkey);
  const rkey = parsed ? parsed.rkey : String(uriOrRkey || '').trim();
  const col = parsed ? parsed.collection : collection;
  const { status, json } = await atprotoRequest(
    'POST',
    session.pdsHost || DEFAULT_PDS_HOST,
    '/xrpc/com.atproto.repo.deleteRecord',
    {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      body: {
        repo: session.did,
        collection: col,
        rkey,
      },
      request: opts.request,
    },
  );
  if (status !== 200) {
    throw new Error(`Bluesky deleteRecord failed: ${status} ${json?.error || ''}`.trim());
  }
  return { deleted: true, rkey };
}

module.exports = {
  DEFAULT_PDS_HOST,
  atprotoRequest,
  resolvePdsHost,
  createSession,
  parseAtUri,
  isTransientAtprotoError,
  sanitizeForLog,
  inferMimeType,
  uploadBlob,
  buildImagesEmbed,
  buildRichTextFacets,
  deleteRecord,
};
