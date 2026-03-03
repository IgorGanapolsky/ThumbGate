#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const {
  captureFeedback,
  analyzeFeedback,
  feedbackSummary,
  writePreventionRules,
  getFeedbackPaths,
} = require('../../scripts/feedback-loop');
const {
  readJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('../../scripts/export-dpo-pairs');
const {
  ensureContextFs,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
} = require('../../scripts/contextfs');

function getSafeDataDir() {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  return path.resolve(path.dirname(FEEDBACK_LOG_PATH));
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function parseJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createHttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(createHttpError(400, 'Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function getExpectedApiKey() {
  if (process.env.RLHF_ALLOW_INSECURE === 'true') return null;
  const configured = process.env.RLHF_API_KEY;
  if (!configured) {
    throw new Error('RLHF_API_KEY is required unless RLHF_ALLOW_INSECURE=true');
  }
  return configured;
}

function isAuthorized(req, expected) {
  if (!expected) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${expected}`;
}

function extractTags(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveSafePath(inputPath, { mustExist = false } = {}) {
  const allowExternal = process.env.RLHF_ALLOW_EXTERNAL_PATHS === 'true';
  const resolved = path.resolve(String(inputPath || ''));
  const SAFE_DATA_DIR = getSafeDataDir();
  const inSafeRoot = resolved === SAFE_DATA_DIR || resolved.startsWith(`${SAFE_DATA_DIR}${path.sep}`);

  if (!allowExternal && !inSafeRoot) {
    throw createHttpError(400, `Path must stay within ${SAFE_DATA_DIR}`);
  }

  if (mustExist && !fs.existsSync(resolved)) {
    throw createHttpError(400, `Path does not exist: ${resolved}`);
  }

  return resolved;
}

function createApiServer() {
  const expectedApiKey = getExpectedApiKey();

  return http.createServer(async (req, res) => {
    if (!isAuthorized(req, expectedApiKey)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname;

    try {
      if (req.method === 'GET' && pathname === '/healthz') {
        const { FEEDBACK_LOG_PATH, MEMORY_LOG_PATH } = getFeedbackPaths();
        sendJson(res, 200, {
          status: 'ok',
          feedbackLogPath: FEEDBACK_LOG_PATH,
          memoryLogPath: MEMORY_LOG_PATH,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/feedback/stats') {
        sendJson(res, 200, analyzeFeedback());
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/feedback/summary') {
        const recent = Number(parsed.searchParams.get('recent') || 20);
        const summary = feedbackSummary(Number.isFinite(recent) ? recent : 20);
        sendJson(res, 200, { summary });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/capture') {
        const body = await parseJsonBody(req);
        const result = captureFeedback({
          signal: body.signal,
          context: body.context || '',
          whatWentWrong: body.whatWentWrong,
          whatToChange: body.whatToChange,
          whatWorked: body.whatWorked,
          tags: extractTags(body.tags),
          skill: body.skill,
        });
        const code = result.accepted ? 200 : 422;
        sendJson(res, code, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/rules') {
        const body = await parseJsonBody(req);
        const minOccurrences = Number(body.minOccurrences || 2);
        const outputPath = body.outputPath ? resolveSafePath(body.outputPath) : undefined;
        const result = writePreventionRules(outputPath, Number.isFinite(minOccurrences) ? minOccurrences : 2);
        sendJson(res, 200, {
          path: result.path,
          markdown: result.markdown,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/dpo/export') {
        const body = await parseJsonBody(req);
        let memories = [];

        if (body.inputPath) {
          const safeInputPath = resolveSafePath(body.inputPath, { mustExist: true });
          const raw = fs.readFileSync(safeInputPath, 'utf-8');
          const parsedMemories = JSON.parse(raw);
          memories = Array.isArray(parsedMemories) ? parsedMemories : parsedMemories.memories || [];
        } else {
          const localPath = body.memoryLogPath
            ? resolveSafePath(body.memoryLogPath, { mustExist: true })
            : DEFAULT_LOCAL_MEMORY_LOG;
          memories = readJSONL(localPath);
        }

        const result = exportDpoFromMemories(memories);
        if (body.outputPath) {
          const safeOutputPath = resolveSafePath(body.outputPath);
          fs.mkdirSync(path.dirname(safeOutputPath), { recursive: true });
          fs.writeFileSync(safeOutputPath, result.jsonl);
        }

        sendJson(res, 200, {
          pairs: result.pairs.length,
          errors: result.errors.length,
          learnings: result.learnings.length,
          unpairedErrors: result.unpairedErrors.length,
          unpairedLearnings: result.unpairedLearnings.length,
          outputPath: body.outputPath ? resolveSafePath(body.outputPath) : null,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/context/construct') {
        const body = await parseJsonBody(req);
        ensureContextFs();
        let namespaces = [];
        try {
          namespaces = normalizeNamespaces(Array.isArray(body.namespaces) ? body.namespaces : []);
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid namespaces');
        }
        const pack = constructContextPack({
          query: body.query || '',
          maxItems: Number(body.maxItems || 8),
          maxChars: Number(body.maxChars || 6000),
          namespaces,
        });
        sendJson(res, 200, pack);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/context/evaluate') {
        const body = await parseJsonBody(req);
        if (!body.packId || !body.outcome) {
          throw createHttpError(400, 'packId and outcome are required');
        }
        const evaluation = evaluateContextPack({
          packId: body.packId,
          outcome: body.outcome,
          signal: body.signal || null,
          notes: body.notes || '',
        });
        sendJson(res, 200, evaluation);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/context/provenance') {
        const limit = Number(parsed.searchParams.get('limit') || 50);
        const events = getProvenance(Number.isFinite(limit) ? limit : 50);
        sendJson(res, 200, { events });
        return;
      }

      if (req.method === 'GET' && pathname === '/') {
        sendText(res, 200, 'RLHF Feedback Loop API is running.');
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      if (err.statusCode) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });
}

function startServer({ port } = {}) {
  const listenPort = Number(port ?? process.env.PORT ?? 8787);
  const server = createApiServer();
  return new Promise((resolve) => {
    server.listen(listenPort, () => {
      const address = server.address();
      const actualPort = (address && typeof address === 'object' && address.port)
        ? address.port
        : listenPort;
      resolve({
        server,
        port: actualPort,
      });
    });
  });
}

module.exports = {
  createApiServer,
  startServer,
};

if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`RLHF API listening on http://localhost:${port}`);
  });
}
