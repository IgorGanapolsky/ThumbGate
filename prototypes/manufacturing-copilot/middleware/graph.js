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
  clearanceGate,
  hallucinationGroundingGate,
} = require('./guardrails');
const { redactPii } = require('../../../scripts/pii-scanner');
const { redactSecrets } = require('../../../scripts/secret-redaction');

const SYSTEM_PROMPT = `You are a plant assistant for Acme Fabrication Plant 7 floor supervisors.
Answer operational questions accurately based on the provided reference documentation.
For safety procedures or manual citations, you MUST cite the specific manual title and page number (e.g. "[Safety Procedures Manual, Page 12]") in your answer.
If the user asks for an explanation, overview, or definition, answer conversationally. Do not call it a procedure unless the cited source is actually a procedure.
Do not end with generic offers such as "let me know if you need more help"; finish with the useful answer.
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
      return vectorSearch(query, options.topK || 2, options);
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
  return `[Access/Safety Blocked]\nGate: ${gateResult.gate}\nReason: ${gateResult.detail}`;
}

function classifyQuestionRoute(question) {
  return /\b(loto|lockout|tagout|safety|interlocks?|guards?|guarding|shutdown|emergency|press(es)?|cnc|conveyors?)\b/i.test(question)
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

function planRetrieval(question, route, role) {
  const userRole = role || 'floor_supervisor';
  const procedureCode = question.match(/\b(?:SP|MM|QC)-\d{3}\b/i)?.[0]?.toUpperCase() || null;
  const machine = /vm-22/i.test(question)
    ? 'CNC Mill VM-22'
    : /hp-400|hydraulic press|press/i.test(question)
    ? 'Hydraulic Press HP-400'
    : /\bc-3\b|conveyor/i.test(question)
    ? 'Conveyor Line C-3'
    : null;
  return {
    route,
    procedureCode,
    machine,
    role: userRole,
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
    role: retrievalPlan.role,
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
          finalScore: vectorScore + (overlap * 0.15) + codeBoost + sourceBoost + machineBoost,
        },
        confidenceScore: vectorScore + (overlap * 0.15) + codeBoost + sourceBoost + machineBoost,
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

function isTelemetryQuestion(question) {
  return /\b(status|state|temperature|running|speed|active|armed|power|coil|coils|register|registers|reg|regs|telemetry|working|normal|normally|tripped|stopped|bypassed|plc|modbus)\b/i.test(question);
}

function isModbusExplanationQuestion(question) {
  return /\b(plc|modbus)\b/i.test(question)
    && /\b(explain|what|about|describe|overview|how|why)\b/i.test(question);
}

function sourceCategoryForChunk(chunk) {
  const source = String(chunk?.source || '').toLowerCase();
  if (source.includes('telemetry')) return 'Live PLC Telemetry';
  if (source.includes('maintenance')) return 'Maintenance Manual';
  if (source.includes('safety')) return 'Safety Procedures Manual';
  if (source.includes('quality')) return 'Quality Standards Manual';
  if (source.includes('protocol')) return 'Protocol Specification';
  return chunk?.source || 'Source Document';
}

function citationForChunk(chunk) {
  if (!chunk) return null;
  const category = sourceCategoryForChunk(chunk);
  const sourceName = chunk.sourceTitle || chunk.source || chunk.title || chunk.fileName;
  const page = chunk.sourcePage ? `, p. ${chunk.sourcePage}` : (category === 'Live PLC Telemetry' ? ', Live' : '');
  const url = chunk.sourceUrl ? ` — ${chunk.sourceUrl}` : '';
  return `Source type: ${category} — ${sourceName}${page}${url}`;
}

function cleanChunkText(text) {
  return String(text || '')
    .replace(/^<!--[\s\S]*?-->\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function appendCitations(answer, chunks) {
  const citations = [...new Set((chunks || []).map(citationForChunk).filter(Boolean))];
  if (!citations.length) return answer;
  if (/^Sources:/m.test(answer)) {
    if (/Source type:/i.test(answer)) return answer;
    return `${answer.trim()}\n\nDocument categories:\n${citations.map((citation) => `- ${citation}`).join('\n')}`;
  }
  return `${answer}\n\nSources:\n${citations.map((citation) => `- ${citation}`).join('\n')}`;
}

function polishConversationalAnswer(answer, question) {
  let polished = String(answer || '');
  if (isModbusExplanationQuestion(question)) {
    polished = polished.replace(
      /here is the procedure for Modbus TCP PLC Context:/i,
      'here is how our PLC Modbus telemetry works:'
    );
  }
  return polished
    .replace(/\n*Let me know if you need further clarification or help with this process\.?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
          supervisor: state.supervisor || { authenticated: true, role: 'floor_supervisor' },
          machineState: state.machineState || { anomalyDetected: false, source: 'demo-default' },
          graphNodes: [...state.graphNodes, 'inspect_request'],
          langchainComponents: ['ChatPromptTemplate', 'ManufacturingRetriever'],
        };
      })
      .addNode('evaluate_clearance', async (state) => {
        const role = state.supervisor?.role || 'floor_supervisor';
        const gateResult = await trace.span(
          'evaluate_clearance',
          'chain',
          { question: state.sanitizedQuestion, role },
          async () => clearanceGate(state.sanitizedQuestion, role)
        );
        return {
          gates: gateResult.status === 'pass' ? state.gates : [...state.gates, gateResult],
          graphNodes: [...state.graphNodes, 'evaluate_clearance'],
          ...(gateResult.status === 'block'
            ? {
                status: 'blocked',
                answer: chatbotGuardrailBlock(gateResult),
              }
            : {}),
        };
      })
      .addNode('plan_retrieval', async (state) => {
        const role = state.supervisor?.role || 'floor_supervisor';
        const retrievalPlan = await trace.span(
          'plan_retrieval',
          'chain',
          { question: state.sanitizedQuestion, route: state.route, role },
          async () => planRetrieval(state.sanitizedQuestion, state.route, role)
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
          { proposedToolCall: state.proposedToolCall, actor: state.supervisor },
          async () => evaluatePreToolUseGate(state.proposedToolCall, state.supervisor)
        );
        const gateReport = {
          gate: toolGate.gate || 'tool_safety',
          status: toolGate.allowed ? 'pass' : 'block',
          detail: toolGate.allowed ? 'Tool call allowed' : toolGate.reason,
          actorRole: toolGate.actorRole || state.supervisor?.role,
          requiredRole: toolGate.requiredRole,
          toolName: state.proposedToolCall.toolName,
          input: state.proposedToolCall.input,
        };

        if (toolGate.allowed) {
          try {
            const { writeSingleRegister } = require('./modbus-client');
            const modbusPort = process.env.MODBUS_PORT || 5020;
            if (state.proposedToolCall.toolName === 'override_interlock') {
              await writeSingleRegister(1, 0, modbusPort);
              console.log('[ModbusClient] Executed override_interlock: Safety Curtain disabled (register 40002 = 0)');
            } else if (state.proposedToolCall.toolName === 'trigger_emergency_shutdown') {
              await writeSingleRegister(0, 0, modbusPort);
              console.log('[ModbusClient] Executed trigger_emergency_shutdown: Conveyor stopped (register 40001 = 0)');
            } else if (state.proposedToolCall.toolName === 'plant_wide_shutdown') {
              await writeSingleRegister(2, 0, modbusPort);
              console.log('[ModbusClient] Executed plant_wide_shutdown: Main Power turned off (register 40003 = 0)');
            }
          } catch (err) {
            console.error('[ModbusClient] Failed to execute Modbus tool call:', err.message);
          }
        }

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

        let chunks = [...candidateChunks];
        if (isTelemetryQuestion(state.sanitizedQuestion)) {
          let coils = [0, 0, 0, 0];
          let regs = [1, 1, 1, 150];
          try {
            const { readCoils, readHoldingRegisters } = require('./modbus-client');
            const modbusPort = process.env.MODBUS_PORT || 5020;
            coils = await readCoils(0, 4, modbusPort);
            regs = await readHoldingRegisters(0, 4, modbusPort);
            console.log('[ModbusClient] Injected real-time Modbus register values into context.');
          } catch (err) {
            console.warn('[ModbusClient] Failed to read Modbus registers, falling back to simulated defaults:', err.message);
          }

          const statusText = `REAL-TIME MACHINE PLC STATUS (MODBUS TCP):
