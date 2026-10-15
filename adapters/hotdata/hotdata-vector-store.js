#!/usr/bin/env node
'use strict';

/**
 * adapters/hotdata/hotdata-vector-store.js
 *
 * Drop-in Hotdata DB replacement for LanceDB in ThumbGate (`scripts/vector-store.js`).
 *
 * Built against the official Hotdata v1 API & HotSQL specification (https://www.hotdata.dev/llms.txt):
 *   - Addressing: `Authorization: Bearer <HOTDATA_API_KEY>`, `X-Workspace-Id: <work...>`, `X-Database-Id: <dbid...>`
 *   - Instant Database Provisioning: `POST /v1/databases`
 *   - Atomic Table Publishing: `POST /v1/databases/{db_id}/schemas/main/tables/{table}/loads`
 *     (`mode: "replace"` on first load, `mode: "upsert"` with `key: ["id"]` on incremental updates,
 *      with automatic fallback from inline CSV to `/v1/uploads` presigned PUT on 413 INLINE_DATA_TOO_LARGE)
 *   - Vector Indexing: `POST /v1/connections/{conn_id}/tables/main/{table}/indexes`
 *     (`index_type: "vector"`, `algorithm: "hnsw"`, `metric: "cosine"`, `vector_precision: "float32"`)
 *   - Nearest-Neighbor HotSQL Retrieval: `POST /v1/query` (`dialect: "hotsql"`)
 *     `SELECT id, text, signal, tags, timestamp, context, _distance
 *      FROM vector_search('default.main.thumbgate_memories', 'vector', '[...]', 50)
 *      ORDER BY _distance ASC LIMIT <k>`
 *   - Pre-Action Execution Diode (<0.1ms local CPU):
 *     Interdicts runaway identical HotSQL retry loops (`gate:hotdata:runaway_query_loop`) and
 *     unbounded destructive write-plane mutations (`gate:hotdata:destructive_write_boundary`).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_API_BASE = 'https://api.hotdata.dev/v1';
const DEFAULT_SCHEMA = 'main';
const DEFAULT_CATALOG = 'default';

function getHotdataConfig(overrides = {}, env = process.env) {
  const apiBaseUrl = String(overrides.apiBaseUrl || env.HOTDATA_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
  const apiKey = String(overrides.apiKey || env.HOTDATA_API_KEY || '').trim();
  const workspaceId = String(overrides.workspaceId || env.HOTDATA_WORKSPACE_ID || '').trim();
  const databaseId = String(overrides.databaseId || env.HOTDATA_DATABASE_ID || '').trim();
  const connectionId = String(overrides.connectionId || env.HOTDATA_CONNECTION_ID || '').trim();
  const schema = String(overrides.schema || env.HOTDATA_SCHEMA || DEFAULT_SCHEMA).toLowerCase();
  const catalog = String(overrides.catalog || env.HOTDATA_CATALOG || DEFAULT_CATALOG).toLowerCase();
  const vectorAlgorithm = String(overrides.vectorAlgorithm || env.HOTDATA_VECTOR_ALGORITHM || 'hnsw').toLowerCase();
  const vectorPrecision = String(overrides.vectorPrecision || env.HOTDATA_VECTOR_PRECISION || 'float32').toLowerCase();

  return {
    apiBaseUrl,
    apiKey,
    workspaceId,
    databaseId,
    connectionId,
    schema,
    catalog,
    vectorAlgorithm,
    vectorPrecision,
    remoteEnabled: Boolean(apiKey && workspaceId),
  };
}

/**
 * Sub-0.1ms PreToolUse Diode for Hotdata + Write-Boundary Workflows.
 */
