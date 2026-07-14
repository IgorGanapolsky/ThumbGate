#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_CONFIG = path.join(__dirname, '..', 'sales', 'apollo-buyer-search.json');
const DEFAULT_INPUT = path.join(
  process.env.HOME || '',
  'Downloads',
  'ThumbGate_Client_Acquisition_July_2026.csv'
);

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    config: DEFAULT_CONFIG,
    input: DEFAULT_INPUT,
    output: null,
    execute: false,
    maxTargets: null,
    perPage: 25,
    includeTracker: true,
    includeOrganizations: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--skip-tracker') options.includeTracker = false;
    else if (arg === '--skip-organizations') options.includeOrganizations = false;
    else if (arg === '--input') options.input = argv[++index];
    else if (arg === '--config') options.config = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--max-targets') options.maxTargets = Number.parseInt(argv[++index], 10);
    else if (arg === '--per-page') options.perPage = Number.parseInt(argv[++index], 10);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.perPage) || options.perPage < 1 || options.perPage > 100) {
    throw new Error('--per-page must be an integer from 1 to 100');
  }
  if (options.maxTargets !== null && (!Number.isInteger(options.maxTargets) || options.maxTargets < 1)) {
    throw new Error('--max-targets must be a positive integer');
  }
  return options;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function obfuscatedSurnameMatches(expectedSurname, candidateSurname) {
  const expected = normalize(expectedSurname).replace(/[^a-z0-9]/g, '');
  const candidate = normalize(candidateSurname).replace(/[^a-z0-9*]/g, '');
  if (!expected || !candidate) return false;
  if (!candidate.includes('*')) return candidate === expected;
  const [prefix = '', suffix = ''] = candidate.split(/\*+/);
  return expected.startsWith(prefix) && expected.endsWith(suffix);
}

function knownTargetIdentityMatches(targetName, candidate = {}) {
  const nameParts = normalize(targetName).split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) return false;
  const expectedFirstName = nameParts[0];
  const expectedSurname = nameParts.at(-1);
  return normalize(candidate.firstName) === expectedFirstName
    && obfuscatedSurnameMatches(expectedSurname, candidate.lastNameObfuscated);
}

function suppressDuplicateOutreach(status) {
  return /contacted|routed|pending|invitation|sent|replied|booked|paid/i.test(String(status || ''));
}

function buildSearchPlan({ rows = [], config = {}, options = {} } = {}) {
  const organizations = Array.isArray(config.organizations) ? config.organizations : [];
  const organizationByName = new Map(organizations.map((entry) => [normalize(entry.name), entry]));
  const limitedRows = options.maxTargets ? rows.slice(0, options.maxTargets) : rows;
  const trackerSearches = options.includeTracker === false ? [] : limitedRows.map((row) => {
    const organization = organizationByName.get(normalize(row.organization));
    return {
      kind: 'known_target',
      campaignId: row.campaign_id || null,
      targetName: row.target_name,
      organization: row.organization || null,
      domain: organization?.domain || null,
      existingStatus: row.status || null,
      suppressDuplicateOutreach: suppressDuplicateOutreach(row.status),
      buyerSignal: row.buyer_signal || null,
      notes: row.notes || null,
    };
  }).filter((entry) => entry.targetName);

  const organizationSearches = options.includeOrganizations === false ? [] : organizations.map((organization) => ({
    kind: 'organization_buyer_scan',
    organization: organization.name,
    domain: organization.domain,
    reason: organization.reason,
    titles: config.titles || [],
    seniority: config.seniority || [],
  }));

  return {
    buyerHypothesis: config.buyerHypothesis || null,
    trackerSearches,
    organizationSearches,
  };
}

function runApollo(args, { runner = spawnSync } = {}) {
  const result = runner('apollo', args, {
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`apollo ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Apollo returned invalid JSON: ${error.message}`);
  }
}

function readCreditSnapshot(dependencies = {}) {
  return runApollo(['usage', 'credits', '--format', 'json'], dependencies);
}

function creditConsumption(snapshot = {}) {
  const stats = snapshot.credit_usage_stats || {};
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value?.consumed || 0)]));
}

