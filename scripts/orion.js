'use strict';

// Orion: the visit-analytics tag on public thumbgate.ai pages. The tag is inserted as the first thing inside <head>.
// - Same rules as scripts/clarity.js: private paths (dashboard, checkout, admin, API) never get it, and a visitor who sends
//   Global Privacy Control or Do Not Track does not load it.
// - No visitor is identified. We never call orion.identify() with an email, name or phone number.
// - There is no consent banner (see public/privacy.html), so the tag loads without a consent step.
// - THUMBGATE_ORION=off removes the tag without a deploy of new code.

const { isPrivatePath, hasPrivacySignal } = require('./clarity');

const ORION_SCRIPT_ORIGIN = 'https://t.paradigmmachines.ai';
const ORION_STUB = "!function(w){var h=w.__orion=w.__orion||{},o=w.orion=w.orion||{};h.q=h.q||[];['identify','stop'].forEach(function(m){var f=function(){h.q.push([m,[].slice.call(arguments)])};f.q=1;if(!o[m])o[m]=f;if(!h[m])h[m]=f})}(window)";
// Hash of the stub, for a future nonce/hash-based CSP. It is NOT in the CSP today: a hash makes browsers ignore
// 'unsafe-inline', which this site still needs. tests/orion.test.js checks it matches the stub.
const ORION_STUB_CSP_HASH = "'sha256-Ehp57wkg1JOMKj8DHQ0Gs3mGr0CK82EjvNu82pWOq1c='";
const ORION_TAG = `<script>${ORION_STUB}</script><script src="${ORION_SCRIPT_ORIGIN}/q6ksr42etswa3fz583qr.js" async></script>`;
const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled', 'none']);

function orionEnabled(env = process.env) {
  return !OFF_VALUES.has(String((env && env.THUMBGATE_ORION) || '').trim().toLowerCase());
}

function injectOrionTag(html, { pathname = '/', headers = {}, env = process.env } = {}) {
  if (typeof html !== 'string' || !orionEnabled(env)) return html;
  if (html.includes(ORION_SCRIPT_ORIGIN) || isPrivatePath(pathname) || hasPrivacySignal(headers)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, (open) => `${open}${ORION_TAG}`);
}

module.exports = { ORION_TAG, ORION_STUB, ORION_STUB_CSP_HASH, ORION_SCRIPT_ORIGIN, injectOrionTag, orionEnabled };
