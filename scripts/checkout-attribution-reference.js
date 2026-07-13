'use strict';

// Attribution survival for EXTERNAL Stripe Payment Links.
//
// The $499 diagnostic and the sprint check out via raw `buy.stripe.com` Payment
// Links. Payment Links DROP appended utm_* query params and carry NO session
// metadata — but they DO preserve `client_reference_id` into
// `checkout.session.completed`. Without packing attribution into that field, a
// marketplace-attributed paid checkout (e.g. utm_source=aiventyx) is recorded as
// source=unknown, so it can neither be credited to the marketplace partner nor
// reported. This module packs/parses a compact, URL- and Stripe-safe reference.
//
// Current format: `tg2<source><traceId><acquisitionId><planId>`, with every
// field encoded as a two-digit length followed by the cleaned value. The
// parser remains backward-compatible with the original three-field `tg1`
// format. Stripe accepts only [A-Za-z0-9_-], so punctuation delimiters are
// invalid. Length-prefixing preserves valid hyphens and underscores without
// introducing an unsupported delimiter and keeps the value under Stripe's
// 200-character limit.

const CURRENT_PREFIX = 'tg2';
const LEGACY_PREFIX = 'tg1';
const MAX_FIELD = 45;

function cleanField(value, maxLength = MAX_FIELD) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, maxLength);
}

function encodeField(value) {
  const field = cleanField(value);
  return `${String(field.length).padStart(2, '0')}${field}`;
}

// Build a Stripe `client_reference_id` from checkout metadata. Returns null when
// there is no attributable source (so callers append nothing).
function packCheckoutReference(metadata = {}) {
  const source = cleanField(metadata.utmSource || metadata.source);
  if (!source) return null;
  const traceId = cleanField(metadata.traceId);
  const acquisitionId = cleanField(metadata.acquisitionId);
  const planId = cleanField(metadata.planId || metadata.plan_id);
  return `${CURRENT_PREFIX}${encodeField(source)}${encodeField(traceId)}${encodeField(acquisitionId)}${encodeField(planId)}`;
}

// Parse a `client_reference_id` produced by packCheckoutReference. Returns null
// for anything that is not a recognized tg1 reference with a real source.
function parseCheckoutReference(clientReferenceId) {
  const raw = String(clientReferenceId == null ? '' : clientReferenceId);
  const prefix = raw.startsWith(CURRENT_PREFIX)
    ? CURRENT_PREFIX
    : raw.startsWith(LEGACY_PREFIX)
      ? LEGACY_PREFIX
      : null;
  if (!prefix) return null;
  const fieldCount = prefix === CURRENT_PREFIX ? 4 : 3;
  const maxFieldLength = prefix === CURRENT_PREFIX ? MAX_FIELD : 60;

  const fields = [];
  let cursor = prefix.length;
  for (let index = 0; index < fieldCount; index += 1) {
    const lengthToken = raw.slice(cursor, cursor + 2);
    if (!/^\d{2}$/.test(lengthToken)) return null;
    const fieldLength = Number(lengthToken);
    if (fieldLength > maxFieldLength) return null;
    cursor += 2;
    const field = raw.slice(cursor, cursor + fieldLength);
    if (field.length !== fieldLength || cleanField(field, maxFieldLength) !== field) return null;
    fields.push(field);
    cursor += fieldLength;
  }
  if (cursor !== raw.length) return null;

  const [source, traceId, acquisitionId, planId] = fields;
  if (!source) return null;
  return {
    source,
    traceId: traceId || null,
    acquisitionId: acquisitionId || null,
    planId: planId || null,
  };
}

module.exports = { packCheckoutReference, parseCheckoutReference };