function creditDelta(before = {}, after = {}) {
  const beforeUsage = creditConsumption(before);
  const afterUsage = creditConsumption(after);
  const keys = new Set([...Object.keys(beforeUsage), ...Object.keys(afterUsage)]);
  return Object.fromEntries([...keys].map((key) => [key, (afterUsage[key] || 0) - (beforeUsage[key] || 0)]));
}

function peopleFromResponse(response = {}) {
  return Array.isArray(response.people) ? response.people : [];
}

function searchKnownTarget(spec, dependencies = {}) {
  const baseArgs = ['people', 'search', '--query', spec.targetName, '--per-page', '10', '--format', 'json'];
  if (spec.domain) {
    const domainResponse = runApollo([
      'people', 'search', '--query', spec.targetName,
      '--domain', spec.domain, '--per-page', '10', '--format', 'json',
    ], dependencies);
    if (peopleFromResponse(domainResponse).length) {
      return { response: domainResponse, strategy: 'name_and_domain' };
    }
  }
  return { response: runApollo(baseArgs, dependencies), strategy: 'name_only' };
}

function searchOrganizationBuyers(spec, perPage, dependencies = {}) {
  const args = [
    'people', 'search',
    '--domain', spec.domain,
    '--title', ...spec.titles,
    '--include-similar-titles',
    '--seniority', ...spec.seniority,
    '--per-page', String(perPage),
    '--format', 'json',
  ];
  return runApollo(args, dependencies);
}

function sanitizeCandidate(person = {}) {
  return {
    apolloId: person.id || null,
    firstName: person.first_name || null,
    lastNameObfuscated: person.last_name_obfuscated || null,
    title: person.title || null,
    organization: person.organization?.name || null,
    hasEmail: Boolean(person.has_email),
    hasDirectPhone: person.has_direct_phone === 'Yes',
    lastRefreshedAt: person.last_refreshed_at || null,
  };
}

function scoreOrganizationCandidate(candidate = {}) {
  const title = normalize(candidate.title);
  let score = 0;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  if (/chief ai officer/.test(title)) add(35, 'chief_ai_owner');
  else if (/\b(evp|svp|vice president|vp)\b/.test(title)) add(30, 'executive_owner');
  else if (/\b(managing director|group director|executive director|director)\b/.test(title)) add(22, 'director_owner');
  if (/ai governance|responsible ai|product compliance/.test(title)) add(30, 'governance_pain_owner');
  if (/ai platform|agentic|ai integration/.test(title)) add(25, 'agent_platform_owner');
  if (/ai transformation|intelligent automation/.test(title)) add(20, 'transformation_owner');
  if (/enterprise architecture|developer experience|developer productivity/.test(title)) add(15, 'architecture_or_developer_owner');
  if (candidate.hasEmail) add(5, 'business_email_available');

  return { priorityScore: score, priorityReasons: reasons };
}

function executeSearchPlan(plan, { perPage = 25, ...dependencies } = {}) {
  const beforeCredits = readCreditSnapshot(dependencies);
  const trackerResults = plan.trackerSearches.map((spec) => {
    const { response, strategy } = searchKnownTarget(spec, dependencies);
    const candidates = peopleFromResponse(response)
      .map(sanitizeCandidate)
      .filter((candidate) => knownTargetIdentityMatches(spec.targetName, candidate))
      .filter((candidate) => !spec.organization || normalize(candidate.organization) === normalize(spec.organization));
    return {
      ...spec,
      searchStrategy: strategy,
      totalEntries: Number(response.total_entries || 0),
      identityMatchCount: candidates.length,
      candidates,
    };
  });
  const organizationResults = plan.organizationSearches.map((spec) => {
    const response = searchOrganizationBuyers(spec, perPage, dependencies);
    const candidates = peopleFromResponse(response)
      .map(sanitizeCandidate)
      .map((candidate) => ({ ...candidate, ...scoreOrganizationCandidate(candidate) }))
      .sort((left, right) => right.priorityScore - left.priorityScore);
    return {
      ...spec,
      totalEntries: Number(response.total_entries || 0),
      candidates,
    };
  });
  const afterCredits = readCreditSnapshot(dependencies);
  const delta = creditDelta(beforeCredits, afterCredits);
  const consumed = Object.entries(delta).filter(([, value]) => value > 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'search_only',
    safety: {
      createsContacts: false,
      enrichesPeople: false,
      enrollsSequences: false,
      sendsMessages: false,
      duplicateOutreachSuppressed: true,
      creditDelta: delta,
      zeroCreditSearchVerified: consumed.length === 0,
    },
    buyerHypothesis: plan.buyerHypothesis,
    trackerResults,
    organizationResults,
    credits: {
      before: beforeCredits,
      after: afterCredits,
    },
  };
}

