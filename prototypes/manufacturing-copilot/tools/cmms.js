'use strict';

// Real CMMS (Computerized Maintenance Management System) store.
// Backed by better-sqlite3 with genuine persistence: every row exists because
// a tool call created it — no fabricated/mock responses anywhere in this file.
// Parts inventory is seeded once from the part numbers that appear in the
// plant's actual manuals (data/maintenance-manual.md); after that, quantities
// only change through real reserve_part tool calls.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DB_DIR = process.env.MANUFACTURING_CMMS_DIR
  || path.join(__dirname, '../db');
const DB_PATH = path.join(DB_DIR, 'cmms.sqlite');

let _db = null;

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine TEXT NOT NULL,
      procedure_code TEXT,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS parts_inventory (
      part_number TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      bin_location TEXT
    );
    CREATE TABLE IF NOT EXISTS part_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_number TEXT NOT NULL REFERENCES parts_inventory(part_number),
      work_order_id INTEGER REFERENCES work_orders(id),
      quantity INTEGER NOT NULL,
      reserved_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_role TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      related_question TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seedPartsFromManuals(_db);
  return _db;
}

// Seed strictly from part numbers that the plant manuals actually reference.
// Idempotent: INSERT OR IGNORE, so real reservations are never overwritten.
function seedPartsFromManuals(db) {
  const seed = db.prepare(
    'INSERT OR IGNORE INTO parts_inventory (part_number, description, quantity, bin_location) VALUES (?, ?, ?, ?)'
  );
  // Sources: MM-201 (HF-4420 hydraulic filter), MM-210 (Kluber NBU 15 grease),
  // MM-215 (AC-1 intake filter), QC-301 (PG-12 plug gauge).
  seed.run('HF-4420', 'Hydraulic filter element — HP-400 press (MM-201)', 12, 'A-03');
  seed.run('NBU-15', 'Kluber NBU 15 spindle grease — VM-22 (MM-210)', 6, 'B-11');
  seed.run('AC1-INTAKE', 'Intake filter — air compressor AC-1 (MM-215)', 4, 'A-07');
  seed.run('PG-12', 'Plug gauge 12.00mm — bracket B-77 inspection (QC-301)', 3, 'QC-CAB-2');
}

function createWorkOrder({ machine, procedureCode, description, priority = 'medium', requestedBy }) {
  if (!machine || !description || !requestedBy) {
    throw new Error('machine, description, and requestedBy are required');
  }
  const db = getDb();
  const result = db
    .prepare(
      'INSERT INTO work_orders (machine, procedure_code, description, priority, requested_by) VALUES (?, ?, ?, ?, ?)'
    )
    .run(machine, procedureCode || null, description, priority, requestedBy);
  return getWorkOrder(result.lastInsertRowid);
}

function getWorkOrder(id) {
  return getDb().prepare('SELECT * FROM work_orders WHERE id = ?').get(id) || null;
}

function listWorkOrders({ status = 'open', limit = 10 } = {}) {
  if (status === 'all') {
    return getDb().prepare('SELECT * FROM work_orders ORDER BY created_at DESC LIMIT ?').all(limit);
  }
  return getDb()
    .prepare('SELECT * FROM work_orders WHERE status = ? ORDER BY created_at DESC LIMIT ?')
    .all(status, limit);
}

function checkPartInventory(partNumber) {
  if (partNumber) {
    const part = getDb()
      .prepare('SELECT * FROM parts_inventory WHERE part_number = ? COLLATE NOCASE')
      .get(partNumber);
    return part || { part_number: partNumber, found: false };
  }
  return getDb().prepare('SELECT * FROM parts_inventory ORDER BY part_number').all();
}

function reservePart({ partNumber, quantity = 1, workOrderId = null, reservedBy }) {
  if (!partNumber || !reservedBy) throw new Error('partNumber and reservedBy are required');
  const db = getDb();
  const reserve = db.transaction(() => {
    const part = db
      .prepare('SELECT * FROM parts_inventory WHERE part_number = ? COLLATE NOCASE')
      .get(partNumber);
    if (!part) throw new Error(`Unknown part number: ${partNumber}`);
    if (part.quantity < quantity) {
      throw new Error(`Insufficient stock for ${part.part_number}: ${part.quantity} on hand, ${quantity} requested`);
    }
    db.prepare('UPDATE parts_inventory SET quantity = quantity - ? WHERE part_number = ?')
      .run(quantity, part.part_number);
    const r = db
      .prepare('INSERT INTO part_reservations (part_number, work_order_id, quantity, reserved_by) VALUES (?, ?, ?, ?)')
      .run(part.part_number, workOrderId, quantity, reservedBy);
    return {
      reservationId: r.lastInsertRowid,
      partNumber: part.part_number,
      quantityReserved: quantity,
      quantityRemaining: part.quantity - quantity,
      binLocation: part.bin_location,
    };
  });
  return reserve();
}

function createEscalation({ toRole, reason, requestedBy, relatedQuestion = null }) {
  if (!toRole || !reason || !requestedBy) {
    throw new Error('toRole, reason, and requestedBy are required');
  }
  const db = getDb();
  const result = db
    .prepare('INSERT INTO escalations (to_role, reason, requested_by, related_question) VALUES (?, ?, ?, ?)')
    .run(toRole, reason, requestedBy, relatedQuestion);
  return getDb().prepare('SELECT * FROM escalations WHERE id = ?').get(result.lastInsertRowid);
}

function listEscalations({ limit = 10 } = {}) {
  return getDb().prepare('SELECT * FROM escalations ORDER BY created_at DESC LIMIT ?').all(limit);
}

// Test hook: close + reset connection (used with MANUFACTURING_CMMS_DIR temp dirs).
function _close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  DB_PATH,
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  checkPartInventory,
  reservePart,
  createEscalation,
  listEscalations,
  _close,
};
