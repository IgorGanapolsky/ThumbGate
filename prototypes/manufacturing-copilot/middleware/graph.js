'use strict';

const { Trace } = require('./langsmith');
const llm = require('./llm');
const { queryVectorDB } = require('./vector-db');
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
      .addNode('inspect_request', async (state) => {
        const proposedToolCall = await trace.span(
          'inspect_request',
          'chain',
          { question: state.question },
          async () => detectProposedToolCall(state.question)
        );
        return {
          proposedToolCall,
          supervisor: state.supervisor || { authenticated: false, role: 'operator' },
          machineState: state.machineState || { anomalyDetected: false, source: 'demo-default' },
          gates: [],
          graphNodes: ['inspect_request'],
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
          { query: state.question },
          async () => retriever.invoke(state.question, { topK: 2 })
        );
        return {
          retrievedChunks,
          graphNodes: [...state.graphNodes, 'retrieve_manual_context'],
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
          async () => prompt.invoke({ context, question: state.question })
        );
        return {
          messages: toLangChainMessages(promptValue),
          graphNodes: [...state.graphNodes, 'compose_langchain_prompt'],
        };
      })
      .addNode('generate_answer', async (state) => {
        const modelResponse = await trace.span(
          'generate_answer',
          'llm',
          { messages: state.messages },
          async () => chat(state.messages, { temperature: 0 })
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
      .addConditionalEdges('inspect_request', (state) => (
        state.proposedToolCall ? 'thumbgate_tool_firewall' : 'retrieve_manual_context'
      ))
      .addConditionalEdges('thumbgate_tool_firewall', (state) => (
        state.toolGate?.allowed ? 'retrieve_manual_context' : END
      ))
      .addEdge(START, 'inspect_request')
      .addEdge('retrieve_manual_context', 'compose_langchain_prompt')
      .addEdge('compose_langchain_prompt', 'generate_answer')
      .addEdge('generate_answer', END)
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
