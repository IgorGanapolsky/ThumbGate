#!/usr/bin/env node
'use strict';

/**
 * scripts/thumbgate-inbox-sentinel.js
 *
 * ThumbGate CTO Inbox Sentinel for B2B Revenue, Boardy Intros & Founder Threads.
 * Enforces: (1) ECI corporate address isolation (`@ecisolutions.com`, `@ecinexus.com`, `@eci.com` -> BLOCKED),
 * (2) Send-by-Default Disposition Loop (`AGENTS.md` 2026-11-12 — reverses 2026-10-17 no-send rule;
 * Igor, 10:28 AM Nov 12, 2026: "use this. steal their ideas. take care of this") classifying every thread
 * into `REPLIED`, `DRAFTED_FOR_APPROVAL`, `NO_REPLY_NEEDED`, `WAITING_FOR_INFORMATION`, `BLOCKED`, or `OPTED_OUT`
 * with runtime JSONL ledger and provider send-confirmation tracking (the sentinel decides/records; lead agent's
 * mail path sends), (3) ONE-TOUCH `REPLIED_IN_SENT` dedup, and (4) Bot-slop, multi-bot, & brand-standards guards.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateBrandStandards } = require('./brand-standards-gate');

const DISPOSITIONS = Object.freeze(['REPLIED', 'DRAFTED_FOR_APPROVAL', 'NO_REPLY_NEEDED', 'WAITING_FOR_INFORMATION', 'BLOCKED', 'OPTED_OUT']);

// Unsolicited vendor cold pitches with no question resolve to NO_REPLY_NEEDED.
const VENDOR_COLD_PITCH_NO_QUESTION_DISPOSITION = 'NO_REPLY_NEEDED';
const DEFAULT_APPROVAL_THRESHOLD_USD = 500;

const FORBIDDEN_CORP_RE = /@(?:ecisolutions|ecinexus|eci)\.com\b/i;
const AUTOMATED_SENDER_RE = /^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|notifications?|bounce)@/i;
const AUTO_REPLY_SUBJECT_RE = /^(?:automatic reply|auto-reply|out of office|ooo|undeliverable|delivery status notification)\b/i;
const SUBJECT_PREFIX_RE = /^(?:(?:re|fwd?):\s*)+/i;
const SELF_RE = /\b(?:igor@igorganapolsky\.com|iganapolsky@gmail\.com)\b/i;
const THIRD_PERSON_FO_RE = /\bFo\s*\(assistant to Igor|\bIgor will review and decide\b/i;
const BOT_SLOP_DRAFT_RE = /\[IGOR\b|\bPackage only\b|\bDo not send\b|\[\[/i;
const BOARDY_INTRO_DISPATCHED_RE = /\bintroduction is going out by email shortly\b|\bintroduction goes out by email\b/i;
const PROMISED_FOLLOWUP_RE = /\b(?:let you know if it still isn't routing|give it the 10 minutes|let you know once it resolves)\b/i;
const DRAFT_PLACEHOLDER_RE = /\[(?:TBD|TODO|MISSING_INFO|WAITING_FOR_INFO|NEED_INFO)\]|<TODO>/i;
const MISSING_ACCOUNT_INFO_RE = /\b(?:which invoice|my webhook failed|my license key isn't working|my api key failed|billing error on my account)\b/i;
const ACCOUNT_IDENTIFIER_RE = /\b(?:tg_[a-z0-9_]+|inv_[a-z0-9_]+|cs_(?:live|test)_[a-z0-9_]+|sub_[a-z0-9_]+|#[0-9]{4,})\b/i;
const APPLE_MAIL_RELEVANT_RE = /\b(?:igor@igorganapolsky\.com|iganapolsky@gmail\.com|boardy|arqua|mark|keshav|alcoy|thumbgate|zyvop|sanjay|hotdata|eddie|stract|gabriel|qosmic|pranav|tracekit|bravish|autotomy|breezyassist|michel|approval-layer|control-plane|mcp|pretooluse)\b/i;
const BULK_FOOTER_UNSUBSCRIBE_RE = /\b(?:click here to unsubscribe|unsubscribe from (?:this list|future emails|these emails)|manage (?:your )?(?:email )?preferences|update subscription preferences|view in browser)\b/i;
const DIRECT_OPT_OUT_RE = /\b(?:please\s+unsubscribe|unsubscribe\s+me|opt\s+me\s+out|please\s+opt\s+out|remove\s+me\s+from|please\s+remove\s+me|take\s+me\s+off|stop\s+emailing|do\s+not\s+contact\s+me|do\s+not\s+email\s+me|don't\s+email\s+me|never\s+email\s+me)\b/i;
const BARE_OPT_OUT_RE = /^(?:(?:re|fwd?):\s*)*(?:unsubscribe|opt[- ]?out|remove me|stop)\s*[.!]?$/i;
const VENDOR_COLD_PITCH_RE = /\b(?:we help (?:b2b|saas|devtool|tech|software|fast-growing) companies|our (?:lead[- ]gen|seo|dev|recruiting|outreach|marketing) agency|offshore (?:developers|engineers)|staff augmentation|book [0-9]+ (?:qualified )?(?:demos|meetings|calls)|white[- ]label (?:development|seo|ppc)|sponsored (?:newsletter|placement|dedicated send)|guest post placement|high-da backlinks)\b/i;
const CONTRACT_OR_LEGAL_RE = /\b(?:msa|nda|dpa|baa|sow|master service agreement|non-disclosure|data processing agreement|terms of service amendment|redline|indemnif(?:y|ication)|liability cap|governing law|exclusivity clause|sign(?:ing)? (?:the |this |our )?(?:contract|agreement)|binding commitment|legal agreement)\b/i;
const DISCOUNT_REFUND_PRICE_CHANGE_RE = /\b(?:discount|promo code|coupon|[0-9]{1,3}%\s*off|price (?:reduction|cut|change|adjustment|override)|lower (?:the )?price|waive (?:the )?fee|refund|money[- ]back|chargeback|credit memo|custom pricing|grandfather(?:ed)? pricing)\b/i;
const SCOPE_CHANGE_RE = /\b(?:scope change|out of scope|change order|custom feature commitment|roadmap commitment|bespoke (?:deliverable|integration|build)|dedicated (?:engineer|instance)|custom on-prem build)\b/i;
const SENSITIVE_PII_FINANCIAL_RE = /\b(?:social security number|ssn|tax id|ein\b|w-9\b|w-8ben\b|routing number|ach\b|wire transfer|iban\b|swift code|bank account number|credit card number|cvv\b|passport number|driver'?s license|cap table|audited financials)\b/i;
const UNVERIFIED_CLAIMS_RE = /\b(?:soc\s*2(?:\s*type\s*ii)?|hipaa(?:\s*baa)?|fedramp|iso\s*27001|pci[- ]dss|100%\s*(?:guarantee|uptime|bug-free)|zero false positives guaranteed|guaranteed [0-9]+x)\b/i;
const OPPORTUNITY_SIGNAL_RE = /\b(?:boardy intro|thumbgate|pro\b|license|pricing|seat|team|enterprise|pilot|walkthrough|demo|integration|partner(?:ship)?|mcp|pretooluse|hook|checkout|trial)\b/i;

function resolveRuntimeDir(stateDir) {
  return stateDir || process.env.THUMBGATE_RUNTIME_DIR || process.env.THUMBGATE_STATE_DIR || path.join(__dirname, '..', '.thumbgate');
}

function normalizeSubject(subject = '') {
  return String(subject || '').trim().replace(SUBJECT_PREFIX_RE, '').replace(/\s+/g, ' ').toLowerCase();
}

function extractEmailAddress(raw) {
  const str = String(raw || '').trim();
  const start = str.indexOf('<');
  const end = str.indexOf('>', start + 1);
  return (start !== -1 && end !== -1 ? str.slice(start + 1, end) : str).trim().toLowerCase();
}

function hasEmailDomain(addr, domain) {
  const lower = extractEmailAddress(addr);
  const atIdx = lower.lastIndexOf('@');
  if (atIdx === -1) return false;
  const host = lower.slice(atIdx + 1);
  return host === domain || host.endsWith(`.${domain}`);
}

function isApprovalBrandRuleId(ruleId) {
  const id = String(ruleId || '');
  return id === 'no-unverified-refund-or-guarantee' || id.startsWith('voice-');
}
const INBOUND_CLAIM_RULE_IDS = new Set(['no-unverified-refund-or-guarantee', 'voice-no-unverified-claims', 'voice-unverified-price-claim']);

function stripQuotedLines(body = '') {
  return String(body || '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line) && !/^On [^\n]{1,120} wrote:\s*$/i.test(line.trim()))
    .join('\n')
    .trim();
}

function parseApprovalThresholdUsd(rawValue) {
  const candidate = rawValue !== undefined && rawValue !== null && rawValue !== ''
    ? rawValue
    : process.env.THUMBGATE_EMAIL_APPROVAL_THRESHOLD_USD;
  if (candidate === undefined || candidate === null || String(candidate).trim() === '') return DEFAULT_APPROVAL_THRESHOLD_USD;
  const parsed = Number(String(candidate).trim().replace(/^\$/, '').replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_APPROVAL_THRESHOLD_USD;
}

function scaleAmount(wholeStr, fracStr, suffixStr) {
  const whole = Number(String(wholeStr).replaceAll(',', ''));
  const frac = fracStr ? Number(`0.${fracStr}`) : 0;
  const s = String(suffixStr || '').toLowerCase();
  let mult = 1;
  if (s === 'k') mult = 1000;
  else if (s === 'm') mult = 1000000;
  return (whole + frac) * mult;
}

function extractUsdAmounts(text = '') {
  const content = String(text || '');
  const amounts = [];
  const patterns = [
    /(?:\$|USD[ \t]{1,4})([0-9]{1,3}(?:,[0-9]{3}){1,3}|[0-9]{1,7})(?:\.([0-9]{1,2}))?(?:[ \t]{0,4}([kKmM]))?\b/gi,
    /\b([0-9]{1,3}(?:,[0-9]{3}){1,3}|[0-9]{1,7})(?:\.([0-9]{1,2}))?[ \t]{0,4}(?:([kKmM])[ \t]{0,4})?USD\b/gi,
  ];
  for (const re of patterns) {
    let m = re.exec(content);
    while (m !== null) {
      const val = scaleAmount(m[1], m[2], m[3]);
      if (Number.isFinite(val)) amounts.push(val);
      m = re.exec(content);
    }
  }
  return amounts;
}

function toAddressList(raw) {
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(extractEmailAddress).filter(Boolean);
}

function messageEnvelopeText(msg = {}) {
  return [msg.from, ...(msg.to || []), ...(msg.cc || []), ...(msg.bcc || [])].filter(Boolean).join(' ');
}

function assertNoCorporateLeak(messages = []) {
  for (const msg of messages) {
    const fields = messageEnvelopeText(msg);
    if (FORBIDDEN_CORP_RE.test(fields)) {
      const err = new Error(`CRITICAL SECURITY BLOCK: Corporate ECI address detected in inbox sentinel (${fields})`);
      err.code = 'THUMBGATE_ECI_ISOLATION_BLOCK';
      throw err;
    }
  }
}

function normalizeDoNotContactSet(doNotContact = [], stateDir = null) {
  const entries = new Set();
  for (const item of Array.isArray(doNotContact) ? doNotContact : [...doNotContact]) {
    const cleaned = extractEmailAddress(item);
    if (cleaned) entries.add(cleaned);
  }
  const dncPath = stateDir ? path.join(stateDir, 'do-not-contact.json') : null;
  if (dncPath && fs.existsSync(dncPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dncPath, 'utf8'));
      for (const item of Array.isArray(parsed) ? parsed : (parsed?.entries || [])) {
        const cleaned = extractEmailAddress(item);
        if (cleaned) entries.add(cleaned);
      }
    } catch { /* ignore malformed DNC file */ }
  }
  return entries;
}

