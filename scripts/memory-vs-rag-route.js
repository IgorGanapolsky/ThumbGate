#!/usr/bin/env node
'use strict';

/**
 * memory-vs-rag-route.js — Supermemory process steal (NOT a product clone).
 *
 * RAG answers "what do I know?" (graphify/docs/code).
 * Memory answers "what do I remember about you?" (scoped lesson store).
 *
 * Usage:
 *   node scripts/memory-vs-rag-route.js --query "how does PreToolUse work?"
 *   node scripts/memory-vs-rag-route.js --query "what did we decide about checkout?" \
 *     --entity alice --project thumbgate --process coder --session s1 --json
 *   node scripts/memory-vs-rag-route.js --profile --entity ... --json < records.json
 *   node scripts/memory-vs-rag-route.js --dreaming instant --json
 */

const fs = require('fs');
const path = require('path');
const {
  buildLessonProfile,
  encodeContainerTag,
  resolveDreamingMode,
  routeMemoryVsRag,
} = require('./memory-scope-readiness');

function parseArgs(argv) {
  const out = {
    query: '',
    json: false,
    profile: false,
    dreaming: null,
    forceRail: null,
    help: false,
    entityId: null,
    projectId: null,
    processId: null,
    sessionId: null,
    containerTag: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--profile') out.profile = true;
    else if (arg === '--query' && next) { out.query = next; i += 1; }
    else if (arg === '--dreaming' && next) { out.dreaming = next; i += 1; }
    else if (arg === '--force-rail' && next) { out.forceRail = next; i += 1; }
    else if (arg === '--entity' && next) { out.entityId = next; i += 1; }
    else if (arg === '--project' && next) { out.projectId = next; i += 1; }
    else if (arg === '--process' && next) { out.processId = next; i += 1; }
    else if (arg === '--session' && next) { out.sessionId = next; i += 1; }
    else if (arg === '--container-tag' && next) { out.containerTag = next; i += 1; }
    else if (!arg.startsWith('-') && !out.query) out.query = arg;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return out;
}

function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function printHelp() {
  console.log(`Usage: node scripts/memory-vs-rag-route.js [options]

Options:
  --query <text>         Question to route (rag | memory | hybrid)
  --entity/--project/--process/--session
  --container-tag <tag>  Four-field encoded tag from encodeContainerTag
  --force-rail rag|memory|hybrid
  --dreaming dynamic|instant
  --profile              Build static+dynamic lesson profile (stdin JSON array)
  --json
  --help
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const scope = {
    entityId: args.entityId,
    projectId: args.projectId,
    processId: args.processId,
    sessionId: args.sessionId,
    containerTag: args.containerTag,
  };

  if (args.dreaming && !args.query && !args.profile) {
    const result = resolveDreamingMode({ dreaming: args.dreaming });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`dreaming=${result.mode} immediate=${result.promoteImmediately}`);
    process.exitCode = 0;
    return;
  }

  if (args.profile) {
    const stdin = readStdinJson();
    const records = Array.isArray(stdin) ? stdin : (stdin?.records || []);
    const result = buildLessonProfile(records, scope);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.ok ? 'profile: OK' : `profile: FAIL ${result.reason}`);
      console.log(`static=${result.profile.static.length} dynamic=${result.profile.dynamic.length}`);
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const route = routeMemoryVsRag(args.query, { ...scope, forceRail: args.forceRail });
  const dreaming = resolveDreamingMode({ dreaming: args.dreaming || 'dynamic' });
  const encoded = encodeContainerTag(scope);
  const result = { ...route, dreaming, encodedContainerTag: encoded };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`rail=${result.rail} ok=${result.ok}`);
    console.log(`reason=${result.reason}`);
    if (result.error) console.log(`error=${result.error}`);
    console.log(`recommended=${result.recommended.join(', ')}`);
    if (result.containerTag) console.log(`containerTag=${result.containerTag}`);
  }
  process.exitCode = result.ok ? 0 : 2;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    main();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  main,
};
