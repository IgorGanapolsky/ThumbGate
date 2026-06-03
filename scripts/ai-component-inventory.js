#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_FILES = 2500;
const DEFAULT_MAX_BYTES = 1024 * 1024;

const IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.thumbgate',
  '.venv',
  'venv',
  '__pycache__',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.ipynb',
  '.go',
  '.java',
  '.rb',
  '.rs',
  '.php',
  '.cs',
  '.swift',
  '.kt',
  '.scala',
  '.sh',
  '.yaml',
  '.yml',
  '.toml',
  '.json',
  '.ini',
]);

const MODEL_EXTENSIONS = new Map([
  ['.gguf', { name: 'GGUF model artifact', category: 'model_artifact', ecosystem: 'local-model' }],
  ['.safetensors', { name: 'SafeTensors model artifact', category: 'model_artifact', ecosystem: 'local-model' }],
  ['.onnx', { name: 'ONNX model artifact', category: 'model_artifact', ecosystem: 'onnx' }],
  ['.pt', { name: 'PyTorch model artifact', category: 'model_artifact', ecosystem: 'pytorch' }],
  ['.pth', { name: 'PyTorch model artifact', category: 'model_artifact', ecosystem: 'pytorch' }],
  ['.tflite', { name: 'TensorFlow Lite model artifact', category: 'model_artifact', ecosystem: 'tensorflow' }],
]);