function renderMarkdown(report) {
  const rows = report.organizationResults.flatMap((organization) => organization.candidates.map((candidate) => ({
    ...candidate,
    reason: organization.reason,
  })));
  const lines = [
    '# Apollo Buyer Search Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Buyer hypothesis: ${report.buyerHypothesis}`,
    '',
    '## Safety proof',
    '',
    `- Search-only: ${report.mode === 'search_only' ? 'yes' : 'no'}`,
    `- Credits consumed during this report run: ${Object.values(report.safety.creditDelta).reduce((sum, value) => sum + Math.max(0, value), 0)}`,
    '- Contacts created: 0',
    '- Sequences enrolled: 0',
    '- Messages sent: 0',
    '',
    '## New organization-level buyer candidates',
    '',
    '| Priority | Organization | Candidate | Title | Email available | Apollo ID |',
    '| ---: | --- | --- | --- | --- | --- |',
    ...rows.sort((left, right) => right.priorityScore - left.priorityScore).map((candidate) => `| ${candidate.priorityScore} | ${candidate.organization || ''} | ${candidate.firstName || ''} ${candidate.lastNameObfuscated || ''} | ${candidate.title || ''} | ${candidate.hasEmail ? 'yes' : 'no'} | ${candidate.apolloId || ''} |`),
    '',
    'Candidates remain research-only until identity and current ownership are independently verified. Existing tracker rows retain duplicate-outreach suppression.',
    '',
  ];
  return lines.join('\n');
}

function defaultOutputPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(process.cwd(), '.thumbgate', 'reports', `apollo-buyer-search-${date}.json`);
}

function writeReport(report, outputPath) {
  const resolved = path.resolve(outputPath || defaultOutputPath());
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = resolved.replace(/\.json$/i, '.md');
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { json: resolved, markdown: markdownPath };
}

function usage() {
  return `Usage: node scripts/apollo-acquisition.js [options]\n\n` +
    `  --execute                Run search-only Apollo lookups (no enrichment or sends)\n` +
    `  --input <csv>            Existing acquisition tracker\n` +
    `  --config <json>          Buyer titles and organization domains\n` +
    `  --output <json>          Report destination\n` +
    `  --max-targets <n>        Limit tracker lookups\n` +
    `  --per-page <n>           Organization candidates per query (1-100)\n` +
    `  --skip-tracker           Skip known-person deduplication searches\n` +
    `  --skip-organizations     Skip new organization buyer scans\n`;
}

function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (options.help) return { help: usage() };
  const config = JSON.parse(fs.readFileSync(path.resolve(options.config), 'utf8'));
  const rows = options.includeTracker
    ? parseCsv(fs.readFileSync(path.resolve(options.input), 'utf8'))
    : [];
  const plan = buildSearchPlan({ rows, config, options });
  if (!options.execute) return { mode: 'dry_run', plan };
  const report = executeSearchPlan(plan, { perPage: options.perPage, ...dependencies });
  return { mode: 'executed', report, files: writeReport(report, options.output) };
}

if (!module.parent) {
  try {
    const result = runCli();
    if (result.help) process.stdout.write(result.help);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildSearchPlan,
  creditDelta,
  executeSearchPlan,
  parseArgs,
  parseCsv,
  parseCsvLine,
  renderMarkdown,
  runCli,
  sanitizeCandidate,
  scoreOrganizationCandidate,
  suppressDuplicateOutreach,
  knownTargetIdentityMatches,
};
