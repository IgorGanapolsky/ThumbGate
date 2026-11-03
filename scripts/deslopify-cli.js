#!/usr/bin/env node
'use strict';

/**
 * Deslopify AI Gate CLI (`node scripts/deslopify-cli.js`)
 *
 * Commands:
 *   node scripts/deslopify-cli.js pov --brain-dump "..." --confidence 60
 *   node scripts/deslopify-cli.js angles --topic "Checkout funnel drop-off"
 *   node scripts/deslopify-cli.js review --text "..."
 *   node scripts/deslopify-cli.js budget --text "..." [--raw-dump]
 *   node scripts/deslopify-cli.js taste --name "igor-operator-voice"
 */

const {
  evaluatePreExecutionPovGate,
  generateSixDivergentAngles,
  runFourPersonaReviewBoard,
  enforceReadBudgetAndLabelGate,
  compileTasteProfileSkill,
} = require('../src/deslopify-engine');

function parseArgs(argv) {
  const args = { command: argv[2] || 'budget', flags: {} };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const val =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args.flags[key] = val;
    }
  }
  return args;
}

function main() {
  const { command, flags } = parseArgs(process.argv);

  if (command === 'pov') {
    const res = evaluatePreExecutionPovGate({
      brainDump: flags['brain-dump'] || '',
      whatYouThink: flags.think || '',
      whatWorriesYou: flags.worries || '',
      whatToAvoid: flags.avoid || '',
      confidencePct: flags.confidence !== undefined ? Number(flags.confidence) : undefined,
    });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    process.exit(res.ok ? 0 : 2);
  }

  if (command === 'angles') {
    const res = generateSixDivergentAngles(flags.topic || 'agent reliability');
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (command === 'review') {
    const res = runFourPersonaReviewBoard(flags.text || '');
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    process.exit(res.ok ? 0 : 2);
  }

  if (command === 'taste') {
    const res = compileTasteProfileSkill({
      profileName: flags.name || 'operator-voice-taste',
      bestWork: [
        'Lead with live numbers in sentence 1. Verify exit 0 before claiming done.',
      ],
      dislikedWork: [
        "In today's fast-paced world, it is important to note that we delve into a paradigm shift.",
      ],
    });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const res = enforceReadBudgetAndLabelGate(flags.text || '', {
    isRawAiResearchDump: flags['raw-dump'] === 'true',
    maxSentences: flags.max ? Number(flags.max) : 5,
  });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  process.exit(res.ok ? 0 : 2);
}

if (require.main === module) {
  main();
}
