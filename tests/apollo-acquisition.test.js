const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildSearchPlan,
  creditDelta,
  executeSearchPlan,
  knownTargetIdentityMatches,
  parseArgs,
  parseCsv,
  runCli,
  scoreOrganizationCandidate,
  suppressDuplicateOutreach,
} = require('../scripts/apollo-acquisition');

const config = {
  buyerHypothesis: 'Teams need accountable agent controls.',
  titles: ['Chief AI Officer', 'AI Governance'],
  seniority: ['director', 'vp', 'c_suite'],
  organizations: [{ name: 'Gametime', domain: 'gametime.co', reason: 'AI agents are scaling.' }],
};

test('parses quoted acquisition tracker rows without corrupting notes', () => {
  const rows = parseCsv([
    'campaign_id,target_name,organization,status,notes',
    'wave1,Jeffery Aronhalt,Gametime,Contacted,"Agents scale, confidence lags"',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_name, 'Jeffery Aronhalt');
  assert.equal(rows[0].notes, 'Agents scale, confidence lags');
});

test('parses escaped quotes inside quoted tracker fields', () => {
  const rows = parseCsv([
    'target_name,notes',
    'Ryan Miller,"Owns ""AI Transformation"""',
  ].join('\n'));

  assert.equal(rows[0].notes, 'Owns "AI Transformation"');
});

test('builds known-target and organization scans while suppressing duplicate outreach', () => {
  const rows = [{
    campaign_id: 'wave1',
    target_name: 'Jeffery Aronhalt',
    organization: 'Gametime',
    status: 'Contacted - invitation pending',
    buyer_signal: 'Operational confidence gap',
  }];
  const plan = buildSearchPlan({ rows, config, options: {} });

  assert.equal(plan.trackerSearches.length, 1);
  assert.equal(plan.trackerSearches[0].domain, 'gametime.co');
  assert.equal(plan.trackerSearches[0].suppressDuplicateOutreach, true);
  assert.deepEqual(plan.organizationSearches[0].titles, config.titles);
});

test('treats failed routes as researchable without reclassifying them as fresh contacts', () => {
  assert.equal(suppressDuplicateOutreach('Contacted'), true);
  assert.equal(suppressDuplicateOutreach('Routed via official supplier channel'), true);
  assert.equal(suppressDuplicateOutreach('Failed - address not found'), false);
});

test('calculates credit deltas across all Apollo credit types', () => {
  const before = { credit_usage_stats: { lead_credit: { consumed: 10 }, ai_credit: { consumed: 2 } } };
  const after = { credit_usage_stats: { lead_credit: { consumed: 10 }, ai_credit: { consumed: 4 } } };
  assert.deepEqual(creditDelta(before, after), { lead_credit: 0, ai_credit: 2 });
});

test('matches obfuscated Apollo identities without accepting same-first-name noise', () => {
  assert.equal(knownTargetIdentityMatches('Jeffery Aronhalt', {
    firstName: 'Jeffery',
    lastNameObfuscated: 'Ar***t',
  }), true);
  assert.equal(knownTargetIdentityMatches('Lalit Anand', {
    firstName: 'Lalit',
    lastNameObfuscated: 'Kh***r',
  }), false);
});

test('ranks governance and agent-platform owners above generic titles', () => {
  const governance = scoreOrganizationCandidate({
    title: 'Group Director, AI Governance and Product Compliance',
    hasEmail: true,
  });
  const generic = scoreOrganizationCandidate({ title: 'Director of Engineering', hasEmail: true });
  assert.ok(governance.priorityScore > generic.priorityScore);
  assert.ok(governance.priorityReasons.includes('governance_pain_owner'));
});

test('executes search-only workflow and proves no Apollo credits or sends occurred', () => {
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args);
    if (args[0] === 'usage') {
      return { status: 0, stdout: JSON.stringify({ credit_usage_stats: { lead_credit: { consumed: 10 } } }) };
    }
    if (args.includes('Jeffery Aronhalt')) {
      return { status: 0, stdout: JSON.stringify({ total_entries: 1, people: [{ id: 'known-1', first_name: 'Jeffery', title: 'Principal Software Engineer', organization: { name: 'Gametime' } }] }) };
    }
    return { status: 0, stdout: JSON.stringify({ total_entries: 1, people: [{ id: 'buyer-1', first_name: 'Ryan', last_name_obfuscated: 'Mi***r', title: 'VP of AI Transformation', has_email: true, organization: { name: 'Gametime' } }] }) };
  };
  const plan = buildSearchPlan({
    rows: [{ target_name: 'Jeffery Aronhalt', organization: 'Gametime', status: 'Contacted' }],
    config,
    options: {},
  });
  const report = executeSearchPlan(plan, { runner, perPage: 25 });

  assert.equal(report.safety.zeroCreditSearchVerified, true);
  assert.equal(report.safety.createsContacts, false);
  assert.equal(report.safety.enrollsSequences, false);
  assert.equal(report.organizationResults[0].candidates[0].title, 'VP of AI Transformation');
  assert.equal(calls.some((args) => args[0] === 'contacts'), false);
  assert.equal(calls.some((args) => args[0] === 'sequences'), false);
  assert.equal(calls.some((args) => args[0] === 'people' && args[1] === 'enrich'), false);
});

