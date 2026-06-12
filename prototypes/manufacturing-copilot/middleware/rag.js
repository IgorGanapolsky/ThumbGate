'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Trace } = require('./langsmith');
const { chat } = require('./llm');
const {
  sanitizeInput,
  scanForInjection,
  quarantineChunks,
  confidenceGate,
  unsafeOutputGate,
  safetyCitationGate,
} = require('./gates');
const { queryVectorDB } = require('./vector-db');

const DATA_DIR = path.join(__dirname, '../data');

// Load manuals into memory
const MANUALS = {
  safety: {
    path: path.join(DATA_DIR, 'safety-procedures.md'),
    title: 'Safety Procedures Manual',
  },
  maintenance: {
    path: path.join(DATA_DIR, 'maintenance-manual.md'),
    title: 'Maintenance Manual',
  },
  quality: {
    path: path.join(DATA_DIR, 'quality-standards.md'),
    title: 'Quality Control Standards',
  },
};

/**
 * Route user query to the appropriate manual category based on keyword heuristic.
 */
function routeQuery(query) {
  const q = query.toLowerCase();
  
  // Safety keywords
  if (
    q.includes('loto') ||
    q.includes('lockout') ||
    q.includes('tagout') ||
    q.includes('confined') ||
    q.includes('spill') ||
    q.includes('safety') ||
    q.includes('permit') ||
    q.includes('hazard') ||
    q.includes('sp-101') ||
    q.includes('sp-102') ||
    q.includes('sp-103') ||
    q.includes('sp-110')
  ) {
    return 'safety';
  }

  // Maintenance keywords
  if (
    q.includes('belt') ||
    q.includes('adjust') ||
    q.includes('filter') ||
    q.includes('accumulator') ||
    q.includes('spindle') ||
    q.includes('bearing') ||
    q.includes('compressor') ||
    q.includes('maintenance') ||
    q.includes('manual') ||
    q.includes('hp-400') ||
    q.includes('vm-22') ||
    q.includes('c-3') ||
    q.includes('ac-1') ||
    q.includes('mm-201') ||
    q.includes('mm-205') ||
    q.includes('mm-210') ||
    q.includes('mm-215')
  ) {
    return 'maintenance';
  }

  // Quality keywords
  if (
    q.includes('weld') ||
    q.includes('bracket') ||
    q.includes('paint') ||
    q.includes('thickness') ||
    q.includes('ncr') ||
    q.includes('defect') ||
    q.includes('quality') ||
    q.includes('inspection') ||
    q.includes('standards') ||
    q.includes('qc-301') ||
    q.includes('qc-305') ||
    q.includes('qc-310') ||
    q.includes('qc-320')
  ) {
    return 'quality';
  }

  return 'general';
}

/**
 * Retrieve sections from the manuals that match the query keywords.
 */
