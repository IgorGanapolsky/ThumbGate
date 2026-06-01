'use strict';

const { spawnSync } = require('node:child_process');

const DEFAULT_REGION = 'us-central1';
const DEFAULT_SERVICE = 'thumbgate-dfcx-guard';
const DEFAULT_BUDGET_USD = 10;
const WEBHOOK_PATH = '/v1/enterprise/gcp/dialogflow-cx-webhook';

const REQUIRED_APIS = Object.freeze([
  'cloudbilling.googleapis.com',
  'billingbudgets.googleapis.com',
  'aiplatform.googleapis.com',
  'dialogflow.googleapis.com',
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
]);

function parseSetupVertexArgs(argv = []) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const raw = token.slice(2);
    if (raw.startsWith('no-')) {
      args[raw.slice(3)] = false;
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[raw] = next;
      i += 1;
    } else {
      args[raw] = true;
    }
  }
  return args;
}

function normalizePositiveNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", String.raw`'\''`)}'`;
}

function formatCommand(command) {
  return [command.cmd, ...(command.displayArgs || command.args)].map(shellQuote).join(' ');
}

function command(cmd, args, displayArgs = args) {
  return { cmd, args, displayArgs };
}

function buildSetupVertexPlan(options = {}) {
  const project = options.project || options.detectedProject || null;
  const billingAccount = options['billing-account'] || options.billingAccount || null;
  const region = options.region || DEFAULT_REGION;
  const service = options.service || DEFAULT_SERVICE;
  const budgetUsd = normalizePositiveNumber(options['budget-usd'] || options.budgetUsd, DEFAULT_BUDGET_USD);
  const apiKey = options['api-key'] || options.apiKey || process.env.THUMBGATE_API_KEY || null;
  const requiredApis = Array.from(REQUIRED_APIS);

  const enableApis = command('gcloud', [
    'services',
    'enable',
    ...requiredApis,
    ...(project ? [`--project=${project}`] : []),
    '--quiet',
  ]);

  const budgetCreate = billingAccount
    ? command('gcloud', [
      'alpha',
      'billing',
      'budgets',
      'create',
      `--billing-account=${billingAccount}`,
      '--display-name=ThumbGate Vertex Safety Budget',
      `--budget-amount=${budgetUsd}USD`,
      '--threshold-rule=percent=0.5',
      '--threshold-rule=percent=0.9',
      '--threshold-rule=percent=1.0',
      '--quiet',
    ])
    : null;

  const deployArgs = [
    'run',
    'deploy',
    service,
    '--source=.',
    `--region=${region}`,
    '--allow-unauthenticated',
    '--min-instances=0',
    '--max-instances=1',
    `--set-env-vars=THUMBGATE_API_KEY=${apiKey || 'REPLACE_WITH_API_KEY'}`,
    ...(project ? [`--project=${project}`] : []),
    '--quiet',
  ];
  const deployDisplayArgs = deployArgs.map((arg) => (
    arg.startsWith('--set-env-vars=THUMBGATE_API_KEY=')
      ? '--set-env-vars=THUMBGATE_API_KEY=<THUMBGATE_API_KEY>'
      : arg
  ));
  const deployCommand = command('gcloud', deployArgs, deployDisplayArgs);

  return {
    ok: true,
    command: 'setup-vertex',
    mode: options.apply ? 'apply' : 'plan',
    project,
    billingAccount,
    region,
    service,
    budgetUsd,
    hasApiKey: Boolean(apiKey),
    requiredApis,
    webhookPath: WEBHOOK_PATH,
    commands: {
      enableApis,
      budgetCreate,
      deploy: deployCommand,
      dogfood: 'npx thumbgate enterprise-gcp-webhook --input=docs/examples/dialogflow-cx-high-risk-webhook.json --response',
    },
    notes: [
      'Default mode is plan-only. Use --apply to enable required Google Cloud APIs.',
      'Use --create-budget with --billing-account=<ID> to create a budget guard.',
      'Use --deploy only after budget verification; Cloud Run is configured with min-instances=0 and max-instances=1.',
      'Dialogflow CX can call the hosted webhook path after the service is deployed.',
    ],
  };
}

function defaultRunCommand(commandSpec, options = {}) {
  const result = spawnSync(commandSpec.cmd, commandSpec.args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: formatCommand(commandSpec),
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: result.status === 0,
    error: result.error ? result.error.message : null,
  };
}

function readGcloudValue(args, runner, cwd) {
  const result = runner(command('gcloud', args), { cwd });
  if (!result.ok) return null;
  const value = String(result.stdout || '').trim();
  return value && value !== '(unset)' ? value : null;
}

function detectGcloudContext(runner, cwd) {
  return {
    account: readGcloudValue(['config', 'get-value', 'account'], runner, cwd),
    project: readGcloudValue(['config', 'get-value', 'project'], runner, cwd),
    quotaProject: readGcloudValue(['config', 'get-value', 'billing/quota_project'], runner, cwd),
  };
}