function matchesDoNotContact(addr, dncSet) {
  if (!addr || !dncSet?.size) return false;
  const lower = addr.toLowerCase();
  if (dncSet.has(lower)) return true;
  const atIdx = lower.lastIndexOf('@');
  if (atIdx === -1) return false;
  const domain = lower.slice(atIdx + 1);
  return dncSet.has(domain) || dncSet.has(`@${domain}`);
}

function loadPersistedLedgerState(stateDir) {
  const confirmedSent = new Map();
  const optedOutRecipients = new Set();
  const jsonlPath = stateDir ? path.join(stateDir, 'inbox-dispositions.jsonl') : null;
  if (!jsonlPath || !fs.existsSync(jsonlPath)) return { confirmedSent, optedOutRecipients };
  try {
    for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (row?.sentConfirmed === true && row.threadId) {
        confirmedSent.set(String(row.threadId), row);
        if (row.threadKey) confirmedSent.set(String(row.threadKey), row);
      }
      if (row?.disposition === 'OPTED_OUT' && row.recipient) optedOutRecipients.add(extractEmailAddress(row.recipient));
    }
  } catch { /* non-fatal */ }
  return { confirmedSent, optedOutRecipients };
}

function isDirectOptOut(subject = '', unquotedBody = '') {
  const cleanSubj = String(subject || '').trim();
  const cleanBody = String(unquotedBody || '').trim();
  if (BARE_OPT_OUT_RE.test(cleanSubj) || BARE_OPT_OUT_RE.test(cleanBody)) return true;
  const withoutFooter = cleanBody.split('\n').filter((line) => !BULK_FOOTER_UNSUBSCRIBE_RE.test(line)).join('\n');
  return DIRECT_OPT_OUT_RE.test(cleanSubj) || DIRECT_OPT_OUT_RE.test(withoutFooter);
}

