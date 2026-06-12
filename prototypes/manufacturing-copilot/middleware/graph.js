'use strict';

const { Trace } = require('./langsmith');
const llm = require('./llm');
const { queryVectorDB } = require('./vector-db');
const {
  sanitizeInput,
  scanForInjection,
  quarantineRetrievedContext,
  confidenceGate,
  unsafeOutputGate,
  safetyCitationGate,
} = require('./guardrails');
const { redactPii } = require('../../../scripts/pii-scanner');
const { redactSecrets } = require('../../../scripts/secret-redaction');

const SYSTEM_PROMPT = `You are a plant assistant for Acme Fabrication Plant 7 floor supervisors.
Answer operational questions accurately based on the provided reference documentation.
Keep your answer concise and reference the safety procedure code (like SP-xxx or MM-xxx) if available.`;

let langchainRuntimePromise;

function loadLangchainRuntime() {
  if (!langchainRuntimePromise) {
    langchainRuntimePromise = Promise.all([
      import('@langchain/langgraph'),
      import('@langchain/core/prompts'),
    ]).then(([langgraph, prompts]) => ({
      Annotation: langgraph.Annotation,
      END: langgraph.END,
      START: langgraph.START,
      StateGraph: langgraph.StateGraph,
      ChatPromptTemplate: prompts.ChatPromptTemplate,
    }));
  }
  return langchainRuntimePromise;
}

function createManufacturingRetriever({ vectorSearch = queryVectorDB } = {}) {
  return {
    lc_namespace: ['thumbgate', 'manufacturing-copilot', 'retriever'],
    async invoke(query, options = {}) {
      return vectorSearch(query, options.topK || 2);
    },
  };
}

function toLangChainMessages(promptValue) {
  return promptValue.toChatMessages().map((message) => ({
    role: message._getType() === 'human' ? 'user' : message._getType(),
    content: message.content,
  }));
}

function safetyResponseForBlockedTool(toolCall, gateResult) {
  return `[ThumbGate Firewall Blocked Action]\nTool: ${toolCall.toolName}\nReason: ${gateResult.reason}`;
}

function chatbotGuardrailBlock(gateResult) {
  return `[Chatbot Guardrail Blocked Response]\nGate: ${gateResult.gate}\nReason: ${gateResult.detail}`;
}

function classifyQuestionRoute(question) {
  return /\b(loto|lockout|tagout|safety|interlock|guard|shutdown|emergency|press|cnc|conveyor)\b/i.test(question)
    ? 'safety'
    : 'general';
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'to', 'what', 'with',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9-]+/g)
    ?.filter((token) => token.length > 2 && !STOPWORDS.has(token)) || [];
}

function planRetrieval(question, route) {
  const procedureCode = question.match(/\b(?:SP|MM|QC)-\d{3}\b/i)?.[0]?.toUpperCase() || null;
  const machine = /vm-22/i.test(question)
    ? 'CNC Mill VM-22'
    : /hp-400|hydraulic press|press/i.test(question)
    ? 'Hydraulic Press HP-400'
    : /c-3|conveyor/i.test(question)
    ? 'Conveyor Line C-3'
    : null;
  return {
    route,
    procedureCode,
    machine,
    topK: 2,
    candidateK: procedureCode ? 6 : 5,
    maxContextTokens: route === 'safety' ? 900 : 650,
    queryTerms: tokenize(question),
  };
}

function planMetadataFilters(retrievalPlan) {
  const sourcePreference = [];
  if (retrievalPlan.procedureCode?.startsWith('SP-') || retrievalPlan.route === 'safety') {
    sourcePreference.push('Safety Procedures Manual');
  }
  if (retrievalPlan.procedureCode?.startsWith('MM-') || retrievalPlan.machine) {
    sourcePreference.push('Maintenance Manual');
  }
  if (retrievalPlan.procedureCode?.startsWith('QC-')) {
    sourcePreference.push('Quality Control Standards');
  }
  return {
    sourcePreference: [...new Set(sourcePreference)],
    procedureCode: retrievalPlan.procedureCode,
    machine: retrievalPlan.machine,
  };
}

