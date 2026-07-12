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
// Format: `tg1<2-digit length><source><2-digit length><traceId><2-digit
// length><acquisitionId>`. Stripe accepts only [A-Za-z0-9_-], so punctuation
// delimiters such as dots are invalid. Length-prefixing preserves valid hyphens
// and underscores without introducing an unsupported delimiter, and caps the
// whole value at 189 characters under Stripe's 200-character limit.

const PREFIX = 'tg1';
const MAX_FIELD = 60;
const FIELD_COUNT = 3;

function cleanField(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, MAX_FIELD);
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
  return `${PREFIX}${encodeField(source)}${encodeField(traceId)}${encodeField(acquisitionId)}`;
}

// Parse a `client_reference_id` produced by packCheckoutReference. Returns null
// for anything that is not a recognized tg1 reference with a real source.
function parseCheckoutReference(clientReferenceId) {
  const raw = String(clientReferenceId == null ? '' : clientReferenceId);
  if (!raw.startsWith(PREFIX)) return null;

  const fields = [];
  let cursor = PREFIX.length;
  for (let index = 0; index < FIELD_COUNT; index += 1) {
    const lengthToken = raw.slice(cursor, cursor + 2);
    if (!/^\d{2}$/.test(lengthToken)) return null;
    const fieldLength = Number(lengthToken);
    if (fieldLength > MAX_FIELD) return null;
    cursor += 2;
    const field = raw.slice(cursor, cursor + fieldLength);
    if (field.length !== fieldLength || cleanField(field) !== field) return null;
    fields.push(field);
    cursor += fieldLength;
  }
  if (cursor !== raw.length) return null;

  const [source, traceId, acquisitionId] = fields;
  if (!source) return null;
  return {
    source,
    traceId: traceId || null,
    acquisitionId: acquisitionId || null,
  };
}

module.exports = { packCheckoutReference, parseCheckoutReference };
