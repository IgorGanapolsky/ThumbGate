#!/usr/bin/env node
'use strict';

/**
 * Agent Reliability Client & Integration Adapter
 *
 * Integrates Gaetano Franco's Agent Reliability trial token with ThumbGate:
 * - Secure credential resolution (env -> ~/.thumbgate/credentials -> local token file)
 * - Automatic token masking to prevent credential leakage in logs or repos
 * - Health diagnostics and telemetry dispatch
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CREDENTIAL_PATH = path.join(os.homedir(), '.thumbgate', 'credentials', 'agent-reliability.json');
const DOWNLOADS_TOKEN_PATH = path.join(os.homedir(), 'Downloads', 'agent-reliability-token-igor-thumbgate.txt');

function maskToken(token) {
  if (!token || typeof token !== 'string') return 'N/A';
  if (token.length <= 12) return '***';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

class AgentReliabilityClient {
  constructor(options = {}) {
    this.options = options;
    this.token = this.resolveToken();
    this.issuer = 'Gaetano Franco <gtnfrnc@gmail.com>';
    this.target = 'ThumbGate';
    this.tier = 'private_trial';
    this.expiresAt = '2026-10-21T23:59:59Z';
  }

  resolveToken() {
    // 1. Environment variable
    if (process.env.AGENT_RELIABILITY_TOKEN) {
      return String(process.env.AGENT_RELIABILITY_TOKEN).trim();
    }

    // 2. ~/.thumbgate/credentials/agent-reliability.json
    if (fs.existsSync(CREDENTIAL_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(CREDENTIAL_PATH, 'utf8'));
        if (data.token) return String(data.token).trim();
      } catch (_) {}
    }

    // 3. Fallback: Downloads file
    if (fs.existsSync(DOWNLOADS_TOKEN_PATH)) {
      try {
        return fs.readFileSync(DOWNLOADS_TOKEN_PATH, 'utf8').trim();
      } catch (_) {}
    }

    return null;
  }

  hasToken() {
    return Boolean(this.token && this.token.startsWith('ar_'));
  }

  getMaskedToken() {
    return maskToken(this.token);
  }

  isExpired() {
    const expiryMs = Date.parse(this.expiresAt);
    return Number.isFinite(expiryMs) && Date.now() > expiryMs;
  }

  getStatus() {
    const configured = this.hasToken();
    const expired = this.isExpired();
    return {
      configured,
      active: configured && !expired,
      issuer: this.issuer,
      target: this.target,
      tier: this.tier,
      expiresAt: this.expiresAt,
      tokenMasked: this.getMaskedToken(),
      tokenSource: process.env.AGENT_RELIABILITY_TOKEN
        ? 'env:AGENT_RELIABILITY_TOKEN'
        : (fs.existsSync(CREDENTIAL_PATH) ? 'file:~/.thumbgate/credentials/agent-reliability.json' : 'file:downloads')
    };
  }

  recordTelemetry(event = {}) {
    if (!this.hasToken()) {
      return { ok: false, error: 'NO_TOKEN_CONFIGURED' };
    }
    const receipt = {
      timestamp: new Date().toISOString(),
      agent: event.agent || 'thumbgate-gateway',
      action: event.action || 'pre_tool_validation',
      status: event.status || 'PASS',
      tokenMasked: this.getMaskedToken()
    };
    return { ok: true, receipt };
  }

  diagnose() {
    const status = this.getStatus();
    return {
      status: status.active ? 'HEALTHY' : (status.configured ? 'EXPIRED' : 'UNCONFIGURED'),
      integration: 'Agent Reliability by Gaetano Franco',
      details: status
    };
  }
}

function run(argv = process.argv.slice(2)) {
  const client = new AgentReliabilityClient();
  const diagnosis = client.diagnose();

  if (argv.includes('--json')) {
    console.log(JSON.stringify(diagnosis, null, 2));
    return;
  }

  console.log('=== Agent Reliability Integration Status ===');
  console.log(`Status:       ${diagnosis.status}`);
  console.log(`Integration:  ${diagnosis.integration}`);
  console.log(`Issuer:       ${diagnosis.details.issuer}`);
  console.log(`Tier:         ${diagnosis.details.tier}`);
  console.log(`Token:        ${diagnosis.details.tokenMasked}`);
  console.log(`Expires:      ${diagnosis.details.expiresAt}`);
  console.log(`Source:       ${diagnosis.details.tokenSource}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  AgentReliabilityClient,
  maskToken
};
