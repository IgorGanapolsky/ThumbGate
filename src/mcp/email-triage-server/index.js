#!/usr/bin/env node
'use strict';

/**
 * email-triage MCP Server
 *
 * An MCP (Model Context Protocol) server for email triage and response drafting.
 * Reads emails from Gmail and Apple Mail, classifies them, generates draft
 * responses into ~/Documents/AI-Agent-Sync/, and supports CDP-driven Gmail
 * web-app automation via BrowserOS neo.
 *
 * Tools:
 *   - read_gmail           Read recent Gmail threads via Gmail API or Screenpipe
 *   - read_apple_mail      Read Apple Mail messages via AppleScript
 *   - classify_email       Classify a single email (triage priority, reply needed)
 *   - triage_emails        Read + classify emails from all configured sources
 *   - generate_draft       Compose a draft reply and stage it for human review
 *   - list_drafts          List existing staged email drafts
 *   - generate_social_draft  Compose a social-media draft and stage it
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const { z } = require('zod');

// ---- MCP SDK (resolved from ThumbGate repo node_modules at runtime) ----
let McpServer, StdioServerTransport;
try {
  ({ McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js'));
  ({ StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js'));
} catch (e) {
  const repoRoot = path.resolve(__dirname, '../../..');
  ({ McpServer } = require(path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/server/mcp.js')));
  ({ StdioServerTransport } = require(path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/server/stdio.js')));
}

// ---- Environment configuration ----
const EMAIL_DRAFTS_DIR =
  process.env.EMAIL_DRAFTS_DIR ||
  path.join(process.env.HOME || '/Users/iganapolsky', 'Documents/AI-Agent-Sync/Projects/ThumbGate/Email-Drafts');
const SOCIAL_DRAFTS_DIR =
  process.env.SOCIAL_DRAFTS_DIR ||
  path.join(process.env.HOME || '/Users/iganapolsky', 'Documents/AI-Agent-Sync/Projects/ThumbGate/Social-Drafts');
const VAULT_DIR =
  process.env.VAULT_DIR ||
  path.join(process.env.HOME || '/Users/iganapolsky', 'Documents/AI-Agent-Sync');
const EMAIL_CDP_URL = process.env.EMAIL_CDP_URL || 'http://localhost:9111';
const SCREENPIPE_API_URL = process.env.SCREENPIPE_API_URL || 'http://localhost:3030';

for (const dir of [EMAIL_DRAFTS_DIR, SOCIAL_DRAFTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---- Utility helpers ----

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Request timed out')));
  });
}

function runAppleScript(script) {
  try {
    return execSync('osascript -e ' + JSON.stringify(script), {
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env },
    }).trim();
  } catch (err) {
    return JSON.stringify({
      error: err.message,
      stderr: err.stderr ? err.stderr.trim() : undefined,
    });
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
}

function humanTimestamp() {
  return new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function utcTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ---- Gmail API integration ----

const GMAIL_TOKEN_PATH = path.join(
  process.env.HOME || '/Users/iganapolsky',
  '.hermes/google_token.json',
);

function loadGmailService() {
  let google;
  try {
    google = require('googleapis');
  } catch {
    return null;
  }

  if (!fs.existsSync(GMAIL_TOKEN_PATH)) return null;

  try {
    const tok = JSON.parse(fs.readFileSync(GMAIL_TOKEN_PATH, 'utf-8'));
    if (!tok.access_token && !tok.token) return null;

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: tok.access_token || tok.token,
      refresh_token: tok.refresh_token,
      token_type: tok.token_type || 'Bearer',
      expiry_date: tok.expiry_date,
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  } catch {
    return null;
  }
}

function b64urlDecode(data) {
  if (!data) return '';
  try {
    return Buffer.from(
      data.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8');
  } catch {
    return '';
  }
}

function extractHeaders(msg) {
  const headers = {};
  const hdrArr = (msg.payload || {}).headers || [];
  for (const h of hdrArr) {
    headers[h.name.toLowerCase()] = h.value;
  }
  return headers;
}

function extractBody(msg) {
  const payload = msg.payload || {};
  let body = '';

  if (payload.mimeType === 'text/plain') {
    body = b64urlDecode((payload.body || {}).data || '');
  } else if (payload.mimeType === 'text/html') {
    body = b64urlDecode((payload.body || {}).data || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain') {
        body += b64urlDecode((part.body || {}).data || '') + '\n';
      } else if (part.mimeType === 'text/html' && !body) {
        body = b64urlDecode((part.body || {}).data || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
  }

  return body.trim().substring(0, 4000);
}

function parseEmailObject(headers, body, msg) {
  return {
    id: msg.id || '',
    threadId: msg.threadId || '',
    from: headers.from || '',
    to: headers.to || '',
    subject: headers.subject || '(no subject)',
    date: headers.date || '',
    body: body,
    snippet: msg.snippet || body.substring(0, 200),
  };
}

// ---- Apple Mail integration via AppleScript ----

function readAppleMailMessages(opts = {}) {
  const { inbox = 'Inbox', senderContains = '', subjectContains = '', limit = 10 } = opts;

  let conditions = '';
  if (senderContains) {
    conditions = `whose sender contains "${senderContains}"`;
  } else if (subjectContains) {
    conditions = `whose subject contains "${subjectContains}"`;
  }

  const mailboxClause = inbox ? `of mailbox "${inbox}"` : '';

  const script = `
tell application "Mail"
  set theMessages to every message ${conditions} ${mailboxClause}
  set output to ""
  repeat with i from 1 to ${limit}
    if i > (count of theMessages) then exit repeat
    set m to item i of theMessages
    set output to output & "MESSAGE-ID: " & (message id of m) & linefeed
    set output to output & "THREAD-ID: " & "" & linefeed
    set output to output & "FROM: " & (sender of m) & linefeed
    set recipients to ""
    repeat with r in (recipients of m)
      set recipients to recipients & (address of r) & ", "
    end repeat
    set output to output & "TO: " & recipients & linefeed
    set output to output & "SUBJECT: " & (subject of m) & linefeed
    set output to output & "DATE: " & (date received of m) & linefeed
    set output to output & "BODY: " & (content of m) & linefeed
    set output to output & "---END-MESSAGE---" & linefeed
  end repeat
  return output
end tell
`;

  return runAppleScript(script);
}

function parseAppleMailOutput(result) {
  const messages = [];
  const blocks = result.split('---END-MESSAGE---').filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split('\n').map((l) => l.trim());
    const msg = {};
    let body = '';
    let inBody = false;

    for (const line of lines) {
      if (line.startsWith('BODY:')) {
        inBody = true;
        body = line.substring(5);
      } else if (inBody) {
        body += '\n' + line;
      } else if (line.includes(':')) {
        const [key, ...rest] = line.split(':');
        msg[key.trim().toLowerCase()] = rest.join(':').trim();
      }
    }

    if (msg.subject && msg.from) {
      msg.body = body.trim();
      messages.push(msg);
    }
  }
  return messages;
}

// ---- Screenpipe content search ----

async function searchScreenpipe(query, limit = 10) {
  try {
    const res = await httpRequest(
      `${SCREENPIPE_API_URL}/v1/search?content=${encodeURIComponent(query)}&limit=${limit}`,
      { timeout: 10000 },
    );
    if (res.status === 200 && res.body && Array.isArray(res.body)) {
      return res.body;
    }
    return [];
  } catch {
    return [];
  }
}

// ---- Email classification ----

function classifyEmail(emailText) {
  const text = (emailText || '').toLowerCase();
  const labels = [];
  let priority = 'medium';
  let actionNeeded = false;
  let replyNeeded = false;

  if (/\b(action|reply|respond|feedback|review|approve|sign|confirm)\b/.test(text)) {
    actionNeeded = true;
    replyNeeded = true;
  }
  if (/\b(urgent|asap|deadline|by (tomorrow|friday|monday|weekend|eod|end of day))\b/.test(text)) {
    priority = 'high';
    actionNeeded = true;
    replyNeeded = true;
  }
  if (/\b(fyi|for your information|heads up|just letting you know)\b/.test(text)) {
    if (priority !== 'high') priority = 'low';
    labels.push('informational');
  }
  if (/\b(meeting|calendar|schedule|zoom|teams|call)\b/.test(text)) {
    labels.push('calendar');
  }
  if (/\b(invoice|payment|bill|receipt|charge)\b/.test(text)) {
    labels.push('finance');
    if (priority !== 'high') priority = 'medium';
  }
  if (/\b(hiring|job|interview|resume|offer)\b/.test(text)) {
    labels.push('hiring');
  }
  if (/\b(promo|discount|deal|offer|sale|unsubscribe)\b/.test(text)) {
    labels.push('promotional');
    if (priority !== 'high') priority = 'low';
  }
  if (/^re:/i.test(text) || /\b(thread|chain|discussion)\b/.test(text)) {
    labels.push('thread-continuation');
  }
  if (!actionNeeded && /\b(question|wondering|curious|help|need)\b/.test(text)) {
    replyNeeded = true;
  }

  const categories = [...new Set(labels)].filter((l) => l);
  if (categories.length === 0) categories.push('general');

  return {
    priority,
    replyNeeded,
    actionNeeded,
    categories,
    summary: `Priority: ${priority}${replyNeeded ? ', reply needed' : ''}${actionNeeded ? ', action required' : ''}`,
  };
}

// ---- Draft file management ----

function findDraftFiles(draftsDir, extensions = ['.md', '.eml', '.txt']) {
  if (!fs.existsSync(draftsDir)) return [];
  return fs
    .readdirSync(draftsDir)
    .filter((f) => extensions.some((ext) => f.endsWith(ext)))
    .map((f) => {
      const fp = path.join(draftsDir, f);
      const stat = fs.statSync(fp);
      return { name: f, path: fp, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

function generateDraftId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

// ---- MCP Server ----

const server = new McpServer({
  name: 'email-triage',
  version: '1.0.0',
});

async function handleReadGmail(args) {
  const limit = Number(args.limit || 10);
  const query = args.query || 'in:inbox';
  const gmail = loadGmailService();

  if (gmail) {
    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: limit,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) {
        return {
          content: [{ type: 'text', text: `No Gmail messages found matching query "${query}".` }],
        };
      }

      const threads = {};
      const emails = [];

      for (const { id } of messages) {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });
        const msg = msgRes.data;
        const headers = extractHeaders(msg);

        if (!threads[msg.threadId]) threads[msg.threadId] = [];
        const email = parseEmailObject(headers, extractBody(msg), msg);
        threads[msg.threadId].push(email);
        emails.push(email);
      }

      emails.sort((a, b) => new Date(b.date) - new Date(a.date));

      const summary = emails.map((e) => ({
        id: e.id,
        threadId: e.threadId,
        from: e.from,
        subject: e.subject,
        date: e.date,
        snippet: e.snippet || e.body.substring(0, 200),
        classification: classifyEmail(e.body),
      }));

      const fullThreadData = Object.entries(threads).map(([tid, msgs]) => ({
        threadId: tid,
        subject: msgs[0]?.subject || '',
        participants: [...new Set(msgs.map((m) => m.from))],
        messages: msgs,
      }));

      return {
        content: [
          { type: 'text', text: `## Gmail Results\n\n**Query:** ${query}\n**Messages found:** ${emails.length}\n**Threads:** ${Object.keys(threads).length}\n\n` },
          { type: 'text', text: '### Summary\n```json\n' + JSON.stringify(summary, null, 2) + '\n```' },
        ],
        structuredContent: { threads: fullThreadData, summary },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Gmail API error: ${err.message}` }],
        isError: true,
      };
    }
  }

  // Fallback: Screenpipe content search
  const screenpipeResults = await searchScreenpipe(query, limit);
  if (screenpipeResults.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text: `## Screenpipe Results (Gmail API unavailable)\n\nQuery: ${query}\nResults: ${screenpipeResults.length}\n\n` +
            screenpipeResults
              .map((r) => `- **${r.title || 'Untitled'}** — ${(r.content || r.text || '').substring(0, 200)}`)
              .join('\n'),
        },
      ],
      structuredContent: { source: 'screenpipe', results: screenpipeResults },
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Gmail OAuth token not found at ${GMAIL_TOKEN_PATH} and Screenpipe returned no results.\n\n` +
          `To enable Gmail reading:\n` +
          `1. Ensure Screenpipe is running: screenpipe record --port 3030\n` +
          `2. Or place Gmail OAuth token at ${GMAIL_TOKEN_PATH}\n` +
          `3. Or use CDP at ${EMAIL_CDP_URL} for Gmail web-app automation (BrowserOS neo)`,
      },
    ],
    structuredContent: { source: 'unavailable', cdpUrl: EMAIL_CDP_URL },
  };
}

// Tool: read_gmail
server.tool(
  'read_gmail',
  'Read recent Gmail messages via the Gmail API. Falls back to Screenpipe content search if Gmail OAuth token is unavailable.',
  {
    query: z.string().describe('Gmail search query (e.g., "is:unread", "from:client@example.com", "label:inbox")').optional().default('in:inbox'),
    limit: z.number().int().describe('Maximum number of messages to return').optional().default(10),
    thread_id: z.string().describe('If set, read messages from this specific thread').optional(),
  },
  handleReadGmail
);

async function handleReadAppleMail(args) {
  const mailbox = args.mailbox || 'Inbox';
  const senderContains = args.senderContains || '';
  const subjectContains = args.subjectContains || '';
  const limit = Number(args.limit || 10);

  const result = readAppleMailMessages({ inbox: mailbox, senderContains, subjectContains, limit });

  // Try parsing as JSON error from osascript
  try {
    const parsed = JSON.parse(result);
    if (parsed.error) {
      return {
        content: [{ type: 'text', text: `Apple Mail error: ${parsed.error}` }],
        isError: true,
      };
    }
  } catch {
    // result is raw text from AppleScript — proceed to parse
  }

  // Parse the AppleScript output into structured messages
  const messages = parseAppleMailOutput(result);

  if (messages.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No messages found in Apple Mail mailbox "${mailbox}"${senderContains ? ` from "${senderContains}"` : ''}${subjectContains ? ` with subject containing "${subjectContains}"` : ''}.`,
      }],
    };
  }

  const summary = messages.map((m) => ({
    id: m['message-id'] || '',
    from: m.from || '',
    subject: m.subject || '(no subject)',
    date: m.date || '',
    snippet: m.body?.substring(0, 200) || '',
    classification: classifyEmail(m.body || ''),
  }));

  return {
    content: [
      { type: 'text', text: `## Apple Mail Results\n\n**Mailbox:** ${mailbox}\n**Messages:** ${messages.length}\n\n` },
      { type: 'text', text: '### Summary\n```json\n' + JSON.stringify(summary, null, 2) + '\n```' },
      {
        type: 'text',
        text: '\n### Full Messages\n' +
          messages
            .map((m) =>
              `---\n**From:** ${m.from || 'unknown'}\n**Subject:** ${m.subject || '(no subject)'}\n**Date:** ${m.date || 'unknown'}\n**Body:**\n${m.body || '(empty)'}\n`,
            )
            .join('\n'),
      },
    ],
    structuredContent: { source: 'apple-mail', mailbox, messages, summary },
  };
}

// Tool: read_apple_mail
server.tool(
  'read_apple_mail',
  'Read recent messages from Apple Mail via AppleScript. Optionally filter by sender or subject.',
  {
    mailbox: z.string().describe('Mailbox name (e.g., "Inbox", "Sent Messages", "Archive")').optional().default('Inbox'),
    senderContains: z.string().describe('Filter messages whose sender contains this text').optional(),
    subjectContains: z.string().describe('Filter messages whose subject contains this text').optional(),
    limit: z.number().int().describe('Maximum messages to read').optional().default(10),
  },
  handleReadAppleMail
);

async function handleClassifyEmail(args) {
  const text = args.email_text || '';
  const classification = classifyEmail(text);

  let explanation = '';
  if (classification.priority === 'high') {
    explanation = 'Contains urgent/ASAP/deadline markers — requires immediate attention.';
  } else if (classification.replyNeeded) {
    explanation = 'Contains action/reply keywords — response recommended.';
  } else if (classification.categories.includes('promotional')) {
    explanation = 'Appears to be promotional/marketing content — low priority.';
  } else if (classification.categories.includes('informational')) {
    explanation = 'Informational/for-your-information — no direct action required.';
  } else {
    explanation = 'General correspondence — standard priority.';
  }

  return {
    content: [
      {
        type: 'text',
        text: `## Email Classification\n\n` +
          `**From:** ${args.from || 'unknown'}\n` +
          `**Subject:** ${args.subject || 'not provided'}\n\n` +
          `### Result\n` +
          `- **Priority:** ${classification.priority}\n` +
          `- **Reply Needed:** ${classification.replyNeeded}\n` +
          `- **Action Required:** ${classification.actionNeeded}\n` +
          `- **Categories:** ${classification.categories.join(', ')}\n` +
          `- **Summary:** ${classification.summary}\n\n` +
          `**Explanation:** ${explanation}`,
      },
    ],
    structuredContent: classification,
  };
}

// Tool: classify_email
server.tool(
  'classify_email',
  'Classify a single email based on its content. Returns priority, action flags, and category labels.',
  {
    email_text: z.string().describe('The full text (subject + body) of the email to classify'),
    from: z.string().describe('Sender email address (optional, for context)').optional(),
    subject: z.string().describe('Email subject line (optional, for context)').optional(),
  },
  handleClassifyEmail
);

async function handleTriageEmails(args) {
  const limit = Number(args.limit_per_source || 10);
  const gmailQuery = args.gmail_query || 'in:inbox';
  const appleMailbox = args.apple_mailbox || 'Inbox';

  // Gather from all sources in parallel
  const gmailPromise = (async () => {
    const gmail = loadGmailService();
    if (!gmail) return { source: 'gmail', messages: [], note: 'Gmail OAuth token not available' };
    try {
      const res = await gmail.users.messages.list({ userId: 'me', q: gmailQuery, maxResults: limit });
      const messages = await Promise.all(
        (res.data.messages || []).map((m) =>
          gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' }).then((r) => {
            const h = extractHeaders(r.data);
            return parseEmailObject(h, extractBody(r.data), r.data);
          }),
        ),
      );
      return { source: 'gmail', messages, messageCount: messages.length };
    } catch (err) {
      return { source: 'gmail', messages: [], error: err.message };
    }
  })();

  const appleRaw = readAppleMailMessages({ inbox: appleMailbox, limit });
  const screenpipeResults = searchScreenpipe(gmailQuery, limit);

  const [gmailResult, screenpipeResultsData] = await Promise.all([gmailPromise, screenpipeResults]);

  // Parse Apple Mail messages
  let appleMessages = [];
  try {
    appleMessages = parseAppleMailOutput(appleRaw);
  } catch (e) {
    // parse error — messages array stays empty
  }

  // Combine and classify all emails
  const allMessages = [
    ...(gmailResult.messages || []).map((m) => ({ ...m, source: 'gmail' })),
    ...appleMessages.map((m) => ({
      id: m['message-id'] || '',
      from: m.from || '',
      subject: m.subject || '',
      date: m.date || '',
      body: m.body || '',
      snippet: m.body?.substring(0, 200) || '',
      source: 'apple-mail',
    })),
  ];

  const triage = allMessages.map((msg) => ({
    id: msg.id,
    source: msg.source,
    from: msg.from,
    subject: msg.subject,
    date: msg.date,
    snippet: msg.snippet,
    classification: classifyEmail(msg.body || msg.snippet || ''),
  }));

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  triage.sort((a, b) => {
    const pa = priorityOrder[a.classification.priority] ?? 1;
    const pb = priorityOrder[b.classification.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.date || 0) - new Date(a.date || 0);
  });

  const counts = {
    high: triage.filter((t) => t.classification.priority === 'high').length,
    medium: triage.filter((t) => t.classification.priority === 'medium').length,
    low: triage.filter((t) => t.classification.priority === 'low').length,
    total: triage.length,
  };

  const summary =
    `## Email Triage Summary\n\n` +
    `**Sources:** Gmail (${gmailResult.messageCount || 0}), Apple Mail (${appleMessages.length}), Screenpipe (${screenpipeResultsData.length})\n` +
    `**Total classified:** ${counts.total}\n` +
    `- **High priority:** ${counts.high}\n` +
    `- **Medium priority:** ${counts.medium}\n` +
    `- **Low priority:** ${counts.low}\n` +
    `- **Reply needed:** ${triage.filter((t) => t.classification.replyNeeded).length}\n` +
    `- **Action required:** ${triage.filter((t) => t.classification.actionNeeded).length}\n\n` +
    `### High Priority Emails\n` +
    (triage
      .filter((t) => t.classification.priority === 'high')
      .slice(0, 5)
      .map(
        (t) =>
          `1. **${t.subject}** — ${t.from} [${t.source}]\n   ${t.classification.summary}\n   ${t.snippet?.substring(0, 150)}`,
      )
      .join('\n\n') || '(none)');

  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: {
      counts,
      triage,
      sources: {
        gmail: gmailResult.messageCount || 0,
        appleMail: appleMessages.length,
        screenpipe: screenpipeResultsData.length,
      },
    },
  };
}

// Tool: triage_emails
server.tool(
  'triage_emails',
  'Read and classify emails from all configured sources (Gmail, Apple Mail, Screenpipe). Returns a prioritized triage view.',
  {
    gmail_query: z.string().describe('Gmail search query').optional().default('in:inbox'),
    apple_mailbox: z.string().describe('Apple Mail mailbox to read').optional().default('Inbox'),
    limit_per_source: z.number().int().describe('Max messages per source').optional().default(10),
  },
  handleTriageEmails
);

async function handleGenerateDraft(args) {
  const draftId = generateDraftId();
  const now = humanTimestamp();
  const filename = `${draftId}_${sanitizeFilename(args.subject || 'draft')}.md`;
  const filepath = path.join(EMAIL_DRAFTS_DIR, filename);

  // Clean, human-readable format — no YAML frontmatter, no bot banners.
  const lines = [
    `To: ${args.to}`,
    `From: ${args.from || 'iganapolsky@gmail.com'}`,
    `Subject: ${args.subject}`,
    `Date: ${now}`,
    `Status: ${'STAGED_FOR_REVIEW'}`,
    `Draft ID: ${draftId}`,
  ];
  if (args.thread_id) lines.push(`Thread ID: ${args.thread_id}`);
  if (args.cc) lines.push(`CC: ${args.cc}`);
  if (args.bcc) lines.push(`BCC: ${args.bcc}`);
  lines.push('', args.body);

  const content = lines.join('\n');
  fs.writeFileSync(filepath, content, 'utf-8');

  // Also create a .eml file for Gmail import
  const emlFilename = `${draftId}_${sanitizeFilename(args.subject || 'draft')}.eml`;
  const emlPath = path.join(EMAIL_DRAFTS_DIR, emlFilename);
  const emlContent = [
    `From: ${args.from || 'iganapolsky@gmail.com'}`,
    `To: ${args.to}`,
    ...(args.cc ? [`Cc: ${args.cc}`] : []),
    ...(args.bcc ? [`Bcc: ${args.bcc}`] : []),
    `Subject: ${args.subject}`,
    `Date: ${now}`,
    '',
    args.body,
    '',
  ].join('\n');
  fs.writeFileSync(emlPath, emlContent, 'utf-8');

  // Run the anti-slop verification script if available
  let verification = 'not-verified';
  try {
    const verifyScript = path.join(
      process.env.HOME || '/Users/iganapolsky',
      'workspace/secure-yolo/scripts/verify-human-paste-anti-slop.sh',
    );
    execSync(`bash "${verifyScript}" check --file "${filepath}"`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    verification = 'passed';
  } catch (e) {
    verification = `failed: ${(e.message || '').split('\n')[0]}`;
  }

  return {
    content: [
      {
        type: 'text',
        text: `## Draft Staged\n\n` +
          `**File:** ${filepath}\n` +
          `**EML:** ${emlPath}\n` +
          `**Draft ID:** ${draftId}\n` +
          `**To:** ${args.to}\n` +
          `**Subject:** ${args.subject}\n` +
          `**Anti-slop verification:** ${verification}\n\n` +
          content,
      },
    ],
    structuredContent: {
      draftId,
      filepath,
      emlPath,
      to: args.to,
      from: args.from || 'iganapolsky@gmail.com',
      subject: args.subject,
      verification,
      status: 'STAGED_FOR_REVIEW',
    },
  };
}

// Tool: generate_draft
server.tool(
  'generate_draft',
  'Generate an email draft response and save it as a markdown file in the email drafts directory. The draft is staged for human review before sending.',
  {
    to: z.string().describe('Recipient email address(es), comma-separated'),
    subject: z.string().describe('Subject line for the draft'),
    body: z.string().describe('Draft body text/markdown'),
    from: z.string().describe('Sender email address').optional().default('iganapolsky@gmail.com'),
    thread_id: z.string().describe('Optional Gmail thread ID to thread the reply').optional(),
    cc: z.string().describe('CC recipients (comma-separated)').optional(),
    bcc: z.string().describe('BCC recipients (comma-separated)').optional(),
  },
  handleGenerateDraft
);

async function handleListDrafts(args) {
  const includeBody = args.include_body || false;
  const limit = Number(args.limit || 50);
  const files = findDraftFiles(EMAIL_DRAFTS_DIR, ['.md']);

  let drafts = files.slice(0, limit).map((f) => {
    const content = fs.readFileSync(f.path, 'utf-8');

    // Parse headers from the email-style format (To:, From:, Subject:, etc.)
    const headerLines = content.split('\n\n')[0]?.split('\n') || [];
    const meta = {};
    for (const line of headerLines) {
      const idx = line.indexOf(': ');
      if (idx > 0) {
        meta[line.substring(0, idx).trim().toLowerCase()] = line.substring(idx + 2).trim();
      }
    }

    // Body is everything after the first blank line
    const headerSection = content.split('\n\n')[0];
    const body = content.substring(headerSection.length + 2);

    return {
      filename: f.name,
      draftId: meta['draft id'] || '',
      to: meta.to || '',
      subject: meta.subject || '',
      from: meta.from || '',
      dateStaged: meta.date || '',
      status: meta.status || 'STAGED_FOR_REVIEW',
      threadId: meta['thread id'] || '',
      cc: meta.cc || '',
      bcc: meta.bcc || '',
      size: f.size,
      modified: f.modified,
      ...(includeBody ? { body: body.trim() } : {}),
    };
  });

  if (args.status) {
    drafts = drafts.filter((d) => d.status === args.status);
  }

  if (drafts.length === 0) {
    return {
      content: [{ type: 'text', text: `No email drafts found in ${EMAIL_DRAFTS_DIR}.` }],
    };
  }

  const summary = drafts
    .map((d) => `- **${d.subject}** → ${d.to} [${d.status}] (${d.dateStaged})`)
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `## Email Drafts (${drafts.length})\n\n${summary}\n\n**Directory:** ${EMAIL_DRAFTS_DIR}`,
      },
    ],
    structuredContent: { drafts, count: drafts.length, directory: EMAIL_DRAFTS_DIR },
  };
}

// Tool: list_drafts
server.tool(
  'list_drafts',
  'List email drafts staged in the email drafts directory.',
  {
    include_body: z.boolean().describe('Include draft body content in the response').optional().default(false),
    status: z.string().describe('Filter by status (STAGED_FOR_REVIEW, SENDING, SENT, etc.)').optional(),
    limit: z.number().int().describe('Maximum drafts to return').optional().default(50),
  },
  handleListDrafts
);

async function handleGenerateSocialDraft(args) {
  const draftId = generateDraftId();
  const now = humanTimestamp();
  const platform = args.platform || 'twitter';
  const filename = `${draftId}_${sanitizeFilename(platform)}.md`;
  const filepath = path.join(SOCIAL_DRAFTS_DIR, filename);

  const tagsLine = args.tags ? `Tags: ${args.tags}` : '';
  const threadSection = args.thread ? `\n\n### Thread\n${args.thread}` : '';

  // Clean format — no YAML frontmatter, no forbidden banners.
  const lines = [
    `Platform: ${platform}`,
    `Date: ${now}`,
    `Status: STAGED_FOR_REVIEW`,
    `Draft ID: ${draftId}`,
  ];
  if (tagsLine) lines.push(tagsLine);
  lines.push('', args.content, threadSection);

  const content = lines.join('\n');
  fs.writeFileSync(filepath, content, 'utf-8');

  return {
    content: [
      {
        type: 'text',
        text: `## Social Draft Staged\n\n` +
          `**Platform:** ${platform}\n` +
          `**File:** ${filepath}\n` +
          `**Draft ID:** ${draftId}\n\n` +
          content,
      },
    ],
    structuredContent: {
      draftId,
      filepath,
      platform,
      dateStaged: now,
      status: 'STAGED_FOR_REVIEW',
    },
  };
}

// Tool: generate_social_draft
server.tool(
  'generate_social_draft',
  'Generate a social media post draft and save it in the social drafts directory. Used for X/Twitter, LinkedIn, or other platform posts.',
  {
    platform: z.string().describe('Target platform (twitter, linkedin, mastodon, etc.)').optional().default('twitter'),
    content: z.string().describe('The social media post content'),
    thread: z.string().describe('Optional thread context (JSON array of post objects)').optional(),
    tags: z.string().describe('Comma-separated hashtags or tags').optional(),
  },
  handleGenerateSocialDraft
);

// ---- Start the server ----

const transport = new StdioServerTransport();
server.connect(transport);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