function detectApprovalExceptions({ subject = '', unquotedInbound = '', draftText = '', brandViolations = [], approvalThresholdUsd = DEFAULT_APPROVAL_THRESHOLD_USD }) {
  const reasons = [];
  const combined = `${subject}\n${unquotedInbound}\n${draftText}`;
  if (CONTRACT_OR_LEGAL_RE.test(combined)) reasons.push('contract_or_legal_commitment');
  if (DISCOUNT_REFUND_PRICE_CHANGE_RE.test(combined)) reasons.push('discount_refund_or_price_change');
  if (SCOPE_CHANGE_RE.test(combined)) reasons.push('scope_change');
  if (SENSITIVE_PII_FINANCIAL_RE.test(combined)) reasons.push('sensitive_personal_or_financial_info');
  if (UNVERIFIED_CLAIMS_RE.test(combined) || brandViolations.some((v) => isApprovalBrandRuleId(v.ruleId))) {
    reasons.push('unverified_claims_or_pricing');
  }
  const amounts = extractUsdAmounts(combined);
  const maxUsd = amounts.length > 0 ? Math.max(...amounts) : 0;
  if (maxUsd > approvalThresholdUsd) reasons.push('deal_over_usd_threshold');
  return { reasons, maxDealUsd: maxUsd > 0 ? maxUsd : null };
}

function inspectCandidateReplyBlockers(thread, candidateReply, dncSet, approvalThresholdUsd) {
  const blockers = [];
  const toAddrs = toAddressList(candidateReply.to);
  const allRecipients = [...toAddrs, ...toAddressList(candidateReply.cc), ...toAddressList(candidateReply.bcc)];
  const externalTo = toAddrs.filter((addr) => !SELF_RE.test(addr));
  if (externalTo.length === 0) blockers.push('missing_valid_recipient');
  for (const addr of allRecipients) {
    if (FORBIDDEN_CORP_RE.test(addr)) blockers.push('eci_corporate_address_isolation');
    if (matchesDoNotContact(addr, dncSet)) blockers.push('do_not_contact_list');
  }
  const allowed = new Set([...(thread.externalGuests || []), ...(thread.participants || [])].map((a) => a.toLowerCase()));
  if (allowed.size > 0 && externalTo.some((addr) => !allowed.has(addr))) blockers.push('recipient_not_in_thread');
  if (candidateReply.threadId && thread.threadId && String(candidateReply.threadId) !== String(thread.threadId)) {
    blockers.push('thread_mismatch');
  }
  const body = String(candidateReply.body || '');
  if (THIRD_PERSON_FO_RE.test(body) || BOT_SLOP_DRAFT_RE.test(body)) blockers.push('bot_slop_draft_blocked');
  if (DRAFT_PLACEHOLDER_RE.test(body)) blockers.push('draft_placeholder_unresolved');
  const verdict = evaluateBrandStandards(body, { brand: 'thumbgate' });
  if (verdict.violations.some((v) => !isApprovalBrandRuleId(v.ruleId))) blockers.push('off_brand_prohibited_content');
  const approvalEval = detectApprovalExceptions({
    subject: String(candidateReply.subject || thread.subject || ''),
    draftText: body,
    brandViolations: verdict.violations,
    approvalThresholdUsd,
  });
  return [...blockers, ...approvalEval.reasons];
}

function evaluatePreSendCheck(thread, candidateReply = null, options = {}) {
  if (!thread) return { allowed: false, blockers: ['missing_thread'] };
  const blockers = [];
  const dncSet = normalizeDoNotContactSet(options.doNotContact || [], options.stateDir || null);
  const threshold = parseApprovalThresholdUsd(options.approvalThresholdUsd);
  if (thread.eciIsolationBlocked || FORBIDDEN_CORP_RE.test(thread.recipient || '')) blockers.push('eci_corporate_address_isolation');
  if (thread.disposition === 'OPTED_OUT') blockers.push('recipient_opted_out');
  if (thread.oneTouchLocked || thread.status === 'REPLIED_IN_SENT') blockers.push('already_replied_in_sent');
  if (!thread.recipient || SELF_RE.test(thread.recipient)) blockers.push('missing_valid_recipient');
  if (matchesDoNotContact(thread.recipient, dncSet)) blockers.push('do_not_contact_list');
  if (candidateReply) blockers.push(...inspectCandidateReplyBlockers(thread, candidateReply, dncSet, threshold));
  const uniqueBlockers = [...new Set(blockers)];
  return { allowed: uniqueBlockers.length === 0 && thread.sendEligible === true, blockers: uniqueBlockers };
}

