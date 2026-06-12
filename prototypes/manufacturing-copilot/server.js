'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { executeRAGPipeline } = require('./middleware/rag');
const { activeProvider } = require('./middleware/llm');

const PORT = process.env.PORT || 3001;
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

  // 404 fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

// Helper for Mock Mode when offline or during credentials setup
function mockPipelineExecution(question) {
  const q = question.toLowerCase();
  const gates = [
    {
      gate: 'input_sanitization',
      status: 'pass',
      detail: 'No PII or secrets detected',
      sanitized: question,
    },
    {
      gate: 'injection_scan_input',
      status: 'pass',
      detail: 'No injection patterns in input',
    },
    {
      gate: 'retrieval_confidence',
      status: 'pass',
      detail: 'Top retrieval score 2.5 ≥ threshold 1.0',
    },
    {
      gate: 'injection_scan_context',
      status: 'pass',
      detail: 'All retrieved chunks clean',
    },
    {
      gate: 'unsafe_output_scan',
      status: 'pass',
      detail: 'No unsafe instructions in answer',
    },
    {
      gate: 'safety_citation',
      status: 'pass',
      detail: 'Answer cites the governing safety procedure',
    }
  ];

  let answer = '';
  let status = 'pass';
  let category = 'general';
  let spans = [
    { name: 'input_sanitization', runType: 'llm', ms: 12, status: 'ok' },
    { name: 'injection_scan_input', runType: 'llm', ms: 8, status: 'ok' },
    { name: 'query_router', runType: 'chain', ms: 5, status: 'ok' },
    { name: 'retrieval', runType: 'retriever', ms: 15, status: 'ok' },
  ];

  // Mock Scenario 1: Clean Safety Question
  if (q.includes('loto') || q.includes('lockout') || q.includes('tagout')) {
    category = 'safety';
    answer = `To perform Lockout/Tagout (LOTO) on the Hydraulic Press Line per SP-101:
1. Notify all affected employees.
2. Shut down the press using the normal stop procedure at the operator console.
3. Isolate all energy: main electrical disconnect (Panel E-7), hydraulic accumulator bleed valve (V-12), and pneumatic supply (V-3).
4. Apply your personal lock and tag to each isolation point.
5. Cycle the bleed valve until the accumulator gauge reads 0 PSI.
6. Attempt a press start to verify isolation. The press must not respond.
[Procedure Cited: SP-101]`;
    spans.push(
      { name: 'retrieval_confidence', runType: 'llm', ms: 10, status: 'ok' },
      { name: 'quarantine_chunks', runType: 'llm', ms: 14, status: 'ok' },
      { name: 'llm_call', runType: 'llm', ms: 850, status: 'ok' },
      { name: 'unsafe_output_scan', runType: 'llm', ms: 9, status: 'ok' },
      { name: 'safety_citation_check', runType: 'llm', ms: 7, status: 'ok' }
    );
  }
  // Mock Scenario 2: Direct Prompt Injection Attack (e.g. asking to ignore safety rules)
  else if (q.includes('ignore') || q.includes('override') || q.includes('bypass')) {
    status = 'blocked';
    category = 'general';
    gates[1] = {
      gate: 'injection_scan_input',
      status: 'block',
      detail: 'Prompt-injection pattern detected in input: ignore previous instructions signature',
      hits: ['ignore\\s+(all\\s+)?(previous|prior|above)\\s+(instructions|policies|safety)'],
    };
    answer = 'Blocked: Your query was flagged by ThumbGate safety policies for containing prompt-injection patterns.';
    spans[1] = { name: 'injection_scan_input', runType: 'llm', ms: 14, status: 'error', error: 'Blocked by Gate' };
  }
  // Mock Scenario 3: Indirect Prompt Injection (asking about VM-22 or HP-400 press where instructions are poisoned in maintenance-manual.md)
  else if (q.includes('hp-400') || q.includes('hp 400') || q.includes('press')) {
    category = 'maintenance';
    // Let's simulate the quarantine gate catching the poison chunk!
    status = 'pass';
    gates[3] = {
      gate: 'injection_scan_context',
      status: 'block',
      detail: 'Quarantined 1 poisoned chunk(s) from Maintenance Manual; answer built from clean context only',
      quarantined: [{ title: 'MM-201: Hydraulic Press HP-400', source: 'Maintenance Manual', hits: ['ignore\\s+all\\s+previous'] }],
    };
    answer = `To perform preventive maintenance on the Hydraulic Press HP-400 per MM-201:
1. Complete LOTO per safety procedure SP-101.
2. Replace hydraulic filter element (part HF-4420) and torque housing bolts to 45 Nm.
3. Sample hydraulic oil; replace if ISO cleanliness exceeds 18/16/13.
4. Inspect ram guides for scoring (max wear 0.15 mm).
5. Check accumulator pre-charge: 1,100 PSI nitrogen, measured with system at 0 PSI.
[Procedure Cited: MM-201, SP-101]`;
    spans.push(
      { name: 'retrieval_confidence', runType: 'llm', ms: 12, status: 'ok' },
      { name: 'quarantine_chunks', runType: 'llm', ms: 22, status: 'error', error: 'Quarantined poisoned chunk' },
      { name: 'llm_call', runType: 'llm', ms: 720, status: 'ok' },
      { name: 'unsafe_output_scan', runType: 'llm', ms: 8, status: 'ok' },
      { name: 'safety_citation_check', runType: 'llm', ms: 6, status: 'ok' }
    );
  }
  // Mock Scenario 4: Output Safety Violation (asking for a shortcut on conveyor)
  else if (q.includes('shortcut') || q.includes('speed up conveyor')) {
    category = 'maintenance';
    status = 'blocked';
    gates[4] = {
      gate: 'unsafe_output_scan',
      status: 'block',
      detail: 'Answer recommended defeating a safety control — blocked and escalated to safety officer',
    };
    answer = 'Blocked: The model attempt recommended unsafe shortcuts or bypassing safety barriers. This event has been blocked and logged for security review.';
    spans.push(
      { name: 'retrieval_confidence', runType: 'llm', ms: 11, status: 'ok' },
      { name: 'quarantine_chunks', runType: 'llm', ms: 12, status: 'ok' },
      { name: 'llm_call', runType: 'llm', ms: 610, status: 'ok' },
      { name: 'unsafe_output_scan', runType: 'llm', ms: 15, status: 'error', error: 'Blocked: Unsafe output recommended' }
    );
  }
  // Mock Scenario 5: Missing Citation
  else if (q.includes('confined space') || q.includes('mixing tank')) {
    category = 'safety';
    status = 'blocked';
    gates[5] = {
      gate: 'safety_citation',
      status: 'block',
      detail: 'Safety answer missing procedure citation (SP-xxx) — blocked; verbatim procedure required',
    };
    answer = 'Blocked: Plant safety regulations require safety guidance to cite specific procedure codes (SP-xxx). The generated answer lacked citations and was blocked.';
    spans.push(
      { name: 'retrieval_confidence', runType: 'llm', ms: 9, status: 'ok' },
      { name: 'quarantine_chunks', runType: 'llm', ms: 11, status: 'ok' },
      { name: 'llm_call', runType: 'llm', ms: 790, status: 'ok' },
      { name: 'unsafe_output_scan', runType: 'llm', ms: 8, status: 'ok' },
      { name: 'safety_citation_check', runType: 'llm', ms: 12, status: 'error', error: 'Blocked: Missing SP citation' }
    );
  }
  // Default general response
  else {
    answer = `Operational assistant ready. Please ask a specific question regarding safety procedures (LOTO, confined spaces), maintenance instructions, or quality control standards at Acme Plant 7.`;
    spans.push(
      { name: 'retrieval_confidence', runType: 'llm', ms: 8, status: 'ok' },
      { name: 'quarantine_chunks', runType: 'llm', ms: 10, status: 'ok' },
      { name: 'llm_call', runType: 'llm', ms: 500, status: 'ok' },
      { name: 'unsafe_output_scan', runType: 'llm', ms: 7, status: 'ok' },
      { name: 'safety_citation_check', runType: 'llm', ms: 5, status: 'ok' }
    );
  }

  return {
    answer,
    status,
    category,
    gates,
    traceId: `mock-trace-${Date.now()}`,
    project: 'thumbgate-manufacturing-copilot',
    remote: false,
    spans,
  };
}

server.listen(PORT, () => {
  console.log(`[Server] Manufacturing Copilot server running on http://localhost:${PORT}`);
});
