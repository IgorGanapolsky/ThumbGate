#!/usr/bin/env node
/**
 * fabric-sync.js
 * 
 * Layer 6: Enterprise OneLake Bridge
 * Prepares and streams RLHF memory logs for ingestion into Microsoft Fabric OneLake.
 */

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths } = require('./feedback-loop');

function syncToFabric() {
  const paths = getFeedbackPaths();
  const logPath = paths.MEMORY_LOG_PATH;
  
  if (!fs.existsSync(logPath)) {
    process.stderr.write('🤖 [Layer 6] No memory log found for Fabric sync.\n');
    return null;
  }

  process.stderr.write('🤖 [Layer 6] Transforming logs for Fabric OneLake ingestion...\n');
  
  const rawLogs = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
  const structuredData = rawLogs.map(line => {
    try {
      const entry = JSON.parse(line);
      return {
        timestamp: entry.timestamp || new Date().toISOString(),
        action: entry.action || 'unknown',
        domain: entry.metadata?.domain || 'general',
        outcome: entry.metadata?.outcome || 'learning',
        source: 'mcp-memory-gateway',
        governance_layer: entry.metadata?.layer || 'Execution',
        fabric_ontology_match: 'AgenticGovernance/Reliability'
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  const fabricExportPath = path.join(paths.FEEDBACK_DIR, 'fabric-ingestion-v1.json');
  fs.writeFileSync(fabricExportPath, JSON.stringify(structuredData, null, 2));
  
  process.stderr.write(`✅ [Layer 6] Enterprise sync ready: ${structuredData.length} events structured for OneLake.\n`);
  return fabricExportPath;
}

if (require.main === module) {
  syncToFabric();
}

module.exports = { syncToFabric };
