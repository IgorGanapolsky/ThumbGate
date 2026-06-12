'use strict';

// Tool-call registry for the manufacturing copilot.
// Schemas use the Anthropic tool-use format so the same definitions drive
// real LLM function calling (Portkey/Anthropic) and the offline intent path.
//
// Tier model (refined by deep-research; conservative defaults until then):
//   read           — no side effects; allowed for all roles
//   actuate_low    — administrative writes (work orders, reservations,
//                    escalations); allowed for supervisor+, always executed
//                    against the REAL CMMS store and audited
//   actuate_critical — physical plant control (interlocks, shutdowns, PLC
//                    writes); NEVER auto-executed. ThumbGate firewall blocks
//                    and converts to an escalation record.

const cmms = require('./cmms');

const TOOLS = [
  {
    name: 'list_work_orders',
    tier: 'read',
    description: 'List maintenance work orders from the CMMS, filtered by status (open, closed, all).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Work order status filter' },
      },
    },
    execute: (input) => cmms.listWorkOrders({ status: input.status || 'open' }),
  },
  {
    name: 'check_part_inventory',
    tier: 'read',
    description: 'Check spare-part stock by part number (e.g., HF-4420), or list all stocked parts.',
    input_schema: {
      type: 'object',
      properties: {
        partNumber: { type: 'string', description: 'Part number to look up; omit to list all parts' },
      },
    },
    execute: (input) => cmms.checkPartInventory(input.partNumber),
  },
  {
    name: 'create_work_order',
    tier: 'actuate_low',
    description: 'Create a maintenance work order in the CMMS for a machine, citing the governing procedure code.',
    input_schema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine identifier, e.g., HP-400, VM-22, C-3, AC-1' },
        procedureCode: { type: 'string', description: 'Governing procedure, e.g., MM-201' },
        description: { type: 'string', description: 'What work is needed' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['machine', 'description'],
    },
    execute: (input, ctx) =>
      cmms.createWorkOrder({ ...input, requestedBy: ctx.userRole || 'floor_supervisor' }),
  },
  {
    name: 'reserve_part',
    tier: 'actuate_low',
    description: 'Reserve spare parts from inventory against a work order. Decrements real stock.',
    input_schema: {
      type: 'object',
      properties: {
        partNumber: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        workOrderId: { type: 'integer' },
      },
      required: ['partNumber'],
    },
    execute: (input, ctx) =>
      cmms.reservePart({ ...input, reservedBy: ctx.userRole || 'floor_supervisor' }),
  },
  {
    name: 'escalate_to_role',
    tier: 'actuate_low',
    description: 'Escalate a request or blocked action to a higher role (plant_manager, ehs_incident_commander, safety_officer).',
    input_schema: {
      type: 'object',
      properties: {
        toRole: { type: 'string', enum: ['plant_manager', 'ehs_incident_commander', 'safety_officer'] },
        reason: { type: 'string' },
      },
      required: ['toRole', 'reason'],
    },
    execute: (input, ctx) =>
      cmms.createEscalation({
        ...input,
        requestedBy: ctx.userRole || 'floor_supervisor',
        relatedQuestion: ctx.question || null,
      }),
  },
  // Physical plant control: defined so the LLM can PROPOSE them (that is what
  // real copilots do), but execution is impossible — the ThumbGate firewall
  // blocks the edge and records an escalation instead. There is no executor.
  {
    name: 'override_interlock',
    tier: 'actuate_critical',
    description: 'Disable or bypass a machine safety interlock. PROHIBITED — always blocked by policy (SP-110).',
    input_schema: {
      type: 'object',
      properties: {
        machine: { type: 'string' },
        parameter: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['machine'],
    },
    execute: null,
  },
  {
    name: 'trigger_emergency_shutdown',
    tier: 'actuate_critical',
    description: 'Trigger an emergency power cutoff for a production line. Requires plant-manager authorization or sensor anomaly.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['target'],
    },
    execute: null,
  },
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

function getTool(name) {
  return byName.get(name) || null;
}

// Anthropic-format tool definitions for LLM function calling.
function toolDefinitions() {
  return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

// Execute an allowed tool against the real store. Throws for unknown tools
// and refuses critical-tier tools defensively even if a caller bypasses the
// firewall — defense in depth.
function executeTool(name, input = {}, ctx = {}) {
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (tool.tier === 'actuate_critical' || !tool.execute) {
    throw new Error(`Tool ${name} is critical-tier and cannot be executed; it must be escalated`);
  }
  return tool.execute(input, ctx);
}

module.exports = { TOOLS, getTool, toolDefinitions, executeTool };
