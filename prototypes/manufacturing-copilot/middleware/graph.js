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
      retrievedChunks: Annotation(),
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
        const retrievedChunks = await trace.span(
          'retrieve_manual_context',
          'retriever',
          { query: state.sanitizedQuestion },
          async () => retriever.invoke(state.sanitizedQuestion, { topK: 2 })
        );
        return {
          retrievedChunks,
          graphNodes: [...state.graphNodes, 'retrieve_manual_context'],
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
        state.proposedToolCall ? 'thumbgate_tool_firewall' : 'retrieve_manual_context'
      ))
      .addConditionalEdges('thumbgate_tool_firewall', (state) => (
        state.toolGate?.allowed ? 'retrieve_manual_context' : END
      ))
      .addConditionalEdges('check_retrieval_confidence', (state) => (
        state.status === 'blocked' ? END : 'compose_langchain_prompt'
      ))
      .addConditionalEdges('check_output_safety', (state) => (
        state.status === 'blocked' ? END : 'check_safety_citation'
      ))
      .addEdge(START, 'sanitize_input')
      .addEdge('sanitize_input', 'scan_input_injection')
      .addEdge('retrieve_manual_context', 'check_retrieval_confidence')
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
};