function resolveGroupingKeys(msg, idx, pairToExplicitId) {
  const subjKey = normalizeSubject(msg.subject);
  const allExt = [extractEmailAddress(msg.from), ...toAddressList(msg.to), ...toAddressList(msg.cc)].filter((a) => a && !SELF_RE.test(a));
  const nonBroker = [...new Set(allExt.filter((a) => !hasEmailDomain(a, 'boardy.ai') && !hasEmailDomain(a, 'wajo.ai')))].sort();
  const correspondentKey = nonBroker.join(',') || [...new Set(allExt)].sort().join(',');
  const pairKey = `${subjKey || 'nosubj'}::${correspondentKey || msg.messageId || msg.date || idx}`;
  const explicitId = msg.threadId || msg.gmailThreadId || msg.xGmThrid || pairToExplicitId.get(pairKey) || null;
  const groupKey = explicitId ? String(explicitId) : pairKey;
  return { groupKey, threadId: explicitId ? String(explicitId) : `thread:${pairKey}`, threadKey: subjKey || groupKey };
}

function isSelfNoteOnly(msg) {
  if (FORBIDDEN_CORP_RE.test(messageEnvelopeText(msg))) return false;
  const fromAddr = extractEmailAddress(msg.from);
  const toList = toAddressList(msg.to);
  return SELF_RE.test(fromAddr) && toList.length === 1 && SELF_RE.test(toList[0]) && toAddressList(msg.cc).length === 0;
}

function bucketMessagesByThread(messages, strictRelevanceFilter = false) {
  const relevant = messages.filter((msg) => {
    if (isSelfNoteOnly(msg)) return false;
    if (!strictRelevanceFilter || FORBIDDEN_CORP_RE.test(messageEnvelopeText(msg))) return true;
    return APPLE_MAIL_RELEVANT_RE.test(`${msg.subject || ''} ${messageEnvelopeText(msg)} ${msg.body || msg.snippet || ''}`);
  });
  const draftSigs = new Set();
  const sentSigs = new Set();
  const pairToExplicitId = new Map();
  relevant.forEach((msg, idx) => {
    const box = String(msg.mailbox || '').toLowerCase();
    const sig = msg.messageId ? `id:${msg.messageId}` : `${normalizeSubject(msg.subject)}|${msg.date || ''}`;
    if (box.includes('draft')) draftSigs.add(sig);
    if (box.includes('sent')) sentSigs.add(sig);
    const explicitId = msg.threadId || msg.gmailThreadId || msg.xGmThrid || null;
    if (explicitId) {
      const { groupKey } = resolveGroupingKeys({ ...msg, threadId: null, gmailThreadId: null, xGmThrid: null }, idx, new Map());
      if (!pairToExplicitId.has(groupKey)) pairToExplicitId.set(groupKey, String(explicitId));
    }
  });
  const byThread = new Map();
  relevant.forEach((msg, idx) => {
    const { groupKey, threadId, threadKey } = resolveGroupingKeys(msg, idx, pairToExplicitId);
    if (!byThread.has(groupKey)) {
      const subject = String(msg.subject || '').replace(SUBJECT_PREFIX_RE, '').trim() || '(no subject)';
      byThread.set(groupKey, { threadId, threadKey, subject, inbound: [], sent: [], drafts: [], seenSentSigs: new Set(), corporateLeakDetected: false });
    }
    const bucket = byThread.get(groupKey);
    if (FORBIDDEN_CORP_RE.test(messageEnvelopeText(msg))) bucket.corporateLeakDetected = true;
    const box = String(msg.mailbox || '').toLowerCase();
    const sig = msg.messageId ? `id:${msg.messageId}` : `${normalizeSubject(msg.subject)}|${msg.date || ''}`;
    const fromSelf = SELF_RE.test(extractEmailAddress(msg.from));
    if (box.includes('draft') || draftSigs.has(sig)) {
      if (box.includes('draft')) bucket.drafts.push(msg);
    } else if (box.includes('sent') || (fromSelf && !bucket.corporateLeakDetected) || sentSigs.has(sig)) {
      if (!bucket.seenSentSigs.has(sig)) {
        bucket.seenSentSigs.add(sig);
        bucket.sent.push(msg);
      }
    } else {
      bucket.inbound.push(msg);
    }
  });
  return byThread;
}

function collectParticipantsAndWarnings(bucket, latestDraft, draftBody) {
  const warnings = [];
  if (latestDraft && THIRD_PERSON_FO_RE.test(draftBody)) warnings.push('stale_third_person_fo_draft_do_not_send');
  if (latestDraft && BOT_SLOP_DRAFT_RE.test(draftBody)) warnings.push('bot_slop_draft_do_not_send');
  const threadParticipants = new Set();
  for (const m of [...bucket.inbound, ...bucket.sent]) {
    for (const addr of [extractEmailAddress(m.from), ...toAddressList(m.to), ...toAddressList(m.cc)]) {
      if (addr && !SELF_RE.test(addr)) threadParticipants.add(addr);
    }
  }
  const participants = new Set();
  const externalGuests = new Set();
  let hasBoardy = false;
  let hasFoWajo = false;
  for (const m of [...bucket.inbound, ...bucket.sent, ...bucket.drafts]) {
    for (const addr of [extractEmailAddress(m.from), ...toAddressList(m.to), ...toAddressList(m.cc)]) {
      if (!addr || SELF_RE.test(addr)) continue;
      participants.add(addr);
      if (hasEmailDomain(addr, 'boardy.ai')) hasBoardy = true;
      else if (hasEmailDomain(addr, 'wajo.ai')) hasFoWajo = true;
      else if (threadParticipants.size === 0 || threadParticipants.has(addr)) externalGuests.add(addr);
    }
  }
  const isBoardyIntro = /^boardy intro:/i.test(bucket.subject);
  if (isBoardyIntro && latestDraft) {
    const draftRecips = [...toAddressList(latestDraft.to), ...toAddressList(latestDraft.cc)];
    if (!draftRecips.some((r) => hasEmailDomain(r, 'boardy.ai'))) warnings.push('draft_missing_boardy_cc');
  }
  let draftRecipientMismatch = false;
  if (latestDraft) {
    const draftTo = toAddressList(latestDraft.to).filter((a) => !SELF_RE.test(a));
    if (threadParticipants.size > 0 && draftTo.some((addr) => !threadParticipants.has(addr))) {
      draftRecipientMismatch = true;
      warnings.push('draft_recipient_not_in_thread');
    }
    if (latestDraft.targetThreadId && String(latestDraft.targetThreadId) !== bucket.threadId) {
      draftRecipientMismatch = true;
      warnings.push('draft_thread_mismatch');
    }
  }
  return { warnings, participants, externalGuests, hasBoardy, hasFoWajo, isBoardyIntro, draftRecipientMismatch };
}