function evaluateHotdataPreToolGate({ toolName, sqlOrCommand, sessionHistory = [], maxIdenticalRetries = 4 } = {}) {
  const startNs = process.hrtime.bigint();
  const raw = String(sqlOrCommand || '').trim();
  const sig = `${toolName || 'hotdata_query'}:${raw}`;
  const priorRetries = sessionHistory.filter(entry => entry === sig).length;
  sessionHistory.push(sig);

  let decision = 'allow';
  let gateId = 'gate:hotdata:pass';
  let reason = 'Cleared by ThumbGate PreToolUse diode';

  if (priorRetries >= maxIdenticalRetries) {
    decision = 'block';
    gateId = 'gate:hotdata:runaway_query_loop';
    reason = `Runaway loop interdicted (${priorRetries + 1} identical HotSQL/tool attempts) — prevents ephemeral compute & token burn`;
  } else if (/(?:\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+\w+\s*(?:;|$))/i.test(raw)) {
    decision = 'block';
    gateId = 'gate:hotdata:destructive_write_boundary';
    reason = 'Unbounded destructive SQL mutation blocked at Write Boundary before touching system of record';
  } else if (/\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b/.test(raw)) {
    decision = 'block';
    gateId = 'gate:hotdata:secret_exfiltration';
    reason = 'Plaintext credential detected in query/tool arguments — blocked before egress';
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    decision,
    allowed: decision === 'allow',
    gateId,
    latencyMs,
    reason,
  };
}

/**
 * Escape a value for inline CSV publishing to `POST /v1/databases/{db}/schemas/{schema}/tables/{table}/loads`.
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serializeRecordsToCsv(records = []) {
  const columns = ['id', 'text', 'vector', 'signal', 'tags', 'timestamp', 'context'];
  const header = columns.join(',');
  const rows = records.map(rec =>
    columns.map(col => {
      const val = col === 'timestamp' && rec[col] ? String(rec[col]).replace(/\.\d+Z$/, 'Z') : rec[col];
      return escapeCsvCell(val);
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

function cosineDistance(vecA = [], vecB = []) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 1.0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  return Number((1 - (dot / denom)).toFixed(6));
}

/**
 * Build exact HotSQL `vector_search` query for nearest-neighbor retrieval.
 */
function buildHotSqlVectorSearchQuery({ catalog = 'default', schema = 'main', table = 'thumbgate_memories', vector = [], limit = 5, whereClause = '' } = {}) {
  const qualified = `${catalog}.${schema}.${table}`.toLowerCase();
  const k = Math.max(1, Number(limit) || 5);
  const candidatePool = Math.max(k * 5, 50);
  const vectorLiteral = JSON.stringify((vector || []).map(Number));
  const filterSql = whereClause ? ` WHERE ${whereClause}` : '';

  return (
    `SELECT id, text, vector, signal, tags, timestamp, context, _distance ` +
    `FROM vector_search('${qualified}', 'vector', '${vectorLiteral}', ${candidatePool})` +
    `${filterSql} ` +
    `ORDER BY _distance ASC LIMIT ${k}`
  );
}

/**
 * Hotdata Table Handle implementing the LanceDB Table interface (`add`, `countRows`, `search`, `query`, `delete`, `schema`)
 * while executing against Hotdata's `/v1` API (or local Hotdata snapshot store in offline/test mode).
 */
class HotdataTable {
  constructor({ tableName, storeDir, config, httpClient }) {
    this.tableName = String(tableName).toLowerCase();
    this.storeDir = storeDir;
    this.config = config;
    this.httpClient = httpClient;
    this.snapshotPath = path.join(storeDir, `${this.tableName}.hotdata.jsonl`);
    this.metaPath = path.join(storeDir, `${this.tableName}.hotdata.meta.json`);
    this.sessionHistory = [];
  }

