#!/usr/bin/env node
/**
 * Feedback capture fallback — captures feedback via REST API when MCP tools are unavailable.
 *
 * Usage (from hooks or scripts):
 *   echo '{"signal":"down","context":"..."}' | node scripts/feedback-fallback.js
 *   node scripts/feedback-fallback.js --signal=up --context="Great work"
 *
 * Tries localhost Pro dashboard first, then production API.
 * Returns JSON result on stdout, errors on stderr.
 */
'use strict';

const http = require('http');
const https = require('https');

const ENDPOINTS = [
  { url: 'http://localhost:9876/v1/feedback/capture', key: 'tg_creator_dev_enterprise', label: 'local' },
  { url: 'http://localhost:3456/v1/feedback/capture', key: 'tg_creator_dev_enterprise', label: 'local-alt' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function postJSON(endpoint, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint.url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${endpoint.key}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ...json, _endpoint: endpoint.label });
        } catch {
          reject(new Error(`Invalid JSON from ${endpoint.label}: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function main() {
  let body;
  const cliArgs = parseArgs();

  if (cliArgs.signal) {
    body = {
      signal: cliArgs.signal,
      context: cliArgs.context || 'Captured via REST fallback',
      whatWentWrong: cliArgs.whatWentWrong || undefined,
      whatWorked: cliArgs.whatWorked || undefined,
      tags: cliArgs.tags ? cliArgs.tags.split(',') : ['rest-fallback'],
    };
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = Buffer.concat(chunks).toString('utf8').trim();
    if (!input) {
      process.stderr.write('No input. Pass --signal=up/down or pipe JSON to stdin.\n');
      process.exit(1);
    }
    body = JSON.parse(input);
    if (!body.tags) body.tags = [];
    if (!body.tags.includes('rest-fallback')) body.tags.push('rest-fallback');
  }

  for (const endpoint of ENDPOINTS) {
    try {
      const result = await postJSON(endpoint, body);
      process.stdout.write(JSON.stringify(result) + '\n');
      return;
    } catch (err) {
      process.stderr.write(`[fallback] ${endpoint.label} failed: ${err.message}\n`);
    }
  }

  process.stderr.write('[fallback] All endpoints failed. Feedback NOT captured.\n');
  process.exit(1);
}

main().catch(err => {
  process.stderr.write(`[fallback] ${err.message}\n`);
  process.exit(1);
});