function checkBlockedReason(b) {
  if (b.corporateLeakDetected) return { status: 'BLOCKED_ECI_CORPORATE_ISOLATION', reason: 'eci_corporate_address_isolation', actionRequired: false, oneTouchLocked: true };
  if (b.dncMatched) return { status: 'BLOCKED_DO_NOT_CONTACT', reason: 'do_not_contact_list', actionRequired: false, oneTouchLocked: true };
  if (b.warnings.includes('stale_third_person_fo_draft_do_not_send')) return { status: 'STALE_FO_DRAFT_DO_NOT_SEND', reason: 'stale_third_person_fo_draft_do_not_send', actionRequired: false, oneTouchLocked: true };
  if (b.warnings.includes('bot_slop_draft_do_not_send')) return { status: 'BLOCKED_BOT_SLOP_DRAFT', reason: 'bot_slop_draft_blocked', actionRequired: false, oneTouchLocked: true };
  if (b.hasBoardy && b.hasFoWajo) return { status: 'BLOCKED_MULTI_BOT_COLLISION', reason: 'multi_bot_collision', actionRequired: false, oneTouchLocked: true };
  if (b.hasOffBrandContent) return { status: 'BLOCKED_OFF_BRAND_CONTENT', reason: 'off_brand_prohibited_content', actionRequired: false, oneTouchLocked: true };
  if (!b.primaryRecipient || b.draftRecipientMismatch || b.warnings.includes('draft_missing_boardy_cc')) {
    const missingCc = b.warnings.includes('draft_missing_boardy_cc');
    return {
      status: missingCc ? 'BLOCKED_DRAFT_MISSING_BOARDY_CC' : 'BLOCKED_RECIPIENT_OR_THREAD_MISMATCH',
      reason: missingCc ? 'draft_missing_boardy_cc' : 'recipient_or_thread_mismatch',
      actionRequired: true,
      oneTouchLocked: false,
    };
  }
  return null;
}

function applyProviderConfirmationOutcome(providerConf, checkedAt) {
  if (providerConf?.confirmed === true) {
    return { disposition: 'REPLIED', status: 'SENT_CONFIRMED', result: 'SENT_CONFIRMED', sentConfirmed: true, confirmedAt: providerConf.confirmedAt || checkedAt, providerMessageId: providerConf.providerMessageId || providerConf.uid || null, sendError: null, actionRequired: false, oneTouchLocked: true };
  }
  if (providerConf?.confirmed === false) {
    return { status: 'SEND_FAILED', result: 'SEND_FAILED', sentConfirmed: false, confirmedAt: null, providerMessageId: null, sendError: String(providerConf.error || 'provider_confirmation_failed'), actionRequired: true, oneTouchLocked: false };
  }
  return null;
}

function isVendorColdPitchWithoutQuestion({ sentCount, isBoardyIntro, subject, unquotedInbound, rawInbound, category }) {
  if (sentCount > 0 || isBoardyIntro || String(unquotedInbound || '').includes('?')) return false;
  if (category === 'vendor_cold_pitch' || VENDOR_COLD_PITCH_RE.test(`${subject}\n${unquotedInbound}`)) return true;
  return BULK_FOOTER_UNSUBSCRIBE_RE.test(rawInbound) && !OPPORTUNITY_SIGNAL_RE.test(subject);
}

