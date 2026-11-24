'use strict';

/**
 * AppleScript injection regression tests for the email-triage MCP server.
 *
 * Tool arguments (mailbox, senderContains, subjectContains) used to be placed
 * inside AppleScript double-quoted literals unescaped, so a double quote
 * closed the literal and `do shell script` ran a command. These tests prove
 * the payload stays inside the literal, the shell never runs, and normal
 * values still build the same script.
 *
 * The execution tests run only `return <literal>` through osascript. They do
 * not open Mail and the only side effect a payload could have is a marker
 * file in a fresh temp directory.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Isolate the drafts dirs the module creates on import.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-email-triage-'));
process.env.EMAIL_DRAFTS_DIR = path.join(scratch, 'email');
process.env.SOCIAL_DRAFTS_DIR = path.join(scratch, 'social');

// The server ships with its own dependencies (zod, the MCP SDK), which the
// repo does not install. Stub just those two while importing the helpers.
const Module = require('node:module');
const realLoad = Module._load;
const inert = new Proxy(function inertTarget() {}, {
  get: (_target, prop) => (prop === 'then' ? undefined : inert),
  apply: () => inert,
  construct: () => inert,
});
Module._load = function stubbedLoad(request, ...rest) {
  if (request === 'zod') return { z: inert };
  if (request.startsWith('@modelcontextprotocol/sdk/')) {
    return { McpServer: class { tool() {} connect() {} }, StdioServerTransport: class {} };
  }
  return realLoad.call(this, request, ...rest);
};
let helpers;
try {
  helpers = require('../src/mcp/email-triage-server/index');
} finally {
  Module._load = realLoad;
}
const {
  buildAppleMailScript,
  escapeAppleScriptString,
  appleScriptStringLiteral,
  boundedInteger,
} = helpers;

// The script the server built before the fix, for the "same script" checks.
function legacyScript({ inbox = 'Inbox', senderContains = '', subjectContains = '', limit = 10 }) {
  let conditions = '';
  if (senderContains) {
    conditions = `whose sender contains "${senderContains}"`;
  } else if (subjectContains) {
    conditions = `whose subject contains "${subjectContains}"`;
  }
  const mailboxClause = inbox ? `of mailbox "${inbox}"` : '';
  return `
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
}

// Reads one AppleScript double-quoted literal from the start of `text`,
// honouring backslash escapes. Returns the decoded value and the rest of the
// text, or throws if the literal is not closed by the final quote.
function readLiteral(text) {
  assert.equal(text[0], '"', 'literal must open with a quote');
  let value = '';
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      value += text[i + 1];
      i += 1;
    } else if (ch === '"') {
      return { value, rest: text.slice(i + 1) };
    } else {
      value += ch;
    }
  }
  throw new Error('unterminated literal');
}

function senderLiteral(script, keyword) {
  const line = script.split('\n').find((l) => l.includes(`whose ${keyword} contains `));
  assert.ok(line, `no ${keyword} clause in script`);
  return line.slice(line.indexOf(`whose ${keyword} contains `) + `whose ${keyword} contains `.length);
}

const HAS_OSASCRIPT = process.platform === 'darwin' && fs.existsSync('/usr/bin/osascript');

function runReturn(literalExpr) {
  return execFileSync('/usr/bin/osascript', ['-e', `return ${literalExpr}`], {
    encoding: 'utf8',
    timeout: 15000,
  }).replace(/\n$/, '');
}

function markerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-applescript-'));
}

function injection(marker) {
  return `" & (do shell script "touch ${marker}") & "`;
}

// ---- the eight required cases ----

test('quote in a sender stays inside the literal', () => {
  const payload = 'a"b';
  const script = buildAppleMailScript({ senderContains: payload });
  const { value, rest } = readLiteral(senderLiteral(script, 'sender'));
  assert.equal(value, payload);
  assert.match(rest, /^ of mailbox "Inbox"$/);
});

test('backslash in a subject is doubled, so it cannot escape the closing quote', () => {
  const payload = 'ends with backslash\\';
  const script = buildAppleMailScript({ subjectContains: payload });
  const { value, rest } = readLiteral(senderLiteral(script, 'subject'));
  assert.equal(value, payload);
  assert.match(rest, /^ of mailbox "Inbox"$/);
});

test('newline, carriage return, tab, NUL and Unicode line separators are rejected', () => {
  for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a b', 'a b', 'a\u0085b']) {
    assert.throws(() => buildAppleMailScript({ subjectContains: bad }), /control characters or line breaks/, JSON.stringify(bad));
  }
});

test('the do-shell-script breakout payload stays inside the literal in all three fields', () => {
  const payload = injection('/tmp/never-created');
  for (const field of ['senderContains', 'subjectContains']) {
    const script = buildAppleMailScript({ [field]: payload });
    const keyword = field === 'senderContains' ? 'sender' : 'subject';
    const { value, rest } = readLiteral(senderLiteral(script, keyword));
    assert.equal(value, payload, field);
    assert.match(rest, /^ of mailbox "Inbox"$/, field);
  }
  const mailboxScript = buildAppleMailScript({ inbox: payload });
  const line = mailboxScript.split('\n').find((l) => l.includes('of mailbox '));
  const { value, rest } = readLiteral(line.slice(line.indexOf('of mailbox ') + 'of mailbox '.length));
  assert.equal(value, payload);
  assert.equal(rest, '');
});

test('Unicode values pass through unchanged', () => {
  const payload = 'Rechnung für Zoë 北京 ✓';
  const script = buildAppleMailScript({ subjectContains: payload });
  assert.equal(readLiteral(senderLiteral(script, 'subject')).value, payload);
});

test('empty filters build the same script as before', () => {
  assert.equal(buildAppleMailScript({}), legacyScript({}));
  assert.equal(buildAppleMailScript({ senderContains: '', subjectContains: '' }), legacyScript({}));
});

test('a normal subject builds the same script as before', () => {
  const opts = { subjectContains: 'Invoice 2026-11', inbox: 'Inbox', limit: 25 };
  assert.equal(buildAppleMailScript(opts), legacyScript(opts));
});

test('a normal sender and mailbox build the same script as before', () => {
  const opts = { senderContains: 'emma@example.com', inbox: 'Sent Messages', limit: 10 };
  assert.equal(buildAppleMailScript(opts), legacyScript(opts));
});

// ---- extra coverage ----

test('limit is coerced to a bounded whole number and never carries text into the script', () => {
  assert.equal(boundedInteger('5; do shell script "x"'), 10);
  assert.equal(boundedInteger(NaN), 10);
  assert.equal(boundedInteger(7.9), 7);
  assert.equal(boundedInteger(-3), 0);
  assert.equal(boundedInteger(10 ** 9), 1000);
  const script = buildAppleMailScript({ limit: '1 & (do shell script "x")' });
  assert.match(script, /repeat with i from 1 to 10\n/);
  assert.ok(!script.includes('do shell script'));
});

test('escaper escapes the backslash before the quote', () => {
  assert.equal(escapeAppleScriptString('\\"'), '\\\\\\"');
  assert.equal(appleScriptStringLiteral('f', 'x"y\\z'), '"x\\"y\\\\z"');
});

// ---- real interpreter: only where osascript exists ----

test('payload does not run: osascript returns it as text and no marker is created', { skip: !HAS_OSASCRIPT }, () => {
  const dir = markerDir();
  const marker = path.join(dir, 'ran');
  const payload = injection(marker);
  const script = buildAppleMailScript({ senderContains: payload });
  const expr = senderLiteral(script, 'sender').replace(/ of mailbox "Inbox"$/, '');
  assert.equal(runReturn(expr), payload);
  assert.equal(fs.existsSync(marker), false, 'marker file must not exist');
});

test('control: the old unescaped interpolation does run the payload', { skip: !HAS_OSASCRIPT }, () => {
  const dir = markerDir();
  const marker = path.join(dir, 'ran');
  const oldScript = legacyScript({ senderContains: injection(marker) });
  const expr = senderLiteral(oldScript, 'sender').replace(/ of mailbox "Inbox"$/, '');
  runReturn(expr);
  assert.equal(fs.existsSync(marker), true, 'the legacy template executes the injected command');
});

// ---- the server still starts when run as the program ----

test('the server starts when run directly and through a symlink, and not when required', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-entry-'));
  const preload = path.join(dir, 'preload.js');
  fs.writeFileSync(preload, `
const Module = require('node:module');
const real = Module._load;
const inert = new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : inert), apply: () => inert, construct: () => inert });
Module._load = function (request, ...rest) {
  if (request === 'zod') return { z: inert };
  if (request.startsWith('@modelcontextprotocol/sdk/')) {
    return { McpServer: class { tool() {} connect() { process.stdout.write('CONNECTED\\n'); } }, StdioServerTransport: class {} };
  }
  return real.call(this, request, ...rest);
};
`);
  const target = path.join(__dirname, '..', 'src', 'mcp', 'email-triage-server', 'index.js');
  const link = path.join(dir, 'email-triage-server');
  fs.symlinkSync(target, link);
  const env = { ...process.env, EMAIL_DRAFTS_DIR: path.join(dir, 'e'), SOCIAL_DRAFTS_DIR: path.join(dir, 's') };
  const run = (args) => execFileSync(process.execPath, ['-r', preload, ...args], { encoding: 'utf8', env, timeout: 15000 });
  assert.match(run([target]), /CONNECTED/);
  assert.match(run([link]), /CONNECTED/);
  assert.equal(run(['-e', `require(${JSON.stringify(target)})`]), '');
});