function executeSetupVertex(plan, args, runner, cwd) {
  const results = [];
  if (args.apply) {
    if (!plan.project) {
      return {
        ok: false,
        error: 'setup-vertex --apply requires --project or an active gcloud project',
        results,
      };
    }
    results.push(runner(plan.commands.enableApis, { cwd }));
  }
  if (args['create-budget']) {
    if (!plan.billingAccount) {
      return {
        ok: false,
        error: 'setup-vertex --create-budget requires --billing-account=<ID>',
        results,
      };
    }
    results.push(runner(plan.commands.budgetCreate, { cwd }));
  }
  if (args.deploy) {
    if (!plan.project) {
      return {
        ok: false,
        error: 'setup-vertex --deploy requires --project or an active gcloud project',
        results,
      };
    }
    if (!plan.hasApiKey) {
      return {
        ok: false,
        error: 'setup-vertex --deploy requires THUMBGATE_API_KEY in the environment or --api-key=<value>',
        results,
      };
    }
    results.push(runner(plan.commands.deploy, { cwd }));
  }
  return {
    ok: results.every((result) => result.ok),
    results,
  };
}

function printPlanSummary(plan) {
  console.log('ThumbGate Vertex / Dialogflow CX setup');
  console.log('='.repeat(42));
  console.log(`Mode           : ${plan.mode}`);
  console.log(`Project        : ${plan.project || '(set with --project=<id>)'}`);
  console.log(`Billing account: ${plan.billingAccount || '(optional; set with --billing-account=<id>)'}`);
  console.log(`Region         : ${plan.region}`);
  console.log(`Service        : ${plan.service}`);
  console.log(`Budget guard   : ${plan.budgetUsd} USD/month target`);
  console.log(`API key env    : ${plan.hasApiKey ? 'configured' : 'missing (set THUMBGATE_API_KEY)'}`);
  console.log('');
}

function printRequiredApis(plan) {
  console.log('Required Google Cloud APIs:');
  for (const api of plan.requiredApis) console.log(`- ${api}`);
  console.log('');
}

function printPlanCommands(plan) {
  console.log('Commands:');
  console.log(`  Enable APIs : ${formatCommand(plan.commands.enableApis)}`);
  if (plan.commands.budgetCreate) console.log(`  Budget guard: ${formatCommand(plan.commands.budgetCreate)}`);
  else console.log('  Budget guard: rerun with --billing-account=<ID> --create-budget');
  console.log(`  Deploy      : ${formatCommand(plan.commands.deploy)}`);
  console.log(`  Dogfood     : ${plan.commands.dogfood}`);
  console.log('');
  console.log(`Dialogflow CX webhook path after deploy: ${plan.webhookPath}`);
  console.log('');
}

function printExecutionResults(execution) {
  if (!execution || execution.results.length === 0) return;
  console.log('');
  console.log('Execution results:');
  for (const result of execution.results) {
    console.log(`- ${result.ok ? 'PASS' : 'FAIL'} ${result.command}`);
    if (!result.ok && result.stderr) console.log(`  ${result.stderr.trim()}`);
  }
}

function printText(plan, execution) {
  printPlanSummary(plan);
  printRequiredApis(plan);
  printPlanCommands(plan);
  for (const note of plan.notes) console.log(`- ${note}`);
  printExecutionResults(execution);
}

function runSetupVertex(argv = process.argv.slice(2), options = {}) {
  const args = parseSetupVertexArgs(argv);
  const runner = options.runCommand || defaultRunCommand;
  const cwd = options.cwd || process.cwd();
  const shouldDetect = args.apply || args.deploy || args['detect-gcloud'];
  const detected = shouldDetect ? detectGcloudContext(runner, cwd) : {};
  const plan = buildSetupVertexPlan({
    ...args,
    apply: Boolean(args.apply || args.deploy),
    project: args.project || detected.project,
    detectedProject: detected.project,
    billingAccount: args['billing-account'],
  });
  const execution = executeSetupVertex(plan, args, runner, cwd);
  const payload = {
    ...plan,
    detected,
    execution,
    commands: {
      enableApis: formatCommand(plan.commands.enableApis),
      budgetCreate: plan.commands.budgetCreate ? formatCommand(plan.commands.budgetCreate) : null,
      deploy: formatCommand(plan.commands.deploy),
      dogfood: plan.commands.dogfood,
    },
  };

  if (options.print !== false) {
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printText(plan, execution);
    }
  }

  return execution.ok ? 0 : 1;
}

function main() {
  process.exitCode = runSetupVertex(process.argv.slice(2));
}

if (process.argv[1] === __filename) {
  main();
}

module.exports = {
  DEFAULT_BUDGET_USD,
  DEFAULT_REGION,
  DEFAULT_SERVICE,
  REQUIRED_APIS,
  WEBHOOK_PATH,
  buildSetupVertexPlan,
  formatCommand,
  parseSetupVertexArgs,
  runSetupVertex,
};
