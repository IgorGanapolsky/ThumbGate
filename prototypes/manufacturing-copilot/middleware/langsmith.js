'use strict';

// Minimal LangSmith tracer over the REST API — no SDK dependency.
// Every /api/ask request becomes a root "chain" run; each pipeline stage
// (gates, router, retrieval, LLM call) is a child run. Without
// LANGSMITH_API_KEY the tracer degrades to an in-memory trace that the
// front-end still renders, so the demo works offline.

const crypto = require('node:crypto');

const LANGSMITH_API_URL = process.env.LANGSMITH_API_URL || 'https://api.smith.langchain.com';
const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || 'thumbgate-manufacturing-copilot';

function enabled() {
  return Boolean(process.env.LANGSMITH_API_KEY);
}

async function post(path, body, method = 'POST') {
  try {
    const res = await fetch(`${LANGSMITH_API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.LANGSMITH_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[langsmith] ${method} ${path} -> ${res.status}`);
    }
  } catch (err) {
    console.error(`[langsmith] ${err.message}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

class Trace {
  constructor(name, inputs) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.startTime = nowIso();
    this.spans = [];
    if (enabled()) {
      post('/runs', {
        id: this.id,
        name,
        run_type: 'chain',
        start_time: this.startTime,
        inputs,
        session_name: LANGSMITH_PROJECT,
      });
    }
  }

  async span(name, runType, inputs, fn) {
    const id = crypto.randomUUID();
    const start = nowIso();
    const startedAt = Date.now();
    if (enabled()) {
      post('/runs', {
        id,
        name,
        run_type: runType,
        start_time: start,
        inputs,
        parent_run_id: this.id,
        session_name: LANGSMITH_PROJECT,
      });
    }
    try {
      const outputs = await fn();
      this.spans.push({ name, runType, ms: Date.now() - startedAt, status: 'ok', outputs });
      if (enabled()) {
        post(`/runs/${id}`, { end_time: nowIso(), outputs: { output: outputs } }, 'PATCH');
      }
      return outputs;
    } catch (err) {
      this.spans.push({ name, runType, ms: Date.now() - startedAt, status: 'error', error: err.message });
      if (enabled()) {
        post(`/runs/${id}`, { end_time: nowIso(), error: err.message }, 'PATCH');
      }
      throw err;
    }
  }

  end(outputs = {}) {
    if (enabled()) {
      post(`/runs/${this.id}`, { end_time: nowIso(), outputs }, 'PATCH');
    }
    return {
      ...outputs,
      traceId: this.id,
      project: LANGSMITH_PROJECT,
      remote: enabled(),
      spans: this.spans,
    };
  }
}

module.exports = { Trace, enabled, LANGSMITH_PROJECT };
