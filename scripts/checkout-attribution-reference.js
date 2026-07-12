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
// Format: `tg1.<source>.<traceId>.<acquisitionId>` — a version prefix plus up to
// three dot-delimited, sanitized fields. Values are restricted to
// [A-Za-z0-9_-] so the dot delimiter can never collide with a value, and the
// whole string is capped well under Stripe's 200-char client_reference_id limit.

const PREFIX = 'tg1';
const DELIM = '.';
const MAX_FIELD = 60;
const MAX_TOTAL = 190;

function cleanField(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, MAX_FIELD);
}

// Build a Stripe `client_reference_id` from checkout metadata. Returns null when
// there is no attributable source (so callers append nothing).
function packCheckoutReference(metadata = {}) {
  const source = cleanField(metadata.utmSource || metadata.source);
  if (!source) return null;
  const traceId = cleanField(metadata.traceId);
  const acquisitionId = cleanField(metadata.acquisitionId);
  return [PREFIX, source, traceId, acquisitionId].join(DELIM).slice(0, MAX_TOTAL);
}

// Parse a `client_reference_id` produced by packCheckoutReference. Returns null
// for anything that is not a recognized tg1 reference with a real source.
function parseCheckoutReference(clientReferenceId) {
  const raw = String(clientReferenceId == null ? '' : clientReferenceId);
  if (!raw.startsWith(PREFIX + DELIM)) return null;
  const parts = raw.split(DELIM);
  const source = cleanField(parts[1]);
  if (!source) return null;
  return {
    source,
    traceId: cleanField(parts[2]) || null,
    acquisitionId: cleanField(parts[3]) || null,
  };
}

module.exports = { packCheckoutReference, parseCheckoutReference };
