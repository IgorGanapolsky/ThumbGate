'use strict';

/**
 * PPL (Piped Processing Language) Engine for Agent Observability & Pre-Action Alerting.
 *
 * Implements a lightweight, zero-dependency Unix pipeline processing model:
 *   source | filter <expr> | stats <agg> by <field> | where <expr> | eval <expr> | alert <params>
 *
 * Designed to prevent alert-rule sprawl, false-positive fatigue, and telemetry ingestion bottlenecks.
 */

class PPLPipeline {
  constructor(stages = []) {
    this.stages = stages;
  }

  static parse(pplString) {
    if (typeof pplString !== 'string' || !pplString.trim()) {
      throw new Error('PPL pipeline string must be a non-empty string');
    }

    const stageDefs = pplString
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);

    const stages = [];

    for (const rawStage of stageDefs) {
      const parts = rawStage.split(/\s+/);
      const op = parts[0].toLowerCase();
      const rest = rawStage.slice(parts[0].length).trim();

      if (op === 'filter' || op === 'where') {
        stages.push({ type: 'filter', expr: rest });
      } else if (op === 'stats') {
        stages.push(PPLPipeline._parseStats(rest));
      } else if (op === 'eval') {
        stages.push(PPLPipeline._parseEval(rest));
      } else if (op === 'dedup') {
        stages.push({ type: 'dedup', field: rest.trim() });
      } else if (op === 'head' || op === 'limit') {
        stages.push({ type: 'limit', count: Number.parseInt(rest, 10) || 10 });
      } else {
        throw new Error(`Unsupported PPL operator: ${op}`);
      }
    }

