#!/usr/bin/env node
'use strict';

/**
 * scripts/thumbgate-inbox-sentinel.js
 *
 * ThumbGate CTO Inbox Sentinel for Boardy Intros & Founder Threads.
 *
 * Enforces four hard invariants:
 *   1. ECI Corporate Isolation (`gate:security:eci_corporate_email_isolation`):
 *      Only inspects the personal/ThumbGate Google account (`igor@igorganapolsky.com` /
 *      `iganapolsky@gmail.com`). Hard-blocks any corporate `@ecisolutions.com`,
 *      `@ecinexus.com`, or `@eci.com` address.
 *   2. Hard No-Send Mandate (`AGENTS.md` 2026-10-17):
 *      Read-only Apple Mail inspection + local `.md` draft staging only.
 *      Never invokes `send` or `make new outgoing message`.
 *   3. ONE-TOUCH Sent Deduplication (`COORDINATION.md`):
 *      Reconciles `INBOX` / `All Mail` threads against `Sent Mail` and `Drafts`
 *      so threads already answered (e.g. Mark Tovey / Arqua) are locked against
 *      duplicate sends (`REPLIED_IN_SENT`), while unsent drafts (e.g. Keshav / Alcoy)
 *      are surfaced as `DRAFT_READY_AWAITING_IGOR_YES`.
 *   4. Bot-Slop & Multi-Bot Collision Guard:
 *      Flags third-person assistant drafts (`Fo (assistant to Igor Ganapolsky)`)
 *      and `boardy@boardy.ai` + `fo@wajo.ai` collisions.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN_CORP_RE = /@(?:ecisolutions|ecinexus|eci)\.com\b/i;
const GENERIC_INBOX_RE = /^(?:info|help|hello|support|sales|noreply|no-reply|notifications?|mailer-daemon)@/i;
const THUMBGATE_RELEVANT_RE = /\b(?:boardy|arqua|mark\s+tovey|keshav|alcoy|thumbgate|zyvop|sanjay|hotdata|eddie\s+tejeda|stract|gabriel\s+olufade|qosmic|pranav|tracekit|bravish|autotomy|approval-layer|control-plane)\b/i;
const SELF_RE = /\b(?:igor@igorganapolsky\.com|iganapolsky@gmail\.com)\b/i;
const THIRD_PERSON_FO_RE = /\bFo\s*\(assistant to Igor|\bIgor will review and decide\b/i;
const BOARDY_INTRO_DISPATCHED_RE = /\bintroduction is going out by email shortly\b|\bintroduction goes out by email\b/i;

function normalizeSubject(subject = '') {
  return String(subject || '')
    .trim()
    .replace(/^(?:(?:re|fwd?):\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractEmailAddress(raw) {
  const str = String(raw || '').trim();
  const start = str.indexOf('<');
  const end = str.indexOf('>', start + 1);
  const extracted = start !== -1 && end !== -1 ? str.slice(start + 1, end) : str;
  return extracted.trim().toLowerCase();
}

function assertNoCorporateLeak(messages = []) {
  for (const msg of messages) {
    const fields = [
      msg.from,
      ...(Array.isArray(msg.to) ? msg.to : []),
      ...(Array.isArray(msg.cc) ? msg.cc : []),
    ].join(' ');
    if (FORBIDDEN_CORP_RE.test(fields)) {
      const err = new Error(`CRITICAL SECURITY BLOCK: Corporate ECI address detected in inbox sentinel (${fields})`);
      err.code = 'THUMBGATE_ECI_ISOLATION_BLOCK';
      throw err;
    }
  }
}

function classifyThreads(messages = []) {
  assertNoCorporateLeak(messages);

  const draftSignatures = new Set(
    messages
      .filter((m) => String(m.mailbox || '').toLowerCase().includes('draft'))
      .map((m) => `${normalizeSubject(m.subject)}|${m.date || ''}`),
  );

  const relevant = messages.filter((msg) => {
    const hay = `${msg.subject || ''} ${msg.from || ''} ${(msg.to || []).join(' ')} ${msg.body || msg.snippet || ''}`;
    if (!THUMBGATE_RELEVANT_RE.test(hay)) return false;
    const fromAddr = extractEmailAddress(msg.from);
    if (GENERIC_INBOX_RE.test(fromAddr)) return false;
    const toList = (msg.to || []).map(extractEmailAddress);
    if (SELF_RE.test(fromAddr) && toList.length === 1 && SELF_RE.test(toList[0])) {
      return false;
    }
    return true;
  });

  const byThread = new Map();
  for (const msg of relevant) {
    const key = normalizeSubject(msg.subject);
    if (!key) continue;
    if (!byThread.has(key)) {
      byThread.set(key, {
        threadKey: key,
        subject: String(msg.subject || '').replace(/^(?:re|fwd?):\s*/gi, '').trim(),
        inbound: [],
        sent: [],
        drafts: [],
      });
    }
    const bucket = byThread.get(key);
    const box = String(msg.mailbox || '').toLowerCase();
    const sig = `${key}|${msg.date || ''}`;
    if (box.includes('draft') || draftSignatures.has(sig)) {
      if (box.includes('draft')) bucket.drafts.push(msg);
    } else if (box.includes('sent')) {
      bucket.sent.push(msg);
    } else if (!SELF_RE.test(extractEmailAddress(msg.from))) {
      bucket.inbound.push(msg);
    }
  }

  const sortByDateDesc = (a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0);
  const threads = [];

  for (const bucket of byThread.values()) {
    bucket.inbound.sort(sortByDateDesc);
    bucket.sent.sort(sortByDateDesc);
    bucket.drafts.sort(sortByDateDesc);

    const latestInbound = bucket.inbound[0] || null;
    const latestSent = bucket.sent[0] || null;
    const latestDraft = bucket.drafts[0] || null;

    const warnings = [];
    if (latestDraft && THIRD_PERSON_FO_RE.test(latestDraft.body || latestDraft.snippet || '')) {
      warnings.push('stale_third_person_fo_draft_do_not_send');
    }

    const externalGuests = new Set();
    for (const m of [...bucket.inbound, ...bucket.sent, ...bucket.drafts]) {
      for (const addr of [extractEmailAddress(m.from), ...(m.to || []).map(extractEmailAddress), ...(m.cc || []).map(extractEmailAddress)]) {
        if (addr && !SELF_RE.test(addr) && !addr.includes('boardy.ai') && !addr.includes('wajo.ai')) {
          externalGuests.add(addr);
        }
      }
    }

    const isBoardyIntro = /^boardy intro:/i.test(bucket.subject);
    if (isBoardyIntro && latestDraft) {
      const draftRecipients = [
        ...(latestDraft.to || []).map(extractEmailAddress),
        ...(latestDraft.cc || []).map(extractEmailAddress),
      ];
      if (!draftRecipients.some((r) => r.includes('boardy.ai'))) {
        warnings.push('draft_missing_boardy_cc');
      }
    }

    let status = 'NEEDS_DRAFT';
    let actionRequired = true;
    let oneTouchLocked = false;

    const latestInboundBody = latestInbound ? (latestInbound.body || latestInbound.snippet || '') : '';
    const latestSentUnquoted = latestSent
      ? String(latestSent.body || latestSent.snippet || '')
          .split('\n')
          .filter((line) => !/^\s*>/.test(line) && !/^On .* wrote:\s*$/i.test(line.trim()))
          .join('\n')
      : '';
    const promisedFollowupAfterCheck =
      /\b(?:let you know if it still isn't routing|give it the 10 minutes|let you know once it resolves)\b/i.test(
        latestSentUnquoted,
      );
    if (promisedFollowupAfterCheck) {
      warnings.push('sent_reply_promised_dns_followup_verify_http_307');
    }
    if (latestSent && (!latestInbound || Date.parse(latestSent.date) >= Date.parse(latestInbound.date)) && !promisedFollowupAfterCheck) {
      status = 'REPLIED_IN_SENT';
      actionRequired = false;
      oneTouchLocked = true;
    } else if (promisedFollowupAfterCheck) {
      status = 'FOLLOWUP_REQUIRED_ZYVOP_VERIFY_HTTP_400';
    } else if (bucket.sent.length > 0 && BOARDY_INTRO_DISPATCHED_RE.test(latestInboundBody)) {
      status = 'INTRO_OPT_IN_COMPLETE';
      actionRequired = false;
      oneTouchLocked = true;
    } else if (warnings.includes('stale_third_person_fo_draft_do_not_send')) {
      status = 'STALE_FO_DRAFT_DO_NOT_SEND';
      actionRequired = false;
      oneTouchLocked = true;
    } else if (latestDraft) {
      status = 'DRAFT_READY_AWAITING_IGOR_YES';
    }

    threads.push({
      threadKey: bucket.threadKey,
      subject: bucket.subject,
      status,
      actionRequired,
      oneTouchLocked,
      externalGuests: [...externalGuests],
      sentCount: bucket.sent.length,
      latestInboundAt: latestInbound?.date || null,
      latestSentAt: latestSent?.date || null,
      latestDraftAt: latestDraft?.date || null,
      latestDraftPreview: latestDraft
        ? {
            to: latestDraft.to || [],
            cc: latestDraft.cc || [],
            subject: latestDraft.subject,
            body: latestDraft.body || latestDraft.snippet || '',
          }
        : null,
      warnings,
    });
  }

  threads.sort((a, b) => {
    const aTime = Math.max(Date.parse(a.latestInboundAt || 0), Date.parse(a.latestSentAt || 0), Date.parse(a.latestDraftAt || 0));
    const bTime = Math.max(Date.parse(b.latestInboundAt || 0), Date.parse(b.latestSentAt || 0), Date.parse(b.latestDraftAt || 0));
    return bTime - aTime;
  });

  return {
    checkedAt: new Date().toISOString(),
    hardNoSendEnforced: true,
    eciIsolationEnforced: true,
    threadCount: threads.length,
    actionableCount: threads.filter((t) => t.actionRequired).length,
    threads,
  };
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
        if (/boardy|arqua|mark|keshav|alcoy|thumbgate|zyvop|sanjay|hotdata|eddie|stract|gabriel|qosmic|pranav|tracekit|bravish|autotomy|approval-layer|control-plane/i.test(subj + " " + sender)) {
          messages.push({
            mailbox: bname,
            date: m.dateReceived() ? m.dateReceived().toISOString() : null,
            from: sender,
            to: m.toRecipients().map(r => r.address()),
            cc: m.ccRecipients().map(r => r.address()),
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
  const raw = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return JSON.parse(raw);
}

function writeLedgerSnapshot(report, stateDir = path.join(__dirname, '..', '.thumbgate')) {
  fs.mkdirSync(stateDir, { recursive: true });
  const ledgerPath = path.join(stateDir, 'inbox-triage-ledger.json');
  fs.writeFileSync(ledgerPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return ledgerPath;
}

if (require.main === module) {
  const fetched = fetchAppleMailGoogleMessages(25);
  if (fetched && fetched.error) {
    throw new Error(fetched.error);
  }
  const report = classifyThreads(fetched.messages || []);
  const ledgerPath = writeLedgerSnapshot(report);
  console.log(JSON.stringify({ ...report, ledgerPath }, null, 2));
}

module.exports = {
  assertNoCorporateLeak,
  classifyThreads,
  extractEmailAddress,
  fetchAppleMailGoogleMessages,
  normalizeSubject,
  writeLedgerSnapshot,
};