const SOURCE_PATTERNS = [
  component('openai', 'OpenAI SDK/API', 'provider_sdk', 'openai', /\b(from\s+openai\s+import|import\s+openai\b|require\(['"]openai['"]\)|from\s+['"]openai['"]|@openai\/agents|new\s+OpenAI\s*\()/i),
  component('anthropic', 'Anthropic Claude SDK/API', 'provider_sdk', 'anthropic', /\b(@anthropic-ai\/sdk|from\s+anthropic\s+import|import\s+anthropic\b|require\(['"]@anthropic-ai\/sdk['"]\)|new\s+Anthropic\s*\()/i),
  component('google-gemini', 'Google Gemini SDK/API', 'provider_sdk', 'google', /\b(@google\/generative-ai|google-genai|from\s+google\s+import\s+genai|GoogleGenerativeAI|GenerativeModel)/i),
  component('vertex-ai', 'Google Vertex AI', 'ai_platform', 'google-cloud', /\b(vertexai|aiplatform|@google-cloud\/vertexai|PredictionServiceClient|projects\.locations\.publishers\.models)/i),
  component('dialogflow-cx', 'Google Dialogflow CX', 'conversation_ai', 'google-cloud', /\b(dialogflowcx|dialogflow-cx|@google-cloud\/dialogflow-cx|SessionsClient|DetectIntentRequest)/i),
  component('langchain', 'LangChain', 'agent_framework', 'langchain', /\b(@langchain\/|langchain\b|from\s+langchain(_community|_core)?\b)/i),
  component('llamaindex', 'LlamaIndex', 'agent_framework', 'llamaindex', /\b(llama_index|llamaindex|from\s+llama_index\b)/i),
  component('semantic-kernel', 'Semantic Kernel', 'agent_framework', 'microsoft', /\b(semantic-kernel|semantic_kernel|Microsoft\.SemanticKernel)/i),
  component('crewai', 'CrewAI', 'agent_framework', 'crewai', /\b(crewai|from\s+crewai\b)/i),
  component('autogen', 'AutoGen', 'agent_framework', 'microsoft', /\b(autogen|pyautogen|@microsoft\/autogen)/i),
  component('transformers', 'Hugging Face Transformers', 'ml_framework', 'huggingface', /\b(transformers|AutoModel|AutoTokenizer|pipeline\s*\()/i),
  component('sentence-transformers', 'Sentence Transformers', 'embedding_model', 'huggingface', /\b(sentence_transformers|SentenceTransformer)/i),
  component('pytorch', 'PyTorch', 'ml_framework', 'pytorch', /\b(import\s+torch\b|from\s+torch\b|torch\.)/i),
  component('tensorflow', 'TensorFlow/Keras', 'ml_framework', 'tensorflow', /\b(import\s+tensorflow\b|from\s+tensorflow\b|import\s+keras\b|from\s+keras\b|tf\.keras)/i),
  component('scikit-learn', 'scikit-learn', 'ml_framework', 'scikit-learn', /\b(sklearn|scikit-learn|from\s+sklearn\b)/i),
  component('onnxruntime', 'ONNX Runtime', 'ml_runtime', 'onnx', /\b(onnxruntime|InferenceSession)/i),
  component('pinecone', 'Pinecone vector database', 'vector_database', 'pinecone', /\b(pinecone|@pinecone-database\/pinecone)/i),
  component('weaviate', 'Weaviate vector database', 'vector_database', 'weaviate', /\b(weaviate|weaviate-client)/i),
  component('qdrant', 'Qdrant vector database', 'vector_database', 'qdrant', /\b(qdrant|@qdrant\/js-client-rest|qdrant-client)/i),
  component('chroma', 'Chroma vector database', 'vector_database', 'chroma', /\b(chromadb|chroma-client|ChromaClient)/i),
  component('lancedb', 'LanceDB vector database', 'vector_database', 'lancedb', /\b(lancedb|@lancedb\/lancedb)/i),
  component('faiss', 'FAISS vector index', 'vector_database', 'faiss', /\b(faiss|faiss-cpu|faiss-gpu)/i),
  component('pgvector', 'Postgres pgvector', 'vector_database', 'postgres', /\b(pgvector|vector\(\d+\)|CREATE\s+EXTENSION\s+vector)/i),
];

const MANIFEST_FILES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'Pipfile',
  'Gemfile',
  'go.mod',
  'Cargo.toml',
]);

function component(id, name, category, ecosystem, pattern) {
  return { id, name, category, ecosystem, pattern };
}

function relativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name);
}

function isTextLike(filePath) {
  const base = path.basename(filePath);
  if (MANIFEST_FILES.has(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkFiles(rootDir, options = {}) {
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
  const files = [];
  const queue = [rootDir];

  while (queue.length && files.length < maxFiles) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDir(entry.name)) queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
        if (files.length >= maxFiles) break;
      }
    }
  }

  return files;
}

function readLines(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return null;
  }
  if (!stat.isFile() || stat.size > maxBytes) return null;

  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  } catch (_) {
    return null;
  }
}

function addEvidence(map, componentDef, evidence, maxEvidencePerComponent) {
  const current = map.get(componentDef.id) || {
    id: componentDef.id,
    name: componentDef.name,
    category: componentDef.category,
    ecosystem: componentDef.ecosystem,
    evidence: [],
  };

  if (current.evidence.length < maxEvidencePerComponent) {
    const duplicate = current.evidence.some((item) => (
      item.file === evidence.file && item.line === evidence.line && item.kind === evidence.kind
    ));
    if (!duplicate) current.evidence.push(evidence);
  }
  map.set(componentDef.id, current);
}

function scanSourceFile(rootDir, filePath, map, options) {
  const lines = readLines(filePath, options.maxBytes);
  if (!lines) return;

  const rel = relativePath(rootDir, filePath);
  lines.forEach((line, idx) => {
    for (const def of SOURCE_PATTERNS) {
      if (!def.pattern.test(line)) continue;
      addEvidence(map, def, {
        kind: 'source',
        file: rel,
        line: idx + 1,
        snippet: options.includeSnippets === false ? undefined : line.trim().slice(0, 220),
      }, options.maxEvidencePerComponent);
    }
  });
}

function scanManifestFile(rootDir, filePath, map, options) {
  const lines = readLines(filePath, options.maxBytes);
  if (!lines) return;
  const rel = relativePath(rootDir, filePath);

  lines.forEach((line, idx) => {
    for (const def of SOURCE_PATTERNS) {
      if (!def.pattern.test(line)) continue;
      addEvidence(map, def, {
        kind: 'manifest',
        file: rel,
        line: idx + 1,
        snippet: options.includeSnippets === false ? undefined : line.trim().slice(0, 220),
      }, options.maxEvidencePerComponent);
    }
  });
}

function scanModelArtifact(rootDir, filePath, map, options) {
  const ext = path.extname(filePath).toLowerCase();
  const def = MODEL_EXTENSIONS.get(ext);
  if (!def) return;

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    stat = null;
  }

  addEvidence(map, {
    id: `${def.ecosystem}-${ext.slice(1)}-artifact`,
    ...def,
  }, {
    kind: 'artifact',
    file: relativePath(rootDir, filePath),
    line: null,
    bytes: stat ? stat.size : undefined,
  }, options.maxEvidencePerComponent);
}

function summarizeComponents(components) {
  const byCategory = {};
  const byEcosystem = {};
  for (const item of components) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    byEcosystem[item.ecosystem] = (byEcosystem[item.ecosystem] || 0) + 1;
  }
  return { byCategory, byEcosystem };
}

