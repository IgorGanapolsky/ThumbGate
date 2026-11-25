'use strict';

// "Request a 30-day team pilot": validate a visitor's request, store it on the feedback volume, and tell the owner.
// Stored as one JSON line per request in pilot-requests.jsonl. The owner address comes from THUMBGATE_OWNER_EMAILS
// (the same variable the analytics filter uses); with none set the request is still stored and the result says so.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TEAM_SIZES = ['1-5', '6-20', '21-100', '100+'];
const AGENTS = ['Claude Code', 'Cursor', 'Codex', 'Gemini', 'Other'];
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const FILE_NAME = 'pilot-requests.jsonl';

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function validatePilotRequest(body = {}) {
  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const teamSize = clean(body.teamSize, 20);
  const agent = clean(body.agent, 40);
  const errors = [];
  if (!name) errors.push('name');
  if (!EMAIL_PATTERN.test(email)) errors.push('email');
  if (!TEAM_SIZES.includes(teamSize)) errors.push('teamSize');
  if (!AGENTS.includes(agent)) errors.push('agent');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    request: {
      id: `pilot_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      receivedAt: new Date().toISOString(),
      name,
      email,
      teamSize,
      agent,
      source: clean(body.source, 80) || 'website',
      page: clean(body.page, 120) || '/pilot',
    },
  };
}

function storePilotRequest(feedbackDir, request) {
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.appendFileSync(path.join(feedbackDir, FILE_NAME), `${JSON.stringify(request)}\n`, 'utf8');
}

function readPilotRequests(feedbackDir) {
  try {
    return fs.readFileSync(path.join(feedbackDir, FILE_NAME), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function notifyOwner(request, { sendEmail, ownerEmails } = {}) {
  const to = (ownerEmails || []).filter(Boolean)[0];
  if (!to) return { sent: false, reason: 'no_owner_address' };
  if (typeof sendEmail !== 'function') return { sent: false, reason: 'no_mailer' };
  const text = [
    'A visitor asked for a 30-day team pilot on thumbgate.ai.',
    '',
    `Name: ${request.name}`,
    `Email: ${request.email}`,
    `Team size: ${request.teamSize}`,
    `Agent: ${request.agent}`,
    `Received: ${request.receivedAt}`,
    `Request id: ${request.id}`,
  ].join('\n');
  try {
    const result = await sendEmail({ to, subject: `ThumbGate pilot request: ${request.name} (${request.teamSize}, ${request.agent})`, text, replyTo: request.email });
    return { sent: !(result && result.sent === false), reason: (result && result.reason) || null };
  } catch (error) {
    return { sent: false, reason: `mailer_error:${error.message || 'unknown'}` };
  }
}

module.exports = { TEAM_SIZES, AGENTS, FILE_NAME, validatePilotRequest, storePilotRequest, readPilotRequests, notifyOwner };
