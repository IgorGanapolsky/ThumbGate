'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { executeRAGPipeline } = require('./middleware/rag');
const { activeProvider } = require('./middleware/llm');
const { captureFeedback } = require('../../scripts/feedback-loop');

const PORT = process.env.PORT || 3005;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Helper to send JSON response
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Helper to serve static files
function serveStaticFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

// Server router
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route: Static files
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html');
      return;
    }
    if (pathname === '/index.css') {
      serveStaticFile(res, path.join(PUBLIC_DIR, 'index.css'), 'text/css');
      return;
    }
  }

  // Route: /api/ask
  if (req.method === 'POST' && pathname === '/api/ask') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { question } = payload;

        if (!question || typeof question !== 'string') {
          return sendJSON(res, 400, { error: 'Question is required and must be a string.' });
        }

        console.log(`[Server] Received question: "${question}"`);

        // If no provider keys are set, run in local demo mock mode so the app is always functional
        const provider = activeProvider();
        if (provider === 'none') {
          console.log('[Server] No LLM keys found. Running in local mock/demo mode.');
          const response = mockPipelineExecution(question);
          return sendJSON(res, 200, response);
        }

        const result = await executeRAGPipeline(question);
        return sendJSON(res, 200, result);
      } catch (error) {
        console.error('[Server] Pipeline Error:', error);
        return sendJSON(res, 500, { error: error.message });
      }
    });
    return;
  }

  // Route: /api/feedback (RLHF Feedback Capture)
  if (req.method === 'POST' && pathname === '/api/feedback') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { signal, question, answer } = payload;

        if (!signal || !['up', 'down'].includes(signal)) {
          return sendJSON(res, 400, { error: 'Signal is required and must be "up" or "down".' });
        }

        console.log(`[Server] Received feedback: ${signal.toUpperCase()} on question: "${question}"`);

        // Capture feedback in ThumbGate's local lesson DB
        const result = await captureFeedback({
          signal,
          context: `User query: "${question}" | Answer: "${answer}"`,
          tags: ['manufacturing-copilot', 'rlhf-demo'],
        });

        return sendJSON(res, 200, { success: true, feedbackEvent: result });
      } catch (error) {
        console.error('[Server] Feedback Error:', error);
        return sendJSON(res, 500, { error: error.message });
      }
    });
    return;
  }

  // 404 fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

// Helper for Mock Mode when offline or during credentials setup
function mockPipelineExecution(question) {
  const q = question.toLowerCase();
  
  let answer = '';
  let status = 'pass';
  let toolCall = null;
  let gates = [
    {
      gate: 'rlhf_feedback_layer',
      status: 'pass',
      detail: 'Answer generated. Operator feedback thumbs-up/down requested.'
    }
  ];

  let spans = [
    { name: 'detect_tool_call', runType: 'chain', ms: 5, status: 'ok' },
    { name: 'retrieval', runType: 'retriever', ms: 120, status: 'ok' },
    { name: 'llm_call', runType: 'llm', ms: 750, status: 'ok' },
  ];

  // Mock Scenario 1: Harmful Tool Call - Bypass Safety
  if (q.includes('bypass') || q.includes('disable') || q.includes('override') || q.includes('mute')) {
    status = 'blocked';
    toolCall = {
      toolName: 'override_interlock',
      input: { machine: 'CNC Mill VM-22', parameter: 'safety_interlock', value: 'disabled' },
      description: 'Defeat machine safety guard or interlock switch'
    };
    gates = [
      {
        gate: 'no_safety_bypass',
        status: 'block',
        detail: 'CRITICAL SECURITY VIOLATION: Defeating or bypassing machine interlocks is strictly prohibited under safety regulation SP-110.',
        toolName: 'override_interlock',
        input: toolCall.input
      }
    ];
    answer = `[ThumbGate Firewall Blocked Action]\nTool: override_interlock\nReason: CRITICAL SECURITY VIOLATION: Defeating or bypassing machine interlocks is strictly prohibited under safety regulation SP-110.`;
    spans = [
      { name: 'detect_tool_call', runType: 'chain', ms: 4, status: 'ok' },
      { name: 'pre_tool_use_gate', runType: 'llm', ms: 12, status: 'error', error: 'Blocked: no_safety_bypass' }
    ];
  }
  // Mock Scenario 2: Harmful Tool Call - Shutdown
  else if (q.includes('shutdown') || q.includes('stop assembly') || q.includes('turn off')) {
    status = 'blocked';
    toolCall = {
      toolName: 'trigger_emergency_shutdown',
      input: { target: 'Conveyor Line C-3', reason: 'Operator manual request' },
      description: 'Activate emergency power cutoff to manufacturing line'
    };
    gates = [
      {
        gate: 'no_unauthorized_shutdown',
        status: 'block',
        detail: 'BLOCKED: Emergency line shutdown tool calls require supervisor authorization code or a detected sensor anomaly.',
        toolName: 'trigger_emergency_shutdown',
        input: toolCall.input
      }
    ];
    answer = `[ThumbGate Firewall Blocked Action]\nTool: trigger_emergency_shutdown\nReason: BLOCKED: Emergency line shutdown tool calls require supervisor authorization code or a detected sensor anomaly.`;
    spans = [
      { name: 'detect_tool_call', runType: 'chain', ms: 4, status: 'ok' },
      { name: 'pre_tool_use_gate', runType: 'llm', ms: 11, status: 'error', error: 'Blocked: no_unauthorized_shutdown' }
    ];
  }
  // Mock Scenario 3: Standard LOTO Question
  else if (q.includes('loto') || q.includes('lockout') || q.includes('tagout')) {
    answer = `To perform Lockout/Tagout (LOTO) on the Hydraulic Press Line per SP-101:
1. Notify affected employees.
2. Shut down the press from the console.
3. Isolate main electrical disconnect (Panel E-7) and hydraulic accumulator bleed valve (V-12).
4. Apply personal lock and tag to each point.
5. Cycle bleed valve until pressure reads 0 PSI.
[Cited: SP-101]`;
  }
  // General response
  else {
    answer = `Acme Plant 7 Operational Copilot. Ask a question regarding LOTO or maintenance procedures, or submit a request to operate line systems.`;
  }

  return {
    answer,
    status,
    toolCall,
    gates,
    traceId: `mock-trace-${Date.now()}`,
    project: 'thumbgate-manufacturing-copilot',
    remote: false,
    spans,
  };
}

server.listen(PORT, () => {
  console.log(`Manufacturing copilot demo: http://localhost:${PORT}`);
});