function resolveDispositionState(p) {
  const make = (disposition, status, reason, result, extra = {}) => ({
    sendEligible: false, approvalRequired: false, approvalReasons: [], maxDealUsd: null,
    sentConfirmed: false, confirmedAt: null, providerMessageId: null, sendError: null,
    followUpRequired: false, actionRequired: false, oneTouchLocked: false,
    disposition, status, reason, result, ...extra,
  });

  if (p.blocked) return make('BLOCKED', p.blocked.status, p.blocked.reason, 'BLOCKED', p.blocked);
  if (p.hasOptOutMessage) return make('OPTED_OUT', 'OPTED_OUT', 'recipient_opted_out', 'OPTED_OUT', { oneTouchLocked: true });
  if (p.alreadyAnsweredInSent) {
    return make('NO_REPLY_NEEDED', 'REPLIED_IN_SENT', 'already_replied_in_sent', 'ALREADY_REPLIED_IN_SENT', {
      sentConfirmed: true,
      confirmedAt: p.latestSent?.date || p.persistedSent?.time || null,
      providerMessageId: p.latestSent?.messageId || p.persistedSent?.providerMessageId || null,
      oneTouchLocked: true,
    });
  }
  if (p.bucket.sent.length > 0 && BOARDY_INTRO_DISPATCHED_RE.test(p.latestInboundRaw)) {
    return make('NO_REPLY_NEEDED', 'INTRO_OPT_IN_COMPLETE', 'boardy_intro_already_dispatched', 'NO_REPLY_NEEDED', { oneTouchLocked: true });
  }
  if (p.latestInbound && (AUTOMATED_SENDER_RE.test(extractEmailAddress(p.latestInbound.from)) || AUTO_REPLY_SUBJECT_RE.test(String(p.latestInbound.subject || '').trim()))) {
    return make('NO_REPLY_NEEDED', 'NO_REPLY_NEEDED', 'automated_no_reply_sender', 'NO_REPLY_NEEDED');
  }
  if (p.latestInbound && isVendorColdPitchWithoutQuestion({ sentCount: p.bucket.sent.length, isBoardyIntro: p.meta.isBoardyIntro, subject: p.bucket.subject, unquotedInbound: p.latestInboundUnquoted, rawInbound: p.latestInboundRaw, category: p.latestInbound.category || '' })) {
    return make(VENDOR_COLD_PITCH_NO_QUESTION_DISPOSITION, 'NO_REPLY_NEEDED', 'vendor_cold_pitch_no_question', 'NO_REPLY_NEEDED');
  }
  if (p.promisedFollowup || p.latestInbound?.waitingForInformation === true || DRAFT_PLACEHOLDER_RE.test(p.draftBody) || (MISSING_ACCOUNT_INFO_RE.test(p.latestInboundUnquoted) && !ACCOUNT_IDENTIFIER_RE.test(p.latestInboundUnquoted))) {
    return make('WAITING_FOR_INFORMATION', p.promisedFollowup ? 'FOLLOWUP_REQUIRED_ZYVOP_VERIFY_HTTP_400' : 'WAITING_FOR_INFORMATION', p.promisedFollowup ? 'awaiting_promised_verification_result' : 'missing_required_information', 'WAITING_FOR_INFORMATION', { actionRequired: true, followUpRequired: true });
  }

  const approvalEval = detectApprovalExceptions({ subject: p.bucket.subject, unquotedInbound: p.latestInboundUnquoted, draftText: p.draftBody, brandViolations: p.allBrandViolations, approvalThresholdUsd: p.ctx.approvalThresholdUsd });
  const providerOutcome = applyProviderConfirmationOutcome(p.providerConf, p.ctx.checkedAt);
  if (approvalEval.reasons.length > 0) {
    const draftState = make('DRAFTED_FOR_APPROVAL', 'DRAFTED_FOR_APPROVAL', approvalEval.reasons[0], 'DRAFTED_FOR_APPROVAL', { approvalRequired: true, approvalReasons: approvalEval.reasons, maxDealUsd: approvalEval.maxDealUsd, actionRequired: true });
    return providerOutcome ? { ...draftState, ...providerOutcome } : draftState;
  }
  const ordinaryState = make('REPLIED', 'READY_TO_SEND', 'ordinary_business_correspondence', 'READY_TO_SEND_AWAITING_PROVIDER_CONFIRMATION', { sendEligible: true, actionRequired: true });
  return providerOutcome ? { ...ordinaryState, ...providerOutcome } : ordinaryState;
}

function evaluateBucket(bucket, ctx) {
  const sortByDateDesc = (a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0);
  bucket.inbound.sort(sortByDateDesc);
  bucket.sent.sort(sortByDateDesc);
  bucket.drafts.sort(sortByDateDesc);

  const latestInbound = bucket.inbound[0] || null;
  const latestSent = bucket.sent[0] || null;
  const latestDraft = bucket.drafts[0] || null;
  const draftBody = latestDraft ? String(latestDraft.body || latestDraft.snippet || '') : '';
  const meta = collectParticipantsAndWarnings(bucket, latestDraft, draftBody);
  const primaryRecipient =
    (latestInbound && !SELF_RE.test(extractEmailAddress(latestInbound.from)) ? extractEmailAddress(latestInbound.from) : null) ||
    [...meta.externalGuests][0] || [...meta.participants][0] || (latestDraft ? toAddressList(latestDraft.to)[0] || null : null);

  const latestInboundRaw = latestInbound ? String(latestInbound.body || latestInbound.snippet || '') : '';
  const latestInboundUnquoted = stripQuotedLines(latestInboundRaw);
  const promisedFollowup = PROMISED_FOLLOWUP_RE.test(latestSent ? stripQuotedLines(latestSent.body || latestSent.snippet || '') : '');
  if (promisedFollowup) meta.warnings.push('sent_reply_promised_dns_followup_verify_http_307');

  const inboundVerdict = latestInboundUnquoted ? evaluateBrandStandards(latestInboundUnquoted, { brand: 'thumbgate' }) : { violations: [] };
  const draftVerdict = draftBody ? evaluateBrandStandards(draftBody, { brand: 'thumbgate' }) : { violations: [] };
  const relevantInboundViolations = (inboundVerdict.violations || []).filter((v) => !isApprovalBrandRuleId(v.ruleId) || INBOUND_CLAIM_RULE_IDS.has(v.ruleId));
  const allBrandViolations = [...relevantInboundViolations, ...(draftVerdict.violations || [])];
  const persistedSent = ctx.persistedConfirmed.get(bucket.threadId) || ctx.persistedConfirmed.get(bucket.threadKey) || null;
  const inboundMs = latestInbound?.date ? Date.parse(latestInbound.date) : 0;
  const alreadyAnsweredInSent = !promisedFollowup && (
    (Boolean(latestSent) && (!latestInbound || Date.parse(latestSent.date || 0) >= inboundMs)) ||
    (Boolean(persistedSent) && (!latestInbound || Date.parse(persistedSent.time || 0) >= inboundMs))
  );
  const hasOptOutMessage =
    bucket.inbound.some((m) => isDirectOptOut(m.subject || bucket.subject, stripQuotedLines(m.body || m.snippet || ''))) ||
    [...meta.participants].some((addr) => ctx.optedOutRecipients.has(addr));
  const blocked = checkBlockedReason({
    corporateLeakDetected: bucket.corporateLeakDetected,
    dncMatched: [...meta.participants].some((addr) => matchesDoNotContact(addr, ctx.dncSet)),
    warnings: meta.warnings,
    hasBoardy: meta.hasBoardy,
    hasFoWajo: meta.hasFoWajo,
    hasOffBrandContent: allBrandViolations.some((v) => !isApprovalBrandRuleId(v.ruleId)),
    primaryRecipient,
    draftRecipientMismatch: meta.draftRecipientMismatch,
  });

  const state = resolveDispositionState({
    bucket, meta, blocked, hasOptOutMessage, alreadyAnsweredInSent, latestInbound, latestInboundRaw,
    latestInboundUnquoted, latestSent, persistedSent, promisedFollowup, draftBody, allBrandViolations,
    providerConf: ctx.getProviderConfirmation(bucket.threadId, bucket.threadKey), ctx,
  });
  if (state.disposition === 'OPTED_OUT' && primaryRecipient) ctx.optedOutRecipients.add(primaryRecipient);

  const qualifiedOpportunity = state.disposition !== 'BLOCKED' && state.disposition !== 'OPTED_OUT' &&
    state.reason !== 'vendor_cold_pitch_no_question' && state.reason !== 'automated_no_reply_sender' &&
    (meta.isBoardyIntro || state.disposition === 'DRAFTED_FOR_APPROVAL' || OPPORTUNITY_SIGNAL_RE.test(`${bucket.subject} ${latestInboundUnquoted}`));

  return {
    threadId: bucket.threadId, threadKey: bucket.threadKey, subject: bucket.subject, recipient: primaryRecipient,
    ...state, qualifiedOpportunity, eciIsolationBlocked: bucket.corporateLeakDetected,
    participants: [...meta.participants], externalGuests: [...meta.externalGuests], sentCount: bucket.sent.length,
    latestInboundAt: latestInbound?.date || null, latestSentAt: latestSent?.date || null, latestDraftAt: latestDraft?.date || null,
    latestDraftPreview: latestDraft ? { to: latestDraft.to || [], cc: latestDraft.cc || [], subject: latestDraft.subject, body: draftBody } : null,
    warnings: meta.warnings,
  };
}