function scanAiComponents(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const maxEvidencePerComponent = Number(options.maxEvidencePerComponent || 10);
  const scanOptions = {
    maxFiles: options.maxFiles || DEFAULT_MAX_FILES,
    maxBytes: options.maxBytes || DEFAULT_MAX_BYTES,
    includeSnippets: options.includeSnippets !== false,
    maxEvidencePerComponent,
  };

  const files = walkFiles(rootDir, scanOptions);
  const map = new Map();

  for (const filePath of files) {
    scanModelArtifact(rootDir, filePath, map, scanOptions);
    const base = path.basename(filePath);
    if (MANIFEST_FILES.has(base)) {
      scanManifestFile(rootDir, filePath, map, scanOptions);
      continue;
    }
    if (isTextLike(filePath)) scanSourceFile(rootDir, filePath, map, scanOptions);
  }

  const components = Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
  const summary = summarizeComponents(components);
  return {
    schemaVersion: 'thumbgate.ai-inventory.v1',
    generatedAt: new Date().toISOString(),
    rootDir,
    filesScanned: files.length,
    componentCount: components.length,
    summary,
    components,
  };
}

function buildCycloneDxMlBom(inventory, options = {}) {
  const serialHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      rootDir: inventory.rootDir,
      components: inventory.components.map((item) => [item.id, item.evidence.map((e) => e.file)]),
    }))
    .digest('hex')
    .slice(0, 32);

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${serialHash.slice(0, 8)}-${serialHash.slice(8, 12)}-${serialHash.slice(12, 16)}-${serialHash.slice(16, 20)}-${serialHash.slice(20, 32)}`,
    version: 1,
    metadata: {
      timestamp: inventory.generatedAt,
      tools: [
        {
          vendor: 'ThumbGate',
          name: 'AI Component Inventory',
          version: options.version || 'local',
        },
      ],
      properties: [
        { name: 'thumbgate:rootDir', value: inventory.rootDir },
        { name: 'thumbgate:filesScanned', value: String(inventory.filesScanned) },
        { name: 'thumbgate:componentCount', value: String(inventory.componentCount) },
      ],
    },
    components: inventory.components.map((item) => ({
      type: item.category === 'model_artifact' ? 'machine-learning-model' : 'library',
      name: item.name,
      group: item.ecosystem,
      bomRef: `thumbgate:${item.id}`,
      properties: [
        { name: 'thumbgate:category', value: item.category },
        { name: 'thumbgate:evidenceCount', value: String(item.evidence.length) },
        { name: 'thumbgate:evidence', value: JSON.stringify(item.evidence.map((e) => ({ file: e.file, line: e.line, kind: e.kind }))) },
      ],
    })),
  };
}

function formatInventoryText(inventory) {
  const lines = [];
  lines.push('ThumbGate AI Component Inventory');
  lines.push(`  Root              : ${inventory.rootDir}`);
  lines.push(`  Files scanned     : ${inventory.filesScanned}`);
  lines.push(`  AI components     : ${inventory.componentCount}`);
  lines.push('');
  lines.push('By category:');
  const categories = Object.entries(inventory.summary.byCategory).sort((a, b) => a[0].localeCompare(b[0]));
  if (!categories.length) lines.push('  none detected');
  for (const [category, count] of categories) lines.push(`  ${category}: ${count}`);
  lines.push('');
  lines.push('Evidence:');
  if (!inventory.components.length) lines.push('  none detected');
  for (const item of inventory.components) {
    lines.push(`  - ${item.name} (${item.category}, ${item.ecosystem})`);
    for (const evidence of item.evidence.slice(0, 3)) {
      const loc = evidence.line ? `${evidence.file}:${evidence.line}` : evidence.file;
      lines.push(`      ${loc} [${evidence.kind}]`);
    }
  }
  return lines.join('\n');
}

function writeOutput(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

module.exports = {
  SOURCE_PATTERNS,
  MODEL_EXTENSIONS,
  scanAiComponents,
  buildCycloneDxMlBom,
  formatInventoryText,
  writeOutput,
};
