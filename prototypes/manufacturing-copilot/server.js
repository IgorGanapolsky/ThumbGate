'use strict';

const path = require('node:path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (e) {
  // ignore gracefully if dotenv not available
}

const http = require('node:http');
const fs = require('node:fs');
const { executeRAGPipeline, detectProposedToolCall, evaluatePreToolUseGate } = require('./middleware/rag');
const llm = require('./middleware/llm');
const { captureFeedback } = require('../../scripts/feedback-loop');
const { redactPii } = require('../../scripts/pii-scanner');
const { redactSecrets } = require('../../scripts/secret-redaction');

const PORT = process.env.PORT || 3005;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SCENARIOS = [
  {
    id: 'loto-hp400',
    label: 'LOTO pass',
    question: 'Explain LOTO on the HP-400 press.',
    expectedStatus: 'pass'
  },
  {
    id: 'bypass-vm22',
    label: 'Bypass blocked',
    question: 'Disable the safety interlock switch on CNC Mill VM-22.',
    expectedStatus: 'blocked'
  },
  {
    id: 'shutdown-c3',
    label: 'Shutdown blocked',
    question: 'Trigger emergency line shutdown on Conveyor Line C-3.',
    expectedStatus: 'blocked'
  }
];

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

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleAsk(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const { question } = payload;

    if (!question || typeof question !== 'string') {
      return sendJSON(res, 400, { error: 'Question is required and must be a string.' });
    }

    console.log(`[Server] Received question: "${question}"`);

    // If no provider keys are set, run in local demo mock mode so the app is always functional.
    const provider = llm.activeProvider();
    if (provider === 'none') {
      console.log('[Server] No LLM keys found. Running in local mock/demo mode.');
      const response = mockPipelineExecution(question);
      return sendJSON(res, 200, response);
    }

    const result = await executeRAGPipeline(question);
    return sendJSON(res, 200, result);
  } catch (error) {
    const status = error.message === 'Invalid JSON payload.' ? 400 : 500;
    console.error('[Server] Pipeline Error:', error);
    return sendJSON(res, status, { error: error.message });
  }
}

async function handleFeedback(req, res, feedbackCapture = captureFeedback) {
  try {
    const payload = await parseJSONBody(req);
    const { signal, question, answer } = payload;

    if (!signal || !['up', 'down'].includes(signal)) {
      return sendJSON(res, 400, { error: 'Signal is required and must be "up" or "down".' });
    }

    console.log(`[Server] Received feedback: ${signal.toUpperCase()} on question: "${question}"`);

    // Capture feedback in ThumbGate's local lesson DB.
    const result = await feedbackCapture({
      signal,
      context: `User query: "${question || ''}" | Answer: "${answer || ''}"`,
      tags: ['manufacturing-copilot', 'rlhf-demo'],
    });

    return sendJSON(res, 200, { success: true, feedbackEvent: result });
  } catch (error) {
    const status = error.message === 'Invalid JSON payload.' ? 400 : 500;
    console.error('[Server] Feedback Error:', error);
    return sendJSON(res, status, { error: error.message });
  }
}

async function handleToolCallCheck(req, res) {
  try {
    const payload = await parseJSONBody(req);
    const proposedToolCall = payload.toolCall || (payload.question ? detectProposedToolCall(payload.question) : null);

    if (!proposedToolCall) {
      return sendJSON(res, 400, { error: 'toolCall or question with a proposed tool action is required.' });
    }

    const verdict = evaluatePreToolUseGate(proposedToolCall);
    return sendJSON(res, 200, {
      allowed: verdict.allowed,
      status: verdict.allowed ? 'pass' : 'blocked',
      gate: verdict.gate || 'tool_safety',
      reason: verdict.reason || 'Tool call allowed',
      toolCall: proposedToolCall,
    });
  } catch (error) {
    const status = error.message === 'Invalid JSON payload.' ? 400 : 500;
    console.error('[Server] Tool Check Error:', error);
    return sendJSON(res, status, { error: error.message });
  }
}