function buildCycleReport(threads = []) {
  const byDisposition = { REPLIED: 0, DRAFTED_FOR_APPROVAL: 0, NO_REPLY_NEEDED: 0, WAITING_FOR_INFORMATION: 0, BLOCKED: 0, OPTED_OUT: 0 };
  for (const t of threads) {
    if (Object.prototype.hasOwnProperty.call(byDisposition, t.disposition)) byDisposition[t.disposition] += 1;
  }
  const pick = (pred, mapFn) => threads.filter(pred).map(mapFn);
  const sent = pick((t) => t.disposition === 'REPLIED' && t.sentConfirmed === true, (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject, confirmedAt: t.confirmedAt, providerMessageId: t.providerMessageId }));
  const readyToSend = pick((t) => t.disposition === 'REPLIED' && !t.sentConfirmed && t.result !== 'SEND_FAILED', (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject }));
  const draftsAwaitingApproval = pick((t) => t.disposition === 'DRAFTED_FOR_APPROVAL', (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject, approvalReasons: t.approvalReasons, maxDealUsd: t.maxDealUsd }));
  const followUps = pick((t) => t.disposition === 'WAITING_FOR_INFORMATION' || t.followUpRequired, (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject, reason: t.reason }));
  const qualifiedOpportunities = pick((t) => t.qualifiedOpportunity, (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject, disposition: t.disposition }));
  const blocked = pick((t) => t.disposition === 'BLOCKED', (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject, reason: t.reason }));
  const failures = pick((t) => t.result === 'SEND_FAILED', (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject, error: t.sendError || 'provider_send_failed' }));
  const optedOut = pick((t) => t.disposition === 'OPTED_OUT', (t) => ({ threadId: t.threadId, recipient: t.recipient, subject: t.subject }));
  return {
    threadsReviewed: threads.length, byDisposition,
    sentCount: sent.length, sent, readyToSendCount: readyToSend.length, readyToSend,
    draftsAwaitingApprovalCount: draftsAwaitingApproval.length, draftsAwaitingApproval,
    followUpsCount: followUps.length, followUps,
    qualifiedOpportunitiesCount: qualifiedOpportunities.length, qualifiedOpportunities,
    blockedCount: blocked.length, blocked, failuresCount: failures.length, failures,
    optedOutCount: optedOut.length, optedOut,
  };
}

function classifyThreads(messages = [], options = {}) {
  if (options.throwOnCorporateLeak === true) assertNoCorporateLeak(messages);
  const checkedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const approvalThresholdUsd = parseApprovalThresholdUsd(options.approvalThresholdUsd);
  const dncSet = normalizeDoNotContactSet(options.doNotContact || [], options.stateDir || null);
  const persisted = loadPersistedLedgerState(options.stateDir || null);
  const providerConfirmations = options.providerConfirmations || {};
  const getProviderConfirmation = (threadId, threadKey) => (
    providerConfirmations instanceof Map
      ? providerConfirmations.get(threadId) || providerConfirmations.get(threadKey) || null
      : providerConfirmations[threadId] || providerConfirmations[threadKey] || null
  );
  const byThread = bucketMessagesByThread(messages, options.strictRelevanceFilter === true);
  for (const bucket of byThread.values()) {
    for (const m of bucket.inbound) {
      if (isDirectOptOut(m.subject || bucket.subject, stripQuotedLines(m.body || m.snippet || ''))) {
        const sender = extractEmailAddress(m.from);
        if (sender && !SELF_RE.test(sender)) persisted.optedOutRecipients.add(sender);
      }
    }
  }
  const ctx = { checkedAt, approvalThresholdUsd, dncSet, persistedConfirmed: persisted.confirmedSent, optedOutRecipients: persisted.optedOutRecipients, getProviderConfirmation };
  const threads = [...byThread.values()].map((bucket) => evaluateBucket(bucket, ctx));
  threads.sort((a, b) => {
    const aTime = Math.max(Date.parse(a.latestInboundAt || 0), Date.parse(a.latestSentAt || 0), Date.parse(a.latestDraftAt || 0));
    const bTime = Math.max(Date.parse(b.latestInboundAt || 0), Date.parse(b.latestSentAt || 0), Date.parse(b.latestDraftAt || 0));
    return bTime - aTime;
  });
  return {
    checkedAt, sendByDefaultForOrdinaryReplies: true, sentinelSendsDirectly: false,
    vendorColdPitchNoQuestionRule: VENDOR_COLD_PITCH_NO_QUESTION_DISPOSITION,
    approvalThresholdUsd, eciIsolationEnforced: true,
    threadCount: threads.length, actionableCount: threads.filter((t) => t.actionRequired).length,
    cycleReport: buildCycleReport(threads), threads,
  };
}

