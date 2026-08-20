#!/usr/bin/env node
'use strict';

/**
 * ThumbGate WriteGuard CLI & Gateway Runner
 */

const fs = require('fs');
const path = require('path');
const {
  evaluateMcpCall,
  exportCloudflareWriteGuardPolicy,
  classifyMcpTool,
} = require('../src/mcp-writeguard.js');

function parseArgs(args) {
  const options = {
    eval: null,
    tool: null,
    params: {},
    server: 'default',
    exportPolicy: false,
    json: false,
    auditLog: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--export-policy') {
      options.exportPolicy = true;
    } else if (arg === '--tool') {
      options.tool = args[++i];
    } else if (arg === '--server') {
      options.server = args[++i];
    } else if (arg === '--params') {
      try {
        options.params = JSON.parse(args[++i]);
      } catch (err) {
        options.params = { raw: args[i] };
      }
    } else if (arg === '--eval') {
      try {
        options.eval = JSON.parse(args[++i]);
      } catch (err) {
        console.error('Invalid JSON for --eval:', err.message);
        process.exit(1);
      }
    } else if (arg === '--audit-log') {
      options.auditLog = args[++i];
    }
  }

  return options;
}

function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(`ThumbGate WriteGuard — Fine-Grained MCP Pre-Action Security Layer

Usage:
  thumbgate writeguard --tool <name> [--params <json>] [--json]
  thumbgate writeguard --eval <json-request> [--json]
  thumbgate writeguard --export-policy [--json]

Options:
  --tool <name>       Tool name to evaluate
  --params <json>     JSON parameters passed to tool
  --server <name>     MCP server name (default: "default")
  --eval <json>       Full MCP call envelope to evaluate
  --export-policy     Export Cloudflare WriteGuard compatible JSON policy
  --audit-log <path>  Append scrubbed attribution event to audit file
  --json              Emit structured JSON output
  --help, -h          Show this help text
`);
    process.exit(0);
  }

  if (opts.exportPolicy) {
    const standardTools = [
      'view_file',
      'grep_search',
      'list_dir',
      'find_by_name',
      'read_url_content',
      'search_web',
      'write_to_file',
      'replace_file_content',
      'run_command',
      'manage_task',
      'set_branch_governance',
      'approve_protected_action',
      'capture_feedback',
    ];
    const policy = exportCloudflareWriteGuardPolicy(standardTools);
    console.log(JSON.stringify(policy, null, 2));
    process.exit(0);
  }

  const callRequest = opts.eval || {
    server: opts.server,
    tool: opts.tool || 'view_file',
    parameters: opts.params,
    context: {
      user: process.env.USER || 'operator',
      client: 'cli',
      sessionId: process.env.THUMBGATE_SESSION_AGENT || 'local-cli',
    },
  };

  const receipt = evaluateMcpCall(callRequest);

  if (opts.auditLog) {
    try {
      const line = JSON.stringify(receipt) + '\n';
      fs.appendFileSync(opts.auditLog, line);
    } catch (err) {
      console.error(`Warning: Failed to write audit log: ${err.message}`);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    console.log(`\n🛡️  ThumbGate WriteGuard Intercept: ${receipt.tool}`);
    console.log(`──────────────────────────────────────────────`);
    console.log(`  Decision   : ${receipt.decision.toUpperCase()}`);
    console.log(`  Risk Tier  : ${receipt.riskTier}`);
    console.log(`  Event ID   : ${receipt.eventId}`);
    console.log(`  User/Client: ${receipt.user} (${receipt.client})`);
    if (receipt.reasons.length > 0) {
      console.log(`  Reasons    : ${receipt.reasons.join('; ')}`);
    }
    console.log(`  Duration   : ${receipt.durationMs}ms\n`);
  }

  if (receipt.decision === 'blocked') {
    process.exit(2);
  } else if (receipt.decision === 'escalated') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