  _readLocalRows() {
    if (!fs.existsSync(this.snapshotPath)) return [];
    return fs.readFileSync(this.snapshotPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  }

  _writeLocalRows(rows, loadMode = 'replace') {
    fs.mkdirSync(this.storeDir, { recursive: true });
    fs.writeFileSync(
      this.snapshotPath,
      rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
      'utf8'
    );
    const dim = rows[0] && Array.isArray(rows[0].vector) ? rows[0].vector.length : 384;
    fs.writeFileSync(
      this.metaPath,
      JSON.stringify({
        schemaVersion: 'hotdata.table.v1',
        catalog: this.config.catalog,
        schema: this.config.schema,
        table: this.tableName,
        lastLoadMode: loadMode,
        rowCount: rows.length,
        vectorDimension: dim,
        index: {
          index_name: `${this.tableName}_vec_idx`,
          index_type: 'vector',
          algorithm: this.config.vectorAlgorithm,
          metric: 'cosine',
          vector_precision: this.config.vectorPrecision,
          status: 'ready',
        },
        updatedAt: new Date().toISOString(),
      }, null, 2),
      'utf8'
    );
  }

  async add(records = [], options = {}) {
    if (!Array.isArray(records) || records.length === 0) return { loaded: 0 };

    const existing = this._readLocalRows();
    const isFirstLoad = existing.length === 0;
    const mode = options.mode || (isFirstLoad ? 'replace' : 'upsert');

    // Enforce PreToolUse diode before publishing
    const gate = evaluateHotdataPreToolGate({
      toolName: 'hotdata_table_load',
      sqlOrCommand: `LOAD ${this.config.catalog}.${this.config.schema}.${this.tableName} MODE ${mode} ROWS ${records.length}`,
      sessionHistory: this.sessionHistory,
    });
    if (!gate.allowed) {
      throw new Error(`ThumbGate PreToolUse Blocked Hotdata Load (${gate.gateId}): ${gate.reason}`);
    }

    // Remote Hotdata API execution when credentials are configured
    if (this.config.remoteEnabled && this.httpClient) {
      const csvData = serializeRecordsToCsv(records);
      const contentHash = crypto.createHash('sha256').update(`${mode}::${csvData}`).digest('hex').slice(0, 32);
      const loadBody = {
        mode,
        ...(mode === 'upsert' ? { key: ['id'] } : {}),
        data: csvData,
        format: 'csv',
        idempotency_key: `tg_${contentHash}`,
      };
      await this.httpClient.publishTableLoad({
        table: this.tableName,
        body: loadBody,
        records,
      });
    }

    // Local Arrow/NDJSON mirror for instant zero-network fallback & deterministic tests
    let merged;
    if (mode === 'replace') {
      merged = records.slice();
    } else if (mode === 'upsert') {
      const byId = new Map(existing.map(r => [r.id, r]));
      for (const rec of records) {
        byId.set(rec.id, rec);
      }
      merged = Array.from(byId.values());
    } else {
      merged = [...existing, ...records];
    }

    this._writeLocalRows(merged, mode);
    return {
      ok: true,
      mode,
      loaded: records.length,
      totalRows: merged.length,
      gateLatencyMs: gate.latencyMs,
    };
  }

  async countRows() {
    return this._readLocalRows().length;
  }

  async schema() {
    const rows = this._readLocalRows();
    const dim = rows[0] && Array.isArray(rows[0].vector) ? rows[0].vector.length : 384;
    return {
      fields: [
        { name: 'id', type: 'utf8' },
        { name: 'text', type: 'utf8' },
        { name: 'vector', type: { listSize: dim, valueType: 'float32' } },
        { name: 'signal', type: 'utf8' },
        { name: 'tags', type: 'utf8' },
        { name: 'timestamp', type: 'utf8' },
        { name: 'context', type: 'utf8' },
      ],
    };
  }

  query() {
    const self = this;
    let _limit = 10;
    return {
      limit(n) {
        _limit = n;
        return this;
      },
      async toArray() {
        return self._readLocalRows().slice(0, _limit);
      },
    };
  }

  search(queryVector) {
    const self = this;
    let _limit = 5;
    let _where = '';
    return {
      where(clause) {
        _where = clause;
        return this;
      },
      limit(n) {
        _limit = n;
        return this;
      },
      async toArray() {
        const sql = buildHotSqlVectorSearchQuery({
          catalog: self.config.catalog,
          schema: self.config.schema,
          table: self.tableName,
          vector: queryVector,
          limit: _limit,
          whereClause: _where,
        });

        const gate = evaluateHotdataPreToolGate({
          toolName: 'hotdata_query',
          sqlOrCommand: sql,
          sessionHistory: self.sessionHistory,
        });
        if (!gate.allowed) {
          throw new Error(`ThumbGate PreToolUse Blocked HotSQL Query (${gate.gateId}): ${gate.reason}`);
        }

        if (self.config.remoteEnabled && self.httpClient) {
          const remoteRows = await self.httpClient.executeHotSql(sql);
          if (Array.isArray(remoteRows)) {
            return remoteRows
              .map(row => {
                let parsedVec = row.vector;
                if (typeof parsedVec === 'string') {
                  try { parsedVec = JSON.parse(parsedVec); } catch { parsedVec = null; }
                }
                const dist = Array.isArray(parsedVec) && parsedVec.length === queryVector.length
                  ? cosineDistance(queryVector, parsedVec)
                  : Number(row._distance ?? 1.0);
                return { ...row, ...(Array.isArray(parsedVec) ? { vector: parsedVec } : {}), _distance: dist };
              })
              .sort((a, b) => a._distance - b._distance)
              .slice(0, _limit);
          }
        }

        const rows = self._readLocalRows();
        return rows
          .map(row => ({
            ...row,
            _distance: cosineDistance(queryVector, row.vector),
          }))
          .sort((a, b) => a._distance - b._distance)
          .slice(0, _limit);
      },
    };
  }

  async delete() {
    this._writeLocalRows([], 'replace');
  }
}

/**
 * Hotdata HTTP v1 API Client (`https://api.hotdata.dev/v1`).
 */
class HotdataHttpClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.requestsLog = [];
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-Workspace-Id': this.config.workspaceId,
      ...(this.config.databaseId ? { 'X-Database-Id': this.config.databaseId } : {}),
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async publishTableLoad({ table, body, records }) {
    const url = `${this.config.apiBaseUrl}/databases/${this.config.databaseId}/schemas/${this.config.schema}/tables/${table}/loads`;
    this.requestsLog.push({ method: 'POST', url, mode: body.mode, rowCount: records.length });
    if (!this.fetchImpl) return { status: 200 };

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    // Per Push Data spec: 413 INLINE_DATA_TOO_LARGE branches to /v1/uploads presigned PUT
    if (res.status === 413) {
      return this.uploadViaPresignedSession({ table, body, records });
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Hotdata load failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    return res.json().catch(() => ({ ok: true }));
  }

  async uploadViaPresignedSession({ table, body, records }) {
    const ndjson = records.map(r => JSON.stringify(r)).join('\n');
    const byteLength = Buffer.byteLength(ndjson, 'utf8');

    // Step 1: Open upload session
    const sessionUrl = `${this.config.apiBaseUrl}/uploads`;
    this.requestsLog.push({ method: 'POST', url: sessionUrl, declared_size_bytes: byteLength });
    const sessionRes = await this.fetchImpl(sessionUrl, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        filename: `${table}.ndjson`,
        declared_size_bytes: byteLength,
        content_type: 'application/x-ndjson',
      }),
    });
    const session = await sessionRes.json();

    // Step 2: PUT bytes to presigned URL
    const putUrl = session.url || (session.part_urls && session.part_urls[0]);
    if (putUrl) {
      await this.fetchImpl(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: ndjson,
      });
    }

    // Step 3: Finalize upload
    const finalizeUrl = `${this.config.apiBaseUrl}/uploads/${session.upload_id}/finalize`;
    await this.fetchImpl(finalizeUrl, {
      method: 'POST',
      headers: this._headers({ 'X-Upload-Finalize-Token': session.finalize_token || '' }),
      body: JSON.stringify({}),
    });

    // Step 4: Load by upload_id
    const loadUrl = `${this.config.apiBaseUrl}/databases/${this.config.databaseId}/schemas/${this.config.schema}/tables/${table}/loads`;
    const loadRes = await this.fetchImpl(loadUrl, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        mode: body.mode,
        ...(body.key ? { key: body.key } : {}),
        upload_id: session.upload_id,
        format: 'json',
      }),
    });
    return loadRes.json().catch(() => ({ ok: true }));
  }

  async ensureVectorIndex({ table, column = 'vector' }) {
    if (!this.config.connectionId) return null;
    const url = `${this.config.apiBaseUrl}/connections/${this.config.connectionId}/tables/${this.config.schema}/${table}/indexes`;
    const payload = {
      index_name: `${table}_${column}_idx`,
      index_type: 'vector',
      algorithm: this.config.vectorAlgorithm,
      columns: [column],
      metric: 'cosine',
      vector_precision: this.config.vectorPrecision,
    };
    this.requestsLog.push({ method: 'POST', url, payload });
    if (!this.fetchImpl) return payload;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => payload);
  }

  async executeHotSql(sql) {
    const url = `${this.config.apiBaseUrl}/query`;
    const payload = {
      async: false,
      database_id: this.config.databaseId,
      default_catalog: this.config.catalog,
      default_schema: this.config.schema,
      dialect: 'hotsql',
      sql,
    };
    this.requestsLog.push({ method: 'POST', url, payload });
    if (!this.fetchImpl) return null;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return null;
    return data.rows.map(rowArr => {
      const obj = {};
      data.columns.forEach((col, idx) => {
        obj[col] = rowArr[idx];
      });
      return obj;
    });
  }
}