function appendDispositionLedgerJsonl(report, stateDir) {
  const dir = resolveRuntimeDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const jsonlPath = path.join(dir, 'inbox-dispositions.jsonl');
  const recordedAt = report?.checkedAt || new Date().toISOString();
  const lines = (report?.threads || []).map((t) => JSON.stringify({
    threadId: t.threadId, threadKey: t.threadKey, time: t.confirmedAt || recordedAt,
    recipient: t.recipient, disposition: t.disposition, reason: t.reason,
    sentConfirmed: Boolean(t.sentConfirmed), result: t.result, providerMessageId: t.providerMessageId || null, subject: t.subject,
  }));
  if (lines.length > 0) fs.appendFileSync(jsonlPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  else if (!fs.existsSync(jsonlPath)) fs.writeFileSync(jsonlPath, '', { mode: 0o600 });
  return jsonlPath;
}

function recordProviderSendConfirmation({ threadId, threadKey = null, recipient, subject = '', confirmed = true, providerMessageId = null, confirmedAt = new Date().toISOString(), disposition = 'REPLIED', reason = 'provider_confirmed_send', error = null }, stateDir) {
  if (!threadId) throw new Error('threadId is required to record provider send confirmation');
  if (FORBIDDEN_CORP_RE.test(String(recipient || ''))) {
    const err = new Error(`CRITICAL SECURITY BLOCK: Corporate ECI address detected (${recipient})`);
    err.code = 'THUMBGATE_ECI_ISOLATION_BLOCK';
    throw err;
  }
  const dir = resolveRuntimeDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const jsonlPath = path.join(dir, 'inbox-dispositions.jsonl');
  const entry = {
    threadId: String(threadId), threadKey: threadKey || normalizeSubject(subject) || String(threadId),
    time: confirmedAt, recipient: extractEmailAddress(recipient), disposition, reason,
    sentConfirmed: Boolean(confirmed), result: confirmed ? 'SENT_CONFIRMED' : 'SEND_FAILED',
    providerMessageId: providerMessageId || null, error: error || null, subject,
  };
  fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return { jsonlPath, entry };
}

function readDispositionLedgerJsonl(stateDir) {
  const jsonlPath = path.join(resolveRuntimeDir(stateDir), 'inbox-dispositions.jsonl');
  if (!fs.existsSync(jsonlPath)) return [];
  return fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeLedgerSnapshot(report, stateDir) {
  const dir = resolveRuntimeDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const ledgerPath = path.join(dir, 'inbox-triage-ledger.json');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  appendDispositionLedgerJsonl(report, dir);
  return ledgerPath;
}

function fetchAppleMailGoogleMessages(limitPerBox = 25) {
  const jxa = `
const Mail = Application("Mail");
const googleAcct = Mail.accounts().find(a => {
  const n = (a.name() || "").toLowerCase();
  const addrs = (a.emailAddresses ? a.emailAddresses() : []).join(" ").toLowerCase();
  return !/@(?:ecisolutions|ecinexus|eci)\\.com/.test(n + " " + addrs) && (n.includes("google") || /igor@igorganapolsky\\.com|iganapolsky@gmail\\.com/.test(addrs));
});
if (!googleAcct) {
  JSON.stringify({ error: "Google account not found in Mail.app", messages: [] });
} else {
  const messages = [];
  for (const bname of ["INBOX", "Sent Mail", "Drafts", "All Mail"]) {
    const box = googleAcct.mailboxes().find(m => m.name() === bname);
    if (!box) continue;
    const msgs = box.messages();
    const limit = Math.min(msgs.length, ${Number(limitPerBox) || 25});
    for (let i = 0; i < limit; i++) {
      try {
        const m = msgs[i];
        const subj = m.subject() || "";
        const sender = m.sender() || "";
        const toAddrs = m.toRecipients().map(r => r.address());
        const ccAddrs = m.ccRecipients().map(r => r.address());
        const envelope = [subj, sender, ...toAddrs, ...ccAddrs].join(" ");
        if (${APPLE_MAIL_RELEVANT_RE.toString()}.test(envelope)) {
          messages.push({
            messageId: m.messageId ? m.messageId() : null,
            mailbox: bname,
            date: m.dateReceived() ? m.dateReceived().toISOString() : null,
            from: sender,
            to: toAddrs,
            cc: ccAddrs,
            subject: subj,
            read: m.readStatus(),
            body: (m.content() || "").slice(0, 2500)
          });
        }
      } catch (e) {}
    }
  }
  JSON.stringify({ account: googleAcct.name(), messages });
}
`;
  const raw = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(raw);
}

if (require.main === module) {
  const runtimeDir = resolveRuntimeDir();
  const fetched = fetchAppleMailGoogleMessages(25);
  if (fetched?.error) throw new Error(fetched.error);
  const report = classifyThreads(fetched?.messages || [], { stateDir: runtimeDir });
  const ledgerPath = writeLedgerSnapshot(report, runtimeDir);
  const jsonlLedgerPath = path.join(runtimeDir, 'inbox-dispositions.jsonl');
  console.log(JSON.stringify({ ...report, ledgerPath, jsonlLedgerPath }, null, 2));
}

module.exports = {
  DISPOSITIONS, VENDOR_COLD_PITCH_NO_QUESTION_DISPOSITION, DEFAULT_APPROVAL_THRESHOLD_USD,
  appendDispositionLedgerJsonl, assertNoCorporateLeak, buildCycleReport, classifyThreads,
  evaluatePreSendCheck, extractEmailAddress, extractUsdAmounts, fetchAppleMailGoogleMessages,
  hasEmailDomain, normalizeSubject, parseApprovalThresholdUsd, readDispositionLedgerJsonl,
  recordProviderSendConfirmation, resolveRuntimeDir, writeLedgerSnapshot,
};