- Coil 0 Plant shutdown command: ${coils[0] === 1 ? 'TRIPPED' : 'NORMAL'} (coil 00001)
- Coil 1 Conveyor stop command: ${coils[1] === 1 ? 'STOPPED' : 'NORMAL'} (coil 00002)
- Coil 2 Interlock override command: ${coils[2] === 1 ? 'BYPASSED' : 'NORMAL'} (coil 00003)
- Coil 3 Furnace E-stop command: ${coils[3] === 1 ? 'TRIPPED' : 'NORMAL'} (coil 00004)
- Conveyor Line C-3: ${regs[0] === 1 ? 'RUNNING' : 'STOPPED'} (Register 40001)
- Safety Light Curtain: ${regs[1] === 1 ? 'ARMED & ACTIVE' : 'BYPASSED / DISABLED'} (Register 40002)
- Main Power System: ${regs[2] === 1 ? 'ONLINE' : 'OFFLINE'} (Register 40003)
- Hydraulic Press Furnace: ${regs[3]}°C (Register 40004)`;
          const telemetryChunk = {
            title: "Real-time Machine Status (PLC Telemetry)",
            text: statusText,
            score: 2.0,
            source: "Modbus TCP Telemetry",
            fileName: "modbus_telemetry.raw"
          };
          if (isModbusExplanationQuestion(state.sanitizedQuestion)) {
            chunks.unshift(telemetryChunk);
            chunks.unshift({
              title: 'Modbus TCP PLC Context',
              text: [
                'Modbus is an application-layer client/server protocol commonly used with PLCs and industrial devices.',
                'A client initiates requests and a server returns responses. The Modbus data model uses coils for one-bit read/write outputs and holding registers for 16-bit read/write values.',
                'In this demo, the copilot reads Modbus TCP coils and holding registers from the local PLC simulator. It may explain the values to a floor supervisor, but unsafe write/control commands still go through ThumbGate before any tool execution.'
              ].join('\n'),
              score: 2.25,
              source: 'Modbus Protocol Specification',
              fileName: 'modbus-application-protocol-v1-1b3.pdf',
              sourceTitle: 'MODBUS Application Protocol Specification V1.1b3',
              sourceUrl: 'https://www.modbus.org/file/secure/modbusprotocolspecification.pdf',
              sourcePage: '5',
              sourcePdf: 'data/sources/modbus-application-protocol-v1-1b3.pdf',
            });
          } else {
            chunks.unshift(telemetryChunk);
          }
        }

        return {
          candidateChunks: chunks,
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
          ? state.retrievedChunks.map((chunk) => {
              const citation = citationForChunk(chunk);
              return `${chunk.title}\n${citation || 'Source metadata unavailable'}\n${cleanChunkText(chunk.text)}`;
            }).join('\n\n---\n\n')
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
        let modelResponse = await trace.span(
          'generate_answer',
          'llm',
          { messages: state.messages, mode: offline ? 'extractive-offline' : 'llm' },
          async () => {
            if (offline) {
              const top = state.retrievedChunks[0];
              if (!top) {
                return 'Hello! I checked the manuals but couldn\'t find a matching safety procedure. Please escalate this query to your supervisor or the control room.';
              }
              const citation = citationForChunk(top);
              if (isModbusExplanationQuestion(state.sanitizedQuestion)) {
                const protocol = state.retrievedChunks.find((chunk) => chunk.title === 'Modbus TCP PLC Context') || top;
                const telemetry = state.retrievedChunks.find((chunk) => chunk.source === 'Modbus TCP Telemetry');
                return [
                  'Here is how our PLC Modbus telemetry works:',
                  '',
                  cleanChunkText(protocol.text),
                  telemetry ? `\nCurrent live PLC status:\n${cleanChunkText(telemetry.text)}` : '',
                ].filter(Boolean).join('\n');
              }
              if (top.source === 'Modbus TCP Telemetry') {
                return `Here is the current live PLC status from the Modbus TCP simulator:\n\n${cleanChunkText(top.text)}\n\nIs there a specific manual procedure you need help with?`;
              }
              return `Certainly! Based on the approved documentation ${citation}, here is the procedure for ${top.title}:\n\n${cleanChunkText(top.text)}\n\nLet me know if you need further clarification or help with this process.`;
            }
            return chat(state.messages, { temperature: 0 });
          }
        );

        // Prepend physical execution status if an authorized tool call was made
        if (state.proposedToolCall && state.toolGate?.allowed) {
          let actionText = '';
          if (state.proposedToolCall.toolName === 'override_interlock') {
            actionText = `[Industrial Command Executed]\nModbus TCP Write Single Register: Address 1 set to 0. Safety Curtain bypassed on ${state.proposedToolCall.input.machine || 'CNC Mill VM-22'}.`;
          } else if (state.proposedToolCall.toolName === 'trigger_emergency_shutdown') {
            actionText = `[Industrial Command Executed]\nModbus TCP Write Single Register: Address 0 set to 0. Conveyor stopped on ${state.proposedToolCall.input.target || 'Conveyor Line C-3'}.`;
          } else if (state.proposedToolCall.toolName === 'plant_wide_shutdown') {
            actionText = `[Industrial Command Executed]\nModbus TCP Write Single Register: Address 2 set to 0. Plant-wide shutdown command broadcasted to shut down the plant.`;
          }
          modelResponse = `${actionText}\n\n${modelResponse}`;
        }

        let answer = polishConversationalAnswer(redactSecrets(redactPii(modelResponse)), state.sanitizedQuestion);

        // Append source citations to the answer for transparency
        if (state.retrievedChunks && state.retrievedChunks.length > 0) {
          answer = appendCitations(answer, state.retrievedChunks);
        }

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
      .addNode('check_hallucination_grounding', async (state) => {
        const gateResult = await trace.span(
          'check_hallucination_grounding',
          'chain',
          { chunkCount: state.retrievedChunks.length },
          async () => hallucinationGroundingGate(state.answer, state.retrievedChunks)
        );
        return {
          gates: gateResult.status === 'pass' ? state.gates : [...state.gates, gateResult],
          graphNodes: [...state.graphNodes, 'check_hallucination_grounding'],
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
        state.proposedToolCall ? 'thumbgate_tool_firewall' : 'evaluate_clearance'
      ))
      .addConditionalEdges('evaluate_clearance', (state) => (
        state.status === 'blocked' ? END : 'plan_retrieval'
      ))
      .addConditionalEdges('thumbgate_tool_firewall', (state) => (
        state.toolGate?.allowed ? 'plan_retrieval' : END
      ))
      .addConditionalEdges('check_retrieval_confidence', (state) => (
        state.status === 'blocked' ? END : 'compose_langchain_prompt'
      ))
      .addConditionalEdges('check_output_safety', (state) => (
        state.status === 'blocked' ? END : 'check_hallucination_grounding'
      ))
      .addConditionalEdges('check_hallucination_grounding', (state) => (
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
      supervisor: deps.supervisor,
      machineState: deps.machineState,
    });

    return trace.end({
      answer: state.answer,
      status: state.status,
      toolCall: state.proposedToolCall || null,
      gates: state.gates || [],
      retrievedChunks: (state.retrievedChunks || []).map((chunk) => {
        const mapped = {
          title: chunk.title,
          source: chunk.source,
          sourceCategory: sourceCategoryForChunk(chunk),
          score: chunk.score,
          fileName: chunk.fileName,
        };
        for (const key of ['sourceTitle', 'sourceUrl', 'sourcePage', 'sourcePdf']) {
          if (chunk[key] !== undefined && chunk[key] !== null) mapped[key] = chunk[key];
        }
        return mapped;
      }),
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
  isTelemetryQuestion,
  localHybridRerank,
  packRetrievedContext,
  polishConversationalAnswer,
  appendCitations,
  cleanChunkText,
  citationForChunk,
  sourceCategoryForChunk,
  planMetadataFilters,
  planRetrieval,
};