/**
 * Create a LanceDB-compatible `{ connect(dirOrOptions) }` loader backed by Hotdata DB.
 */
function createHotdataLanceAdapter(options = {}) {
  const config = getHotdataConfig(options);
  const httpClient = new HotdataHttpClient(config, options.fetchImpl);

  return {
    backend: 'hotdata',
    config,
    httpClient,
    async connect(storeDir) {
      const dir = typeof storeDir === 'string' ? storeDir : path.join(process.cwd(), '.thumbgate', 'hotdata');
      fs.mkdirSync(dir, { recursive: true });

      return {
        backend: 'hotdata',
        async tableNames() {
          if (!fs.existsSync(dir)) return [];
          return fs.readdirSync(dir)
            .filter(f => f.endsWith('.hotdata.jsonl'))
            .map(f => f.replace(/\.hotdata\.jsonl$/, ''));
        },
        async createTable(tableName, initialRecords = []) {
          const table = new HotdataTable({ tableName, storeDir: dir, config, httpClient });
          await table.add(initialRecords, { mode: 'replace' });
          if (config.remoteEnabled && config.connectionId) {
            await httpClient.ensureVectorIndex({ table: tableName, column: 'vector' });
          }
          return table;
        },
        async openTable(tableName) {
          return new HotdataTable({ tableName, storeDir: dir, config, httpClient });
        },
        async dropTable(tableName) {
          const t = new HotdataTable({ tableName, storeDir: dir, config, httpClient });
          if (fs.existsSync(t.snapshotPath)) fs.unlinkSync(t.snapshotPath);
          if (fs.existsSync(t.metaPath)) fs.unlinkSync(t.metaPath);
        },
      };
    },
  };
}

module.exports = {
  getHotdataConfig,
  evaluateHotdataPreToolGate,
  buildHotSqlVectorSearchQuery,
  serializeRecordsToCsv,
  cosineDistance,
  HotdataTable,
  HotdataHttpClient,
  createHotdataLanceAdapter,
};