function retrieveChunks(query, category) {
  if (category === 'general' || !MANUALS[category]) {
    return [];
  }

  const manual = MANUALS[category];
  if (!fs.existsSync(manual.path)) {
    return [];
  }

  const text = fs.readFileSync(manual.path, 'utf-8');
  
  // Split by ## headers to create sections/chunks
  const sections = text.split(/(?=##\s+)/);
  const chunks = [];

  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  for (const sec of sections) {
    if (!sec.trim()) continue;
    
    // Parse title
    const headerMatch = sec.match(/^##\s+([^\n]+)/);
    const title = headerMatch ? headerMatch[1].trim() : 'Unknown Section';
    
    // Calculate simple scoring
    let score = 0;
    const secLower = sec.toLowerCase();
    for (const term of queryTerms) {
      if (secLower.includes(term)) {
        score += 1;
        // Exact title match bonus
        if (title.toLowerCase().includes(term)) {
          score += 1.5;
        }
      }
    }

    chunks.push({
      title,
      text: sec.trim(),
      score,
      source: manual.title,
    });
  }

  // Sort descending by score
  return chunks.sort((a, b) => b.score - a.score);
}

/**
 * Main RAG execution pipeline wrapped with LangSmith tracing and ThumbGate enforcement.
 */
async function executeRAGPipeline(question) {
  const trace = new Trace('manufacturing_copilot_ask', { question });
  const gatesReport = [];

  try {
    // --- GATE 1: Input Sanitization (Secrets + PII) ---
    const sanitizeResult = await trace.span('input_sanitization', 'llm', { input: question }, async () => {
      const res = sanitizeInput(question);
      gatesReport.push(res);
      return res;
    });

    const sanitizedQuestion = sanitizeResult.sanitized;

    // --- GATE 2: Input Prompt-Injection Scan ---
    const inputInjectionResult = await trace.span('injection_scan_input', 'llm', { input: sanitizedQuestion }, async () => {
      const res = scanForInjection(sanitizedQuestion, 'input');
      gatesReport.push(res);
      return res;
    });

    if (inputInjectionResult.status === 'block') {
      const output = {
        answer: 'Blocked: Your query was flagged by ThumbGate safety policies for containing prompt-injection patterns.',
        status: 'blocked',
        category: 'general',
        gates: gatesReport,
      };
      return trace.end(output);
    }

    // --- RAG ROUTING ---
    const route = await trace.span('query_router', 'chain', { question: sanitizedQuestion }, async () => {
      return routeQuery(sanitizedQuestion);
    });

    // --- CHUNK RETRIEVAL (HNSW Vector Search) ---
    const retrievedChunks = await trace.span('retrieval', 'retriever', { query: sanitizedQuestion, route }, async () => {
      return await queryVectorDB(sanitizedQuestion, 2);
    });

    // --- GATE 4: Retrieval Confidence Gate ---
    const confidenceResult = await trace.span('retrieval_confidence', 'llm', { chunks: retrievedChunks }, async () => {
      const res = confidenceGate(retrievedChunks, 1.0); // 1.0 threshold
      gatesReport.push(res);
      return res;
    });

    if (confidenceResult.status === 'block') {
      const output = {
        answer: 'Unsure: I could not retrieve sufficient confidence documentation to answer your question safely. Please escalate this request to a shift supervisor.',
        status: 'blocked',
        category: route,
        gates: gatesReport,
      };
      return trace.end(output);
    }

    // --- GATE 3: Context Quarantine Gate (Indirect Prompt Injection) ---
    const quarantineResult = await trace.span('quarantine_chunks', 'llm', { chunks: retrievedChunks }, async () => {
      const res = quarantineChunks(retrievedChunks);
      gatesReport.push(res);
      return res;
    });

    const cleanChunks = quarantineResult.clean;
    if (cleanChunks.length === 0) {
      const output = {
        answer: 'Blocked: Retrieved reference documentation was quarantined by ThumbGate due to embedded instruction injection payloads.',
        status: 'blocked',
        category: route,
        gates: gatesReport,
      };
      return trace.end(output);
    }

    // --- LLM GENERATION ---
    const promptContext = cleanChunks.map((c) => `Source [${c.source} - ${c.title}]:\n${c.text}`).join('\n\n');
    const systemPrompt = `You are a plant assistant for Acme Fabrication Plant 7 floor supervisors.
Your goal is to answer operational questions accurately based ONLY on the provided reference documentation.
CRITICAL SAFETY CONSTRAINTS:
1. NEVER recommend bypassing any machine interlocks, disabling light curtains, or muting safety devices under any circumstances.
2. ALWAYS require performing lockout/tagout (LOTO) per SP-101 before any servicing or maintenance work begins.
3. If answering a safety-related question, you MUST cite the specific safety procedure document code (e.g. SP-xxx) in your response.
4. If the documentation does not contain enough info, state that you do not know. Do not make up shortcuts.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Context:\n${promptContext}\n\nQuestion: ${sanitizedQuestion}` },
    ];

    const modelResponse = await trace.span('llm_call', 'llm', { model: 'claude-sonnet-4-5', messages }, async () => {
      return await chat(messages, { temperature: 0 });
    });

    // --- GATE 5: Unsafe Output Scan ---
    const unsafeOutputResult = await trace.span('unsafe_output_scan', 'llm', { answer: modelResponse }, async () => {
      const res = unsafeOutputGate(modelResponse);
      gatesReport.push(res);
      return res;
    });

    if (unsafeOutputResult.status === 'block') {
      const output = {
        answer: 'Blocked: The model attempt recommended unsafe shortcuts or bypassing safety barriers. This event has been blocked and logged for security review.',
        status: 'blocked',
        category: route,
        gates: gatesReport,
      };
      return trace.end(output);
    }

    // --- GATE 6: Safety Citation Gate ---
    const citationResult = await trace.span('safety_citation_check', 'llm', { answer: modelResponse, route }, async () => {
      const res = safetyCitationGate(modelResponse, route);
      gatesReport.push(res);
      return res;
    });

    if (citationResult.status === 'block') {
      const output = {
        answer: 'Blocked: Plant safety regulations require safety guidance to cite specific procedure codes (SP-xxx). The generated answer lacked citations and was blocked.',
        status: 'blocked',
        category: route,
        gates: gatesReport,
      };
      return trace.end(output);
    }

    // --- PIPELINE SUCCESS ---
    const successOutput = {
      answer: modelResponse,
      status: 'pass',
      category: route,
      gates: gatesReport,
      retrievedCount: retrievedChunks.length,
      quarantinedCount: quarantineResult.quarantined.length,
    };
    return trace.end(successOutput);

  } catch (error) {
    console.error('[rag-pipeline] Failure:', error);
    const failOutput = {
      answer: `Internal Error: ${error.message}`,
      status: 'error',
      category: 'general',
      gates: gatesReport,
    };
    return trace.end(failOutput);
  }
}

module.exports = { executeRAGPipeline, routeQuery, retrieveChunks };