function localHybridRerank(question, chunks, metadataFilters = {}) {
  const queryTerms = new Set(tokenize(question));
  const procedureCode = metadataFilters.procedureCode;

  return chunks
    .map((chunk, index) => {
      const haystack = `${chunk.title || ''} ${chunk.text || ''}`.toLowerCase();
      const overlap = [...queryTerms].filter((term) => haystack.includes(term)).length;
      const codeBoost = procedureCode && haystack.toUpperCase().includes(procedureCode) ? 1.5 : 0;
      const sourceBoost = metadataFilters.sourcePreference?.includes(chunk.source) ? 0.35 : 0;
      const machineBoost = metadataFilters.machine && haystack.includes(metadataFilters.machine.toLowerCase()) ? 0.45 : 0;
      const vectorScore = Number(chunk.score || 0);
      return {
        ...chunk,
        rerank: {
          vectorScore,
          keywordOverlap: overlap,
          codeBoost,
          sourceBoost,
          machineBoost,
          finalScore: vectorScore + (overlap * 0.08) + codeBoost + sourceBoost + machineBoost,
        },
        originalRank: index + 1,
      };
    })
    .sort((a, b) => b.rerank.finalScore - a.rerank.finalScore);
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function packRetrievedContext(chunks, maxTokens) {
  const packed = [];
  let usedTokens = 0;
  for (const chunk of chunks) {
    const tokenEstimate = estimateTokens(`${chunk.title}\n${chunk.text}`);
    if (packed.length > 0 && usedTokens + tokenEstimate > maxTokens) continue;
    packed.push({ ...chunk, tokenEstimate });
    usedTokens += tokenEstimate;
  }
  return { chunks: packed, usedTokens, maxTokens };
}

function createManufacturingGraph({
  detectProposedToolCall,
  evaluatePreToolUseGate,
  vectorSearch = queryVectorDB,
  chat = llm.chat,
  trace,
} = {}) {
  if (!detectProposedToolCall || !evaluatePreToolUseGate) {
    throw new Error('detectProposedToolCall and evaluatePreToolUseGate are required');
  }

  return loadLangchainRuntime().then(({ Annotation, END, START, StateGraph, ChatPromptTemplate }) => {
    const GraphState = Annotation.Root({
      question: Annotation(),
      sanitizedQuestion: Annotation(),
      route: Annotation(),
      supervisor: Annotation(),
      machineState: Annotation(),
      proposedToolCall: Annotation(),
      toolGate: Annotation(),
      gates: Annotation(),
      retrievalPlan: Annotation(),
      metadataFilters: Annotation(),
      retrievedChunks: Annotation(),
      candidateChunks: Annotation(),
      tokenPack: Annotation(),
      messages: Annotation(),
      answer: Annotation(),
      status: Annotation(),
      graphNodes: Annotation(),
      langchainComponents: Annotation(),
    });

    const retriever = createManufacturingRetriever({ vectorSearch });
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      ['human', 'Context:\n{context}\n\nQuestion: {question}'],
    ]);

    const graph = new StateGraph(GraphState)
      .addNode('sanitize_input', async (state) => {
        const gateResult = await trace.span(
          'sanitize_input',
          'chain',
          { question: state.question },
          async () => sanitizeInput(state.question)
        );
        return {
          sanitizedQuestion: gateResult.sanitized,
          gates: gateResult.status === 'sanitized' ? [gateResult] : [],
          graphNodes: ['sanitize_input'],
        };
      })
      .addNode('scan_input_injection', async (state) => {
        const gateResult = await trace.span(
          'scan_input_injection',
          'chain',
          { question: state.sanitizedQuestion },
          async () => scanForInjection(state.sanitizedQuestion, 'input')
        );
        return {
          gates: gateResult.status === 'pass' ? state.gates : [...state.gates, gateResult],
          graphNodes: [...state.graphNodes, 'scan_input_injection'],
          ...(gateResult.status === 'block'
            ? {
                status: 'blocked',
                answer: chatbotGuardrailBlock(gateResult),
              }
            : {}),
        };
      })
      .addNode('inspect_request', async (state) => {
        const proposedToolCall = await trace.span(
          'inspect_request',
          'chain',
          { question: state.sanitizedQuestion },
          async () => detectProposedToolCall(state.sanitizedQuestion)
        );
        return {
          proposedToolCall,
          route: classifyQuestionRoute(state.sanitizedQuestion),
          supervisor: state.supervisor || { authenticated: false, role: 'operator' },
          machineState: state.machineState || { anomalyDetected: false, source: 'demo-default' },
          graphNodes: [...state.graphNodes, 'inspect_request'],
          langchainComponents: ['ChatPromptTemplate', 'ManufacturingRetriever'],
        };
      })
      .addNode('plan_retrieval', async (state) => {
        const retrievalPlan = await trace.span(
          'plan_retrieval',
          'chain',
          { question: state.sanitizedQuestion, route: state.route },
          async () => planRetrieval(state.sanitizedQuestion, state.route)
        );
        return {
          retrievalPlan,
          graphNodes: [...state.graphNodes, 'plan_retrieval'],
        };
      })
      .addNode('plan_metadata_filters', async (state) => {
        const metadataFilters = await trace.span(
          'plan_metadata_filters',
          'chain',
          { retrievalPlan: state.retrievalPlan },
          async () => planMetadataFilters(state.retrievalPlan)
        );
        return {
          metadataFilters,
          graphNodes: [...state.graphNodes, 'plan_metadata_filters'],
        };
      })
      .addNode('thumbgate_tool_firewall', async (state) => {
        const toolGate = await trace.span(
          'thumbgate_tool_firewall',
          'tool',
          { proposedToolCall: state.proposedToolCall },
          async () => evaluatePreToolUseGate(state.proposedToolCall)
        );
        const gateReport = {
          gate: toolGate.gate || 'tool_safety',
          status: toolGate.allowed ? 'pass' : 'block',
          detail: toolGate.allowed ? 'Tool call allowed' : toolGate.reason,
          toolName: state.proposedToolCall.toolName,
          input: state.proposedToolCall.input,
        };
        return {
          toolGate,
          gates: [...state.gates, gateReport],
          graphNodes: [...state.graphNodes, 'thumbgate_tool_firewall'],
          ...(toolGate.allowed
            ? {}
            : {
                status: 'blocked',
                answer: safetyResponseForBlockedTool(state.proposedToolCall, toolGate),
              }),
        };
      })
      .addNode('retrieve_manual_context', async (state) => {
        const candidateChunks = await trace.span(
          'retrieve_manual_context',
          'retriever',
          { query: state.sanitizedQuestion, retrievalPlan: state.retrievalPlan, metadataFilters: state.metadataFilters },
          async () => retriever.invoke(state.sanitizedQuestion, { topK: state.retrievalPlan.candidateK, metadataFilters: state.metadataFilters })
        );
        return {
          candidateChunks,
          graphNodes: [...state.graphNodes, 'retrieve_manual_context'],
        };
      })
      .addNode('fusion_rerank', async (state) => {
        const retrievedChunks = await trace.span(
          'fusion_rerank',
          'chain',
          {
            candidateCount: state.candidateChunks.length,
            metadataFilters: state.metadataFilters,
          },
          async () => localHybridRerank(state.sanitizedQuestion, state.candidateChunks, state.metadataFilters)
            .slice(0, state.retrievalPlan.topK)
        );
        return {
          retrievedChunks,
          graphNodes: [...state.graphNodes, 'fusion_rerank'],
        };
      })
      .addNode('pack_context_tokens', async (state) => {
        const tokenPack = await trace.span(
          'pack_context_tokens',
          'chain',
          {
            chunkCount: state.retrievedChunks.length,
            maxContextTokens: state.retrievalPlan.maxContextTokens,
          },
          async () => packRetrievedContext(state.retrievedChunks, state.retrievalPlan.maxContextTokens)
        );
        return {
          tokenPack,
          retrievedChunks: tokenPack.chunks,
          graphNodes: [...state.graphNodes, 'pack_context_tokens'],
        };
      })
      .addNode('quarantine_retrieved_context', async (state) => {
        const gateResult = await trace.span(
          'quarantine_retrieved_context',
          'chain',
          { chunkCount: state.retrievedChunks.length },
          async () => quarantineRetrievedContext(state.retrievedChunks)
        );
        return {
          retrievedChunks: gateResult.cleanChunks,
          gates: [...state.gates, {
            gate: gateResult.gate,
            status: gateResult.status === 'warning' ? 'warning' : 'pass',
            detail: gateResult.detail
          }],
          graphNodes: [...state.graphNodes, 'quarantine_retrieved_context'],
        };
      })
      .addNode('check_retrieval_confidence', async (state) => {
        const gateResult = await trace.span(
          'check_retrieval_confidence',
          'chain',
          { chunkCount: state.retrievedChunks.length },
          async () => confidenceGate(state.retrievedChunks)
        );
        return {
          gates: [...state.gates, gateResult],
          graphNodes: [...state.graphNodes, 'check_retrieval_confidence'],
          ...(gateResult.status === 'block'
            ? {
                status: 'blocked',
                answer: chatbotGuardrailBlock(gateResult),
              }
            : {}),
        };
      })
      .addNode('compose_langchain_prompt', async (state) => {
        const context = state.retrievedChunks.length
          ? state.retrievedChunks.map((chunk) => `${chunk.title}\n${chunk.text}`).join('\n\n---\n\n')
          : 'No matching manual procedures found.';
        const promptValue = await trace.span(
          'compose_langchain_prompt',
          'prompt',
          { question: state.question, chunkCount: state.retrievedChunks.length },
          async () => prompt.invoke({ context, question: state.sanitizedQuestion })
        );
        return {
          messages: toLangChainMessages(promptValue),
          graphNodes: [...state.graphNodes, 'compose_langchain_prompt'],
        };
      })
      .addNode('generate_answer', async (state) => {
        // Offline extractive fallback: when no LLM provider is configured and
        // no test double was injected, quote the top retrieved procedure
        // verbatim so the REAL graph (guardrails, LanceDB, tracing) still runs
        // end-to-end with zero credentials — no mock data path.
        const offline = chat === llm.chat && llm.activeProvider() === 'none';
        const modelResponse = await trace.span(
          'generate_answer',
          'llm',
          { messages: state.messages, mode: offline ? 'extractive-offline' : 'llm' },
          async () => {
            if (offline) {
              const top = state.retrievedChunks[0];
              return top
                ? `Per ${top.title}:\n\n${top.text}`
                : 'No matching manual procedures found. Escalate to your supervisor.';
            }
            return chat(state.messages, { temperature: 0 });
          }
        );
        const answer = redactSecrets(redactPii(modelResponse));
        return {
          answer,
          status: 'pass',
          gates: [
            ...state.gates,
            {
              gate: 'rlhf_feedback_layer',
              status: 'pass',
              detail: 'Answer generated. Operator feedback thumbs-up/down requested.',
            },
          ],
          graphNodes: [...state.graphNodes, 'generate_answer'],
        };
      })
      .addNode('check_output_safety', async (state) => {
        const gateResult = await trace.span(
          'check_output_safety',
          'chain',
          { status: state.status },
          async () => unsafeOutputGate(state.answer)
        );
        return {
          gates: gateResult.status === 'pass' ? state.gates : [...state.gates, gateResult],
          graphNodes: [...state.graphNodes, 'check_output_safety'],
          ...(gateResult.status === 'block'
            ? {
                status: 'blocked',
                answer: chatbotGuardrailBlock(gateResult),
              }
            : {}),
        };
      })
      .addNode('check_safety_citation', async (state) => {
        const gateResult = await trace.span(
          'check_safety_citation',
          'chain',
          { route: state.route },
          async () => safetyCitationGate(state.answer, state.route)
        );
        return {
          gates: gateResult.status === 'pass' ? state.gates : [...state.gates, gateResult],
          graphNodes: [...state.graphNodes, 'check_safety_citation'],
          ...(gateResult.status === 'block'
            ? {
                status: 'blocked',
                answer: chatbotGuardrailBlock(gateResult),
              }
            : {}),
        };
      })
      .addConditionalEdges('scan_input_injection', (state) => (
        state.status === 'blocked' ? END : 'inspect_request'
      ))
      .addConditionalEdges('inspect_request', (state) => (
        state.proposedToolCall ? 'thumbgate_tool_firewall' : 'plan_retrieval'
      ))
      .addConditionalEdges('thumbgate_tool_firewall', (state) => (
        state.toolGate?.allowed ? 'plan_retrieval' : END
      ))
      .addConditionalEdges('check_retrieval_confidence', (state) => (
        state.status === 'blocked' ? END : 'compose_langchain_prompt'
      ))
      .addConditionalEdges('check_output_safety', (state) => (
        state.status === 'blocked' ? END : 'check_safety_citation'
      ))
      .addEdge(START, 'sanitize_input')
      .addEdge('sanitize_input', 'scan_input_injection')
      .addEdge('plan_retrieval', 'plan_metadata_filters')
      .addEdge('plan_metadata_filters', 'retrieve_manual_context')
      .addEdge('retrieve_manual_context', 'fusion_rerank')
      .addEdge('fusion_rerank', 'pack_context_tokens')
      .addEdge('pack_context_tokens', 'quarantine_retrieved_context')
      .addEdge('quarantine_retrieved_context', 'check_retrieval_confidence')
      .addEdge('compose_langchain_prompt', 'generate_answer')
      .addEdge('generate_answer', 'check_output_safety')
      .addEdge('check_safety_citation', END)
      .compile();

    return graph;
  });
}