test('dry run returns a reusable plan without calling Apollo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-acquisition-'));
  const input = path.join(tempDir, 'targets.csv');
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(input, 'target_name,organization,status\nJeffery Aronhalt,Gametime,Contacted\n');
  fs.writeFileSync(configPath, JSON.stringify(config));

  const result = runCli(['--input', input, '--config', configPath]);
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.plan.trackerSearches.length, 1);
});

test('missing legacy default tracker no longer crashes config-only planning', () => {
  const missing = path.join(os.tmpdir(), `missing-apollo-tracker-${Date.now()}.csv`);
  const result = runCli(['--skip-organizations'], { defaultInput: missing });

  assert.equal(result.mode, 'dry_run');
  assert.equal(result.plan.trackerSearches.length, 0);
  assert.equal(result.plan.trackerSource.loaded, false);
  assert.equal(result.plan.trackerSource.reason, 'default_tracker_missing');
});

test('an explicitly requested missing tracker still fails closed', () => {
  const missing = path.join(os.tmpdir(), `missing-explicit-apollo-tracker-${Date.now()}.csv`);
  assert.throws(
    () => runCli(['--input', missing, '--skip-organizations']),
    /Acquisition tracker not found/,
  );
});

test('free-plan People Search denial falls back to saved contacts without spending credits', () => {
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args);
    if (args[0] === 'usage') {
      return { status: 0, stdout: JSON.stringify({ credit_usage_stats: { lead_credit: { consumed: 5 } } }) };
    }
    if (args[0] === 'people') {
      return {
        status: 1,
        stdout: '',
        stderr: 'Apollo API error 403: {"error_code":"API_INACCESSIBLE","error":"not included in your Free plan"}',
      };
    }
    if (args[0] === 'contacts' && args.includes('Jeffery Aronhalt')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          contacts: [{
            id: 'saved-known',
            first_name: 'Jeffery',
            last_name: 'Aronhalt',
            title: 'Principal Software Engineer',
            organization_name: 'Gametime',
            last_activity_date: '2026-07-01',
          }],
          pagination: { total_entries: 1 },
        }),
      };
    }
    if (args[0] === 'contacts') {
      return {
        status: 0,
        stdout: JSON.stringify({
          contacts: [{
            id: 'saved-buyer',
            first_name: 'Ryan',
            last_name: 'Miller',
            title: 'Director of AI Governance',
            organization_name: 'Gametime',
            email: 'buyer@example.test',
          }],
          pagination: { total_entries: 1 },
        }),
      };
    }
    throw new Error(`Unexpected Apollo call: ${args.join(' ')}`);
  };
  const plan = buildSearchPlan({
    rows: [{ target_name: 'Jeffery Aronhalt', organization: 'Gametime', status: 'Contacted' }],
    config,
    options: {},
  });
  const report = executeSearchPlan(plan, { runner, perPage: 25 });

  assert.equal(report.searchBackend.backend, 'saved_contacts');
  assert.equal(report.safety.netNewSearchAvailable, false);
  assert.equal(report.safety.savedContactsFallback, true);
  assert.equal(report.safety.zeroCreditSearchVerified, true);
  assert.equal(report.trackerResults[0].identityMatchCount, 1);
  assert.equal(report.trackerResults[0].candidates[0].duplicateOutreachSuppressed, true);
  assert.equal(report.organizationResults[0].candidates[0].title, 'Director of AI Governance');
  assert.ok(calls.some((args) => args[0] === 'contacts'));
});

test('executed CLI writes JSON and Markdown evidence without enrichment or sends', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-acquisition-execute-'));
  const input = path.join(tempDir, 'targets.csv');
  const configPath = path.join(tempDir, 'config.json');
  const output = path.join(tempDir, 'report.json');
  fs.writeFileSync(input, 'target_name,organization,status\nJeffery Aronhalt,Gametime,Contacted\n');
  fs.writeFileSync(configPath, JSON.stringify(config));

  const runner = (_command, args) => {
    if (args[0] === 'usage') {
      return { status: 0, stdout: JSON.stringify({ credit_usage_stats: { lead_credit: { consumed: 10 } } }) };
    }
    if (args.includes('Jeffery Aronhalt')) {
      return { status: 0, stdout: JSON.stringify({ people: [] }) };
    }
    return {
      status: 0,
      stdout: JSON.stringify({
        people: [{
          id: 'buyer-1',
          first_name: 'Ryan',
          last_name_obfuscated: 'Mi***r',
          title: 'VP of AI Transformation',
          has_email: true,
          organization: { name: 'Gametime' },
        }],
      }),
    };
  };
  const result = runCli([
    '--execute', '--input', input, '--config', configPath, '--output', output,
  ], { runner });

  assert.equal(result.mode, 'executed');
  assert.equal(result.report.safety.zeroCreditSearchVerified, true);
  assert.equal(fs.existsSync(result.files.json), true);
  assert.equal(fs.existsSync(result.files.markdown), true);
  assert.match(fs.readFileSync(result.files.markdown, 'utf8'), /VP of AI Transformation/);
  assert.match(fs.readFileSync(result.files.markdown, 'utf8'), /Messages sent: 0/);
});

test('argument validation blocks accidental unbounded or malformed runs', () => {
  assert.throws(() => parseArgs(['--per-page', '0']), /1 to 100/);
  assert.throws(() => parseArgs(['--max-targets', 'nope']), /positive integer/);
  assert.throws(() => parseArgs(['--send']), /Unknown argument/);
});
