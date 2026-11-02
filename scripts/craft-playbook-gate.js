#!/usr/bin/env node
'use strict';

/**
 * Local playbook gate stolen from Rachel Woods (2026-10).
 *
 * Her idea: one atomic deliverable has a trigger, inputs, steps, and an
 * output; the first cycle keeps a person on judgment; a spontaneous win is
 * locked into the text; the playbook lives outside the model UI; a structural
 * self-edit needs a human; a stack is done only after each child is verified.
 *
 * This file does not write a playbook, call a model, spawn an agent, or talk
 * to a task service. Source: https://www.youtube.com/watch?v=CMkwClAm2TI
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://www.youtube.com/watch?v=CMkwClAm2TI';
const CRAFT_STAGES = ['clear', 'realistic', 'setup', 'feedback', 'rollout'];
const TRIGGER_KINDS = new Set(['schedule', 'calendar', 'webhook', 'hook', 'manual']);
const GENERIC_TRIGGER_WORDS = new Set([
  'feedback',
  'review',
  'help',
  'playbook',
  'run',
  'default',
  'automate',
  'agent',
]);
const VAGUE_DETAILS = new Set([
  'handle it',
  'do the work',
  'automate the role',
  'figure it out',
]);
const REFUSED_HOMES = new Set(['claude-project', 'chatgpt-gpt', 'gemini-gem', 'vendor-ui']);
const REFUSED_MODES = new Set(['subagent', 'asana', 'clickup', 'claude-subagent']);
const TRIGGER_WORD = /^[a-z][a-z0-9-]{2,32}$/;
const PLAYBOOK_PATH = /^[a-z0-9][a-z0-9/_-]*\.(md|json)$/;
const ROLE_SCOPE = /\b(entire role|whole department)\b/i;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hold(kind, code, message, extra) {
  return {
    ok: false,
    code,
    decision: extra && extra.decision ? extra.decision : 'hold',
    mayApply: false,
    wrote: false,
    requiresApproval: Boolean(extra && extra.requiresApproval),
    blockers: [{ code, message }],
    kind,
    message,
  };
}

function accept(kind, code, decision, message, mayApply) {
  return {
    ok: true,
    code,
    decision,
    mayApply: mayApply === true,
    wrote: false,
    requiresApproval: false,
    blockers: [],
    kind,
    message,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!plainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function backupDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function checkTriggerWord(word) {
  if (typeof word !== 'string' || !TRIGGER_WORD.test(word)) {
    return {
      ok: false,
      code: 'trigger_word_shape',
      message: 'A trigger word is lowercase letters, digits, and hyphens, from 3 to 33 characters.',
    };
  }
  if (GENERIC_TRIGGER_WORDS.has(word)) {
    return {
      ok: false,
      code: 'trigger_word_generic',
      message: `Trigger word "${word}" is too generic. Use a distinct name such as nitpicking.`,
    };
  }
  return { ok: true };
}

function stepDetails(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((step) => plainObject(step) && typeof step.detail === 'string')
    .map((step) => step.detail);
}

function evaluateOutline(doc) {
  if (!nonEmptyString(doc.id)) {
    return hold('outline', 'id_required', 'An outline needs an id.');
  }
  if (!nonEmptyString(doc.deliverable)) {
    return hold('outline', 'deliverable_required', 'An outline needs one deliverable.');
  }
  if (doc.scope === 'role' || doc.scope === 'department' || ROLE_SCOPE.test(doc.deliverable)) {
    return hold('outline', 'scope_refused', 'Start with one deliverable. A role or a department is not version 1.');
  }
  if (!TRIGGER_KINDS.has(doc.triggerKind)) {
    return hold('outline', 'trigger_kind', 'triggerKind must be schedule, calendar, webhook, hook, or manual.');
  }
  if (!nonEmptyString(doc.trigger)) {
    return hold('outline', 'trigger_required', 'An outline needs the event that starts the work.');
  }
  if (!Array.isArray(doc.inputs)) {
    return hold('outline', 'inputs_must_be_a_list', 'Inputs must be a list of the exact data the playbook reads.');
  }
  if (doc.inputs.length === 0 || doc.inputs.some((item) => !nonEmptyString(item))) {
    return hold('outline', 'inputs_required', 'Inputs must list at least one non-empty source.');
  }
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    return hold('outline', 'steps_required', 'An outline needs at least one step.');
  }
  const seen = new Set();
  for (const step of doc.steps) {
    if (!plainObject(step) || !nonEmptyString(step.id) || !nonEmptyString(step.detail)) {
      return hold('outline', 'step_shape', 'Each step needs an id and a detail.');
    }
    if (seen.has(step.id)) {
      return hold('outline', 'step_id_duplicate', `Step id "${step.id}" is used more than once.`);
    }
    seen.add(step.id);
    if (VAGUE_DETAILS.has(step.detail.trim().toLowerCase())) {
      return hold('outline', 'step_vague', `Step "${step.id}" does not say what to do.`);
    }
  }
  if (!nonEmptyString(doc.output)) {
    return hold('outline', 'output_required', 'An outline needs an output that says what done looks like.');
  }
  if (!nonEmptyString(doc.escalation)) {
    return hold('outline', 'escalation_required', 'An outline needs a separate escalation for the cases a person still sees.');
  }
  const word = checkTriggerWord(doc.triggerWord);
  if (!word.ok) return hold('outline', word.code, word.message);
  const stored = storageHold('outline', doc);
  if (stored) return stored;
  return accept('outline', 'outline_ready', 'accept', 'The outline is one deliverable stored in git.');
}

function storageHold(kind, doc) {
  if (doc.home == null || doc.home === '') {
    return hold(kind, 'home_required', 'An outline needs a home. ThumbGate stores playbooks in git.');
  }
  if (doc.home !== 'git' || REFUSED_HOMES.has(doc.home)) {
    return hold(kind, 'home_refused', 'The playbook home is git. A vendor chat UI is not the source of truth.');
  }
  if (doc.path == null || doc.path === '') {
    return hold(kind, 'path_required', 'An outline needs a relative path inside the repo.');
  }
  if (typeof doc.path !== 'string' || doc.path.split(/[/\\]/).includes('..') || !PLAYBOOK_PATH.test(doc.path)) {
    return hold(kind, 'path_refused', 'The path must be a relative .md or .json file inside the repo.');
  }
  return null;
}

function stagesAreOrdered(stages) {
  let seenOpen = false;
  for (const name of CRAFT_STAGES) {
    const done = stages[name] === true;
    if (done && seenOpen) return false;
    if (!done) seenOpen = true;
  }
  return true;
}

function checkHumanSteps(humanSteps, required) {
  if (!Array.isArray(humanSteps)) {
    return {
      ok: false,
      code: required ? 'human_steps_required' : 'human_step_shape',
      message: required
        ? 'Cycle 1 needs at least one named human step and why it is still a person.'
        : 'humanSteps must be a list when it is set.',
    };
  }
  if (required && humanSteps.length === 0) {
    return {
      ok: false,
      code: 'human_steps_required',
      message: 'Cycle 1 needs at least one named human step and why it is still a person.',
    };
  }
  for (const step of humanSteps) {
    if (!plainObject(step) || !nonEmptyString(step.id) || !nonEmptyString(step.reason)) {
      return {
        ok: false,
        code: 'human_step_shape',
        message: 'Each human step needs an id and a reason.',
      };
    }
  }
  return { ok: true };
}

function evaluateCraft(doc) {
  if (!Number.isInteger(doc.cycle) || doc.cycle < 1) {
    return hold('craft', 'cycle_invalid', 'cycle must be an integer of 1 or more.');
  }
  if (Object.prototype.hasOwnProperty.call(doc, 'zeroTouch') && typeof doc.zeroTouch !== 'boolean') {
    return hold('craft', 'zero_touch_type', 'zeroTouch must be boolean true or false.');
  }
  if (doc.stages != null && !plainObject(doc.stages)) {
    return hold('craft', 'stages_shape', 'stages must be an object.');
  }
  const stages = plainObject(doc.stages) ? doc.stages : {};
  if (!stagesAreOrdered(stages)) {
    return hold('craft', 'stage_order', 'A later CRAFT stage is marked done while an earlier stage is not.');
  }
  if (doc.cycle === 1) {
    if (doc.zeroTouch === true) {
      return hold('craft', 'zero_touch_refused', 'Cycle 1 keeps a person on the judgment steps.');
    }
    const shaped = checkHumanSteps(doc.humanSteps, true);
    if (!shaped.ok) return hold('craft', shaped.code, shaped.message);
    return accept('craft', 'in_loop', 'in_loop', 'Cycle 1 stays in the loop.');
  }
  if (doc.zeroTouch === true) {
    for (const name of CRAFT_STAGES) {
      if (stages[name] !== true) {
        return hold('craft', 'stages_incomplete', 'Zero-touch needs every CRAFT stage done in order.');
      }
    }
    if (!Array.isArray(doc.humanSteps) || doc.humanSteps.length !== 0) {
      return hold('craft', 'human_steps_remain', 'Zero-touch needs humanSteps to be an empty list.');
    }
    const feedback = doc.feedback;
    if (!plainObject(feedback) || feedback.errorsReviewed !== true) {
      return hold('craft', 'errors_not_reviewed', 'Zero-touch needs feedback.errorsReviewed to be true.');
    }
    const wins = feedback.lockedWins;
    if (!Array.isArray(wins) || wins.length === 0 || wins.some((win) => !nonEmptyString(win))) {
      return hold('craft', 'wins_not_locked', 'Zero-touch needs each locked win as text.');
    }
    const details = stepDetails(doc.steps);
    for (const win of wins) {
      if (!details.some((detail) => detail.includes(win))) {
        return hold('craft', 'win_not_in_steps', 'A locked win counts only when a step already contains that text.');
      }
    }
    return accept('craft', 'zero_touch', 'zero_touch', 'A later cycle closed the human steps and locked the wins into the steps.');
  }
  if (doc.humanSteps != null) {
    const shaped = checkHumanSteps(doc.humanSteps, false);
    if (!shaped.ok) return hold('craft', shaped.code, shaped.message);
  }
  return accept('craft', 'in_loop', 'in_loop', 'This cycle stays in the loop.');
}

function relativeBackupPath(value) {
  if (!nonEmptyString(value)) return false;
  if (path.isAbsolute(value)) return false;
  if (value.includes('\\')) return false;
  if (value.split('/').includes('..')) return false;
  return true;
}

function structural(playbook) {
  const steps = Array.isArray(playbook.steps) ? playbook.steps : [];
  const humanSteps = Array.isArray(playbook.humanSteps) ? playbook.humanSteps : [];
  return {
    triggerKind: playbook.triggerKind == null ? null : playbook.triggerKind,
    trigger: playbook.trigger == null ? null : playbook.trigger,
    inputs: playbook.inputs == null ? null : playbook.inputs,
    output: playbook.output == null ? null : playbook.output,
    escalation: playbook.escalation == null ? null : playbook.escalation,
    stepIds: steps.map((step) => (plainObject(step) ? step.id ?? null : null)),
    stepEscalate: steps.map((step) => Boolean(plainObject(step) && step.escalate === true)),
    humanStepIds: humanSteps.map((step) => (plainObject(step) ? step.id ?? null : null)),
  };
}

function isMajor(before, after) {
  return JSON.stringify(canonicalize(structural(before))) !== JSON.stringify(canonicalize(structural(after)));
}

function claimedWinsInSteps(doc, after) {
  if (!Object.prototype.hasOwnProperty.call(doc, 'lockedWins') || doc.lockedWins == null) return null;
  const wins = doc.lockedWins;
  if (!Array.isArray(wins) || wins.some((win) => !nonEmptyString(win))) {
    return hold('edit', 'wins_not_locked', 'Claimed wins must be non-empty strings.');
  }
  if (wins.length === 0) return null;
  const details = stepDetails(after.steps);
  for (const win of wins) {
    if (!details.some((detail) => detail.includes(win))) {
      return hold('edit', 'win_not_in_steps', 'A claimed win counts only when the new steps contain that text.');
    }
  }
  return null;
}

function evaluateEdit(doc) {
  if (!plainObject(doc.before) || !plainObject(doc.after)) {
    return hold('edit', 'playbook_required', 'An edit needs before and after playbook objects.');
  }
  const backup = doc.backup;
  if (!plainObject(backup) || typeof backup.sha256 !== 'string' || !relativeBackupPath(backup.path)) {
    return hold('edit', 'backup_required', 'A self-edit needs a local backup path and a sha256 of the previous playbook.');
  }
  const livePath = nonEmptyString(doc.before.path) ? doc.before.path : (nonEmptyString(doc.after.path) ? doc.after.path : '');
  if (livePath && backup.path === livePath) {
    return hold('edit', 'backup_required', 'The backup path must be a different file from the playbook.');
  }
  if (backup.sha256.toLowerCase() !== backupDigest(doc.before)) {
    return hold('edit', 'backup_required', 'The backup hash does not match the previous playbook.');
  }
  if (JSON.stringify(canonicalize(doc.before)) === JSON.stringify(canonicalize(doc.after))) {
    return hold('edit', 'unchanged', 'The playbook did not change, so there is nothing to apply.', { decision: 'unchanged' });
  }
  const wins = claimedWinsInSteps(doc, doc.after);
  if (wins) return wins;
  const stored = storageHold('edit', doc.after);
  if (stored) return stored;
  if (isMajor(doc.before, doc.after)) {
    if (doc.approved !== true || !nonEmptyString(doc.approvedBy)) {
      return hold(
        'edit',
        'approval_required',
        'A change to the trigger, steps, or escalation needs approved true and a named approvedBy.',
        { requiresApproval: true, decision: 'approval_required' },
      );
    }
    return accept('edit', 'approved_major', 'approved_major', 'The structural change is approved and the previous playbook is backed up.', true);
  }
  if (!nonEmptyString(doc.feedbackRef)) {
    return hold('edit', 'feedback_ref_required', 'A detail tweak needs a feedback reference.');
  }
  return accept('edit', 'minor', 'minor', 'The detail tweak is backed up and tied to feedback.', true);
}

function evaluateVocabulary(doc) {
  if (!Array.isArray(doc.registry) || doc.registry.length === 0) {
    return hold('vocabulary', 'registry_required', 'A vocabulary needs at least one trigger word.');
  }
  const seen = new Set();
  for (const entry of doc.registry) {
    if (!plainObject(entry) || !nonEmptyString(entry.id)) {
      return hold('vocabulary', 'registry_shape', 'Each vocabulary entry needs an id and a trigger word.');
    }
    const word = checkTriggerWord(entry.triggerWord);
    if (!word.ok) return hold('vocabulary', word.code, word.message);
    if (seen.has(entry.triggerWord)) {
      return hold('vocabulary', 'trigger_word_collision', `Trigger word "${entry.triggerWord}" is already used.`);
    }
    seen.add(entry.triggerWord);
  }
  return accept('vocabulary', 'vocabulary_ready', 'accept', 'Each trigger word names one playbook.');
}

function evaluateStack(doc) {
  if (Object.prototype.hasOwnProperty.call(doc, 'mode') && doc.mode !== 'local-board') {
    const named = typeof doc.mode === 'string' ? doc.mode : '';
    return hold(
      'stack',
      'mode_refused',
      named && REFUSED_MODES.has(named.toLowerCase())
        ? `Mode "${named}" is refused. This check does not spawn agents or call a task service.`
        : 'mode must be local-board when it is set.',
    );
  }
  if (!nonEmptyString(doc.managerId)) {
    return hold('stack', 'manager_required', 'A stack needs a managerId.');
  }
  if (!Array.isArray(doc.children) || doc.children.length < 2 || doc.children.some((id) => !nonEmptyString(id))) {
    return hold('stack', 'not_a_stack', 'A stack needs at least two child playbooks.');
  }
  if (new Set(doc.children).size !== doc.children.length) {
    return hold('stack', 'duplicate_child', 'Child playbook ids must be unique.');
  }
  if (doc.children.includes(doc.managerId)) {
    return hold('stack', 'stack_self_child', 'The manager cannot be one of its own children.');
  }
  if (!Array.isArray(doc.tasks)) {
    return hold('stack', 'stack_incomplete', 'A stack needs one task per child.');
  }
  const seen = new Map();
  for (const task of doc.tasks) {
    if (!plainObject(task) || !nonEmptyString(task.playbookId) || !nonEmptyString(task.id)) {
      return hold('stack', 'task_shape', 'Each task needs an id and a playbookId.');
    }
    if (!doc.children.includes(task.playbookId)) {
      return hold('stack', 'unknown_child', `Task playbook "${task.playbookId}" is not a child of this stack.`);
    }
    if (seen.has(task.playbookId)) {
      return hold('stack', 'duplicate_task', `Child "${task.playbookId}" has more than one task.`);
    }
    seen.set(task.playbookId, task);
  }
  for (const child of doc.children) {
    if (!seen.has(child)) {
      return hold('stack', 'stack_incomplete', `Child "${child}" has no task.`);
    }
  }
  for (const child of doc.children) {
    const task = seen.get(child);
    if (task.status !== 'done') {
      return hold('stack', 'stack_open', `Child "${child}" is not done.`);
    }
    if (!nonEmptyString(task.output)) {
      return hold('stack', 'stack_missing_output', `Child "${child}" has no output.`);
    }
    if (task.verified !== true) {
      return hold('stack', 'stack_unverified', `Child "${child}" is not verified.`);
    }
  }
  return accept('stack', 'stack_done', 'stack_done', 'Every child task is done, has output, and is verified.');
}

function evaluate(doc) {
  if (!plainObject(doc)) {
    return hold(null, 'kind_required', 'A playbook check needs kind: outline, craft, edit, vocabulary, or stack.');
  }
  if (doc.kind === 'outline') return evaluateOutline(doc);
  if (doc.kind === 'craft') return evaluateCraft(doc);
  if (doc.kind === 'edit') return evaluateEdit(doc);
  if (doc.kind === 'vocabulary') return evaluateVocabulary(doc);
  if (doc.kind === 'stack') return evaluateStack(doc);
  return hold(null, 'kind_required', 'kind must be outline, craft, edit, vocabulary, or stack.');
}

function ideaMap() {
  return {
    source: SOURCE_URL,
    notOurMeasurement: true,
    taken: [
      'One deliverable has a trigger, inputs, steps, an output, and a separate escalation.',
      'CRAFT runs clear, realistic, setup, feedback, then rollout. Cycle 1 keeps a named human step.',
      'A spontaneous win counts only when its text is inside a step.',
      'Playbooks live in git. A self-edit needs a backup hash of the previous playbook.',
      'A change to the trigger, the steps, or the escalation needs a named approval.',
      'nitpicking is a distinct trigger word. A stack is done only when every child is verified.',
    ],
    refused: [
      'Vendor-UI storage (claude-project, chatgpt-gpt, gemini-gem, vendor-ui).',
      'Line-count or percent self-approval.',
      'Spawning subagents.',
      'Asana or ClickUp API calls.',
      'Zero-touch on cycle 1.',
      'An empty document that passes by default.',
    ],
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stderr.write(
    'Usage: node scripts/craft-playbook-gate.js [--map-only | outline | craft | edit | vocabulary | stack]\n'
    + '  Reads one JSON object from stdin. Writes nothing.\n',
  );
}

function main(argv, stdin) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return 0;
  }
  if (args.includes('--map-only')) {
    printJson(ideaMap());
    return 0;
  }
  if (args.some((arg) => arg.startsWith('--'))) {
    usage();
    return 2;
  }
  if (args.length > 1) {
    usage();
    return 2;
  }
  let doc;
  try {
    doc = JSON.parse(stdin || '');
  } catch {
    process.stderr.write('stdin must be one JSON object.\n');
    return 2;
  }
  if (!plainObject(doc)) {
    process.stderr.write('stdin must be one JSON object.\n');
    return 2;
  }
  if (args.length === 1) {
    const command = args[0];
    if (!['outline', 'craft', 'edit', 'vocabulary', 'stack'].includes(command)) {
      usage();
      return 2;
    }
    if (doc.kind == null) doc.kind = command;
    else if (doc.kind !== command) {
      process.stderr.write('The command does not match kind.\n');
      return 2;
    }
  }
  const evaluated = evaluate(doc);
  printJson(evaluated);
  return evaluated.ok ? 0 : 1;
}

module.exports = {
  SOURCE_URL,
  CRAFT_STAGES,
  GENERIC_TRIGGER_WORDS,
  evaluate,
  ideaMap,
  backupDigest,
  main,
};

function skipsStdin(argv) {
  const args = argv.slice(2);
  return args.includes('--help') || args.includes('-h') || args.includes('--map-only');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const stdin = skipsStdin(process.argv) ? '' : fs.readFileSync(0, 'utf8');
  process.exit(main(process.argv, stdin));
}
