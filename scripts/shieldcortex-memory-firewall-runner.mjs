#!/usr/bin/env node

import { readFileSync } from 'node:fs';

async function main() {
  try {
    const raw = readFileSync(0, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    const { record = {}, options = {} } = parsed;

    const { ShieldCortexGuardedMemoryBridge } = await import('shieldcortex');

    const backend = {
      name: 'mcp-memory-gateway-ingress',
      async save() {
        return { id: 'memory-ingress-probe' };
      },
    };

    const bridge = new ShieldCortexGuardedMemoryBridge(backend, {
      mode: options.mode ?? 'strict',
      sourceType: options.sourceType ?? 'hook',
      sourceIdentifier: options.sourceIdentifier ?? 'feedback-loop',
      blockOnThreat: true,
    });

    const result = await bridge.save(record);
    const defence = result.defence || {};
    const firewall = defence.firewall || {};

    process.stdout.write(JSON.stringify({
      available: true,
      allowed: Boolean(result.allowed),
      provider: 'shieldcortex',
      mode: options.mode ?? 'strict',
      reason: result.reason || firewall.reason || 'ShieldCortex decision completed.',
      threatIndicators: Array.isArray(firewall.threatIndicators) ? firewall.threatIndicators : [],
      blockedPatterns: Array.isArray(firewall.blockedPatterns) ? firewall.blockedPatterns : [],
      firewallResult: firewall.result || null,
      anomalyScore: firewall.anomalyScore ?? null,
      sensitivityLevel: defence.sensitivity ? defence.sensitivity.level : null,
      trustScore: defence.trust ? defence.trust.score : null,
      auditId: defence.auditId ?? null,
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      available: false,
      error: error.message,
    }));
  }
}

await main();
