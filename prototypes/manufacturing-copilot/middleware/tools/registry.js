'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const ModbusClient = require('../modbus-client');

const DB_DIR = path.resolve(__dirname, '../../db');
const DEFAULT_CMMS_DB = path.join(DB_DIR, 'cmms.sqlite');

const TOOL_SCHEMAS = {
  'scada.read_tags': {
    family: 'SCADA',
    capability: 'read',
    risk: 'low',
    description: 'Read machine state tags from an industrial gateway or PLC telemetry adapter.',
    backingStandard: 'OPC UA Read service, Ignition system.tag.readBlocking, Modbus TCP read registers',
  },
  'scada.write_tag': {
    family: 'SCADA',
    capability: 'actuate',
    risk: 'critical',
    description: 'Write a process value, control mode, or command tag.',
    backingStandard: 'OPC UA Write service, Ignition system.tag.writeBlocking, Modbus TCP write register/coil',
  },
  'opcua.call_method': {
    family: 'OPC UA',
    capability: 'actuate',
    risk: 'critical',
    description: 'Invoke a server-side industrial method such as reset, start, stop, or acknowledge.',
    backingStandard: 'OPC UA Part 4 Method Service Set Call',
  },
  'alarm.acknowledge': {
    family: 'SCADA',
    capability: 'acknowledge',
    risk: 'medium',
    description: 'Acknowledge an active alarm without changing machine state.',
    backingStandard: 'SCADA alarm acknowledgement workflow',
  },
  'maintenance.create_work_order': {
    family: 'CMMS',
    capability: 'escalate',
    risk: 'low',
    description: 'Create a persisted maintenance or EHS escalation work order.',
    backingStandard: 'CMMS work-order creation workflow',
  },
  'ehs.escalate_incident': {
    family: 'EHS',
    capability: 'escalate',
    risk: 'low',
    description: 'Create a persisted EHS escalation record for authorized personnel.',
    backingStandard: 'Incident escalation workflow',
  },
};

const TAG_MAP = {
  conveyor_state: { label: 'Conveyor Line C-3 state', modbusRegister: 0, values: { 0: 'STOPPED', 1: 'RUNNING' } },
  safety_curtain_state: { label: 'Safety light curtain state', modbusRegister: 1, values: { 0: 'BYPASSED_OR_DISABLED', 1: 'ARMED_ACTIVE' } },
  main_power_state: { label: 'Main power system state', modbusRegister: 2, values: { 0: 'OFFLINE', 1: 'ONLINE' } },
  press_temperature_c: { label: 'Hydraulic press temperature C', modbusRegister: 3 },
};

function ensureCmmsSchema(dbPath = process.env.MANUFACTURING_CMMS_DB || DEFAULT_CMMS_DB) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      role TEXT NOT NULL,
      asset TEXT NOT NULL,
      priority TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_question TEXT NOT NULL
    );
  `);
  return db;
}

function createWorkOrder(input = {}, actor = {}) {
  const db = ensureCmmsSchema();
  const requestedBy = actor.id || actor.name || 'floor-supervisor-demo';
  const role = actor.role || 'floor_supervisor';
  const asset = input.asset || input.machine || 'Unspecified asset';
  const priority = input.priority || 'normal';
  const summary = input.summary || input.reason || 'Supervisor escalation requested from copilot.';
  const sourceQuestion = input.sourceQuestion || '';
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO work_orders (created_at, requested_by, role, asset, priority, summary, source_question)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(createdAt, requestedBy, role, asset, priority, summary, sourceQuestion);
  const row = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(result.lastInsertRowid);
  db.close();
  return {
    ok: true,
    toolName: 'maintenance.create_work_order',
    workOrder: row,
  };
}

async function readScadaTags(input = {}) {
  const tags = input.tags?.length ? input.tags : Object.keys(TAG_MAP);
  const port = Number(process.env.MODBUS_PORT || 5020);
  const client = new ModbusClient({ port });
  const registers = await client.readHoldingRegisters(0, 4);
  return {
    ok: true,
    toolName: 'scada.read_tags',
    adapter: 'modbus_tcp_local_gateway',
    endpoint: `127.0.0.1:${port}`,
    values: tags.map((tag) => {
      const def = TAG_MAP[tag];
      if (!def) return { tag, quality: 'bad_unknown_tag', value: null };
      const raw = registers[def.modbusRegister];
      return {
        tag,
        label: def.label,
        raw,
        value: def.values ? def.values[raw] || String(raw) : raw,
        quality: 'good',
      };
    }),
  };
}

async function executeManufacturingTool(toolCall, actor = {}) {
  if (!toolCall?.toolName) {
    throw new Error('toolCall.toolName is required');
  }

  if (toolCall.toolName === 'scada.read_tags') {
    return readScadaTags(toolCall.input || {});
  }

  if (toolCall.toolName === 'maintenance.create_work_order' || toolCall.toolName === 'ehs.escalate_incident') {
    return createWorkOrder(toolCall.input || {}, actor);
  }

  const schema = TOOL_SCHEMAS[toolCall.toolName];
  if (schema?.risk === 'critical') {
    throw new Error(`Critical actuation tool ${toolCall.toolName} must be blocked by ThumbGate before execution.`);
  }

  throw new Error(`No local executor registered for ${toolCall.toolName}`);
}

function formatToolExecutionAnswer(toolExecution) {
  if (!toolExecution?.ok) {
    return 'Tool execution failed; escalate to the control room.';
  }

  if (toolExecution.toolName === 'scada.read_tags') {
    const lines = toolExecution.values.map((entry) => (
      `- ${entry.label || entry.tag}: ${entry.value} (quality: ${entry.quality})`
    ));
    return `Live machine state read from ${toolExecution.adapter}:\n${lines.join('\n')}`;
  }

  if (toolExecution.toolName === 'maintenance.create_work_order' || toolExecution.toolName === 'ehs.escalate_incident') {
    return `Escalation created in the CMMS work-order database.\nWork order #${toolExecution.workOrder.id}: ${toolExecution.workOrder.summary}\nAsset: ${toolExecution.workOrder.asset}\nPriority: ${toolExecution.workOrder.priority}`;
  }

  return `Tool ${toolExecution.toolName} executed.`;
}

function getToolSchema(toolName) {
  return TOOL_SCHEMAS[toolName] || null;
}

module.exports = {
  DEFAULT_CMMS_DB,
  TAG_MAP,
  TOOL_SCHEMAS,
  createWorkOrder,
  executeManufacturingTool,
  formatToolExecutionAnswer,
  getToolSchema,
  readScadaTags,
};