async function executeManufacturingGraph(question, deps = {}) {
  const trace = deps.trace || new Trace('manufacturing_copilot_ask', { question });

  try {
    const graph = await createManufacturingGraph({ ...deps, trace });
    const state = await graph.invoke({
      question,
      gates: [],
      retrievedChunks: [],
      candidateChunks: [],
      graphNodes: [],
      langchainComponents: [],
    });

    return trace.end({
      answer: state.answer,
      status: state.status,
      toolCall: state.proposedToolCall || null,
      gates: state.gates || [],
      retrievedChunks: (state.retrievedChunks || []).map((chunk) => ({
        title: chunk.title,
        source: chunk.source,
        score: chunk.score,
        fileName: chunk.fileName,
      })),
      orchestration: {
        runtime: 'LangGraph',
        nodes: state.graphNodes || [],
        components: state.langchainComponents || [],
        retrievalPlan: state.retrievalPlan,
        metadataFilters: state.metadataFilters,
        tokenPack: state.tokenPack,
      },
    });
  } catch (error) {
    console.error('[manufacturing-graph] Failure:', error);
    return trace.end({
      answer: `Internal Error: ${error.message}`,
      status: 'error',
      gates: [],
      orchestration: {
        runtime: 'LangGraph',
        nodes: [],
        components: [],
      },
    });
  }
}

module.exports = {
  SYSTEM_PROMPT,
  createManufacturingGraph,
  createManufacturingRetriever,
  executeManufacturingGraph,
  localHybridRerank,
  packRetrievedContext,
  planMetadataFilters,
  planRetrieval,
};