    return new PPLPipeline(stages);
  }

  static _parseStats(rest) {
    const byIndex = rest.toLowerCase().indexOf(' by ');
    let aggStr = rest;
    let byField = null;

    if (byIndex !== -1) {
      aggStr = rest.slice(0, byIndex).trim();
      byField = rest.slice(byIndex + 4).trim();
    }

    const aggs = [];
    const aggTokens = aggStr.split(',').map((s) => s.trim());

    for (const token of aggTokens) {
      const funcMatch = /^([a-z0-9_]+)\((.*?)\)(?:\s+as\s+([a-z0-9_]+))?$/i.exec(token);
      if (funcMatch) {
        aggs.push({
          func: funcMatch[1].toLowerCase(),
          field: funcMatch[2].trim() || null,
          alias: funcMatch[3] ? funcMatch[3].trim() : `${funcMatch[1].toLowerCase()}_${funcMatch[2] || 'all'}`,
        });
      }
    }

    return { type: 'stats', aggs, byField };
  }

  static _parseEval(rest) {
    const eqIndex = rest.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid eval syntax: ${rest}`);
    }
    return { type: 'eval', target: rest.slice(0, eqIndex).trim(), expr: rest.slice(eqIndex + 1).trim() };
  }

  execute(records = []) {
    let current = Array.isArray(records) ? [...records] : [];

    for (const stage of this.stages) {
      switch (stage.type) {
        case 'filter':
          current = current.filter((r) => PPLPipeline._evalPredicate(r, stage.expr));
          break;
        case 'stats':
          current = PPLPipeline._execStats(current, stage);
          break;
        case 'eval':
          current = current.map((r) => PPLPipeline._execEval(r, stage));
          break;
        case 'dedup':
          current = PPLPipeline._execDedup(current, stage.field);
          break;
        case 'limit':
          current = current.slice(0, stage.count);
          break;
        default:
          break;
      }
    }

    return current;
  }

  static _evalPredicate(record, expr) {
    const tokens = /^([a-z0-9_.]+)\s*(==|!=|>=|<=|>|<|contains)\s*([\s\S]+)$/i.exec(expr);
    if (!tokens) return true;

    const [, field, op, rawVal] = tokens;
    const actual = PPLPipeline._getProp(record, field);
    let target = rawVal.trim().replace(/^['"]|['"]$/g, '');

    if (!Number.isNaN(Number(target)) && target !== '') {
      target = Number(target);
    }

    switch (op) {
      case '==':
        return actual === target;
      case '!=':
        return actual !== target;
      case '>':
        return Number(actual) > Number(target);
      case '>=':
        return Number(actual) >= Number(target);
      case '<':
        return Number(actual) < Number(target);
      case '<=':
        return Number(actual) <= Number(target);
      case 'contains':
        return String(actual || '').includes(String(target));
      default:
        return true;
    }
  }

  static _execEval(record, stage) {
    const res = { ...record };
    const exprTokens = /^([a-z0-9_.]+)\s*([+\-*/><=!]+)\s*([\s\S]+)$/i.exec(stage.expr);
    if (exprTokens) {
      const [, left, op, right] = exprTokens;
      const leftVal = PPLPipeline._getProp(record, left);
      let rightVal = right.trim().replace(/^['"]|['"]$/g, '');
      if (!Number.isNaN(Number(rightVal))) rightVal = Number(rightVal);

      if (op === '>') res[stage.target] = Number(leftVal) > Number(rightVal);
      else if (op === '>=') res[stage.target] = Number(leftVal) >= Number(rightVal);
      else if (op === '<') res[stage.target] = Number(leftVal) < Number(rightVal);
      else if (op === '<=') res[stage.target] = Number(leftVal) <= Number(rightVal);
      else if (op === '==') res[stage.target] = leftVal === rightVal;
      else if (op === '+') res[stage.target] = Number(leftVal) + Number(rightVal);
      else if (op === '-') res[stage.target] = Number(leftVal) - Number(rightVal);
    } else {
      res[stage.target] = stage.expr;
    }
    return res;
  }

  static _execStats(records, stage) {
    const groups = new Map();

    for (const r of records) {
      const key = stage.byField ? String(PPLPipeline._getProp(r, stage.byField) || 'null') : '__all__';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(r);
    }

    const results = [];

    for (const [key, rows] of groups.entries()) {
      const rowRes = {};
      if (stage.byField) {
        rowRes[stage.byField] = key === 'null' ? null : key;
      }

      for (const agg of stage.aggs) {
        if (agg.func === 'count') {
          rowRes[agg.alias] = rows.length;
        } else if (agg.func === 'avg') {
          const sum = rows.reduce((s, r) => s + (Number(PPLPipeline._getProp(r, agg.field)) || 0), 0);
          rowRes[agg.alias] = rows.length > 0 ? sum / rows.length : 0;
        } else if (agg.func === 'sum') {
          rowRes[agg.alias] = rows.reduce((s, r) => s + (Number(PPLPipeline._getProp(r, agg.field)) || 0), 0);
        } else if (agg.func === 'p95') {
          const vals = rows
            .map((r) => Number(PPLPipeline._getProp(r, agg.field)))
            .filter((v) => !Number.isNaN(v))
            .sort((a, b) => a - b);
          if (vals.length === 0) {
            rowRes[agg.alias] = 0;
          } else {
            const idx = Math.floor(vals.length * 0.95);
            rowRes[agg.alias] = vals[Math.min(idx, vals.length - 1)];
          }
        }
      }
      results.push(rowRes);
    }

    return results;
  }

  static _execDedup(records, field) {
    const seen = new Set();
    const out = [];
    for (const r of records) {
      const val = PPLPipeline._getProp(r, field);
      if (!seen.has(val)) {
        seen.add(val);
        out.push(r);
      }
    }
    return out;
  }

  static _getProp(obj, pathStr) {
    if (!obj || !pathStr) return undefined;
    const parts = pathStr.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }
}

/**
 * Unified Alert Manager with deduping window.
 */
class UnifiedAlertManager {
  constructor({ dedupWindowMs = 60000 } = {}) {
    this.dedupWindowMs = dedupWindowMs;
    this.lastAlertTime = new Map();
  }

  evaluateAlert(pipeline, records = [], { alertThresholdField, severity = 'high', alertName = 'unnamed-alert' } = {}) {
    const matched = pipeline.execute(records);
    const triggered = [];

    const now = Date.now();

    for (const row of matched) {
      const isBreach = alertThresholdField ? Boolean(row[alertThresholdField]) : true;
      if (isBreach) {
        const entityKey = `${alertName}:${JSON.stringify(row)}`;
        const lastSent = this.lastAlertTime.get(entityKey) || 0;
        if (now - lastSent >= this.dedupWindowMs) {
          this.lastAlertTime.set(entityKey, now);
          triggered.push({
            alertName,
            severity,
            timestamp: now,
            data: row,
          });
        }
      }
    }

    return {
      triggered: triggered.length > 0,
      alerts: triggered,
      evaluatedRows: records.length,
      matchedRows: matched.length,
    };
  }
}

module.exports = {
  PPLPipeline,
  UnifiedAlertManager,
};