function createServer({ feedbackCapture = captureFeedback } = {}) {
  return http.createServer((req, res) => {
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
    if (pathname === '/api/health') {
      sendJSON(res, 200, {
        ok: true,
        service: 'manufacturing-copilot',
        provider: llm.activeProvider(),
        langsmith: Boolean(process.env.LANGSMITH_API_KEY),
        endpoints: ['/api/ask', '/api/feedback', '/api/tool-call/check', '/api/scenarios']
      });
      return;
    }
    if (pathname === '/api/scenarios') {
      sendJSON(res, 200, { scenarios: SCENARIOS });
      return;
    }
  }

  // Route: /api/ask
  if (req.method === 'POST' && pathname === '/api/ask') {
    handleAsk(req, res);
    return;
  }

  // Route: /api/feedback (RLHF Feedback Capture)
  if (req.method === 'POST' && pathname === '/api/feedback') {
    handleFeedback(req, res, feedbackCapture);
    return;
  }

  // Route: /api/tool-call/check (ThumbGate PreToolUse firewall)
  if (req.method === 'POST' && pathname === '/api/tool-call/check') {
    handleToolCallCheck(req, res);
    return;
  }

  // 404 fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
  });
}

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

  const proposedToolCall = detectProposedToolCall(question);
  const toolGate = evaluatePreToolUseGate(proposedToolCall);

  // Mock Scenario 1: Harmful Tool Call - Bypass Safety
  if (proposedToolCall?.toolName === 'override_interlock' && !toolGate.allowed) {
    status = 'blocked';
    toolCall = proposedToolCall;
    gates = [
      {
        gate: toolGate.gate,
        status: 'block',
        detail: toolGate.reason,
        toolName: toolCall.toolName,
        input: toolCall.input
      }
    ];
    answer = `[ThumbGate Firewall Blocked Action]\nTool: ${toolCall.toolName}\nReason: ${toolGate.reason}`;
    spans = [
      { name: 'detect_tool_call', runType: 'chain', ms: 4, status: 'ok' },
      { name: 'thumbgate_tool_firewall', runType: 'tool', ms: 12, status: 'error', error: `Blocked: ${toolGate.gate}` }
    ];
  }
  // Mock Scenario 2: Harmful Tool Call - Shutdown
  else if (proposedToolCall?.toolName === 'trigger_emergency_shutdown' && !toolGate.allowed) {
    status = 'blocked';
    toolCall = proposedToolCall;
    gates = [
      {
        gate: toolGate.gate,
        status: 'block',
        detail: toolGate.reason,
        toolName: toolCall.toolName,
        input: toolCall.input
      }
    ];
    answer = `[ThumbGate Firewall Blocked Action]\nTool: ${toolCall.toolName}\nReason: ${toolGate.reason}`;
    spans = [
      { name: 'detect_tool_call', runType: 'chain', ms: 4, status: 'ok' },
      { name: 'thumbgate_tool_firewall', runType: 'tool', ms: 11, status: 'error', error: `Blocked: ${toolGate.gate}` }
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
    answer: redactSecrets(redactPii(answer)),
    status,
    toolCall,
    gates,
    traceId: `mock-trace-${Date.now()}`,
    project: 'thumbgate-manufacturing-copilot',
    remote: false,
    spans,
    orchestration: {
      runtime: 'LangGraph',
      nodes: status === 'blocked'
        ? ['inspect_request', 'thumbgate_tool_firewall']
        : ['inspect_request', 'retrieve_manual_context', 'compose_langchain_prompt', 'generate_answer'],
      components: ['ChatPromptTemplate', 'ManufacturingRetriever']
    },
  };
}

const server = createServer();

server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Manufacturing copilot demo: http://localhost:${port}`);
});

module.exports = server;
module.exports.createServer = createServer;
module.exports.mockPipelineExecution = mockPipelineExecution;
module.exports.SCENARIOS = SCENARIOS;
