// ThumbGate Gate executa (self-contained compiled binary): JSON-RPC 2.0 over stdio
// bridging to the bundled ThumbGate MCP server. No external Node/npm at runtime. MIT, thumbgate.ai
const fs = require('fs');
const readline = require('readline');
const Module = require('module');

// Defuse every CLI self-launch guard in bundled modules: in a single-file pkg bundle,
// argv[1] equals the bundle path, so "am I the main?" checks evaluate true. Point argv[1]
// at an empty (falsy) value so every guard evaluates false and only the bridge serves stdio.
const argvClone = process.argv.slice();
argvClone[1] = '';
Object.defineProperty(process, 'argv', { value: argvClone, writable: true, configurable: true });

const origExit = process.exit;
process.exit = function (code) { try { fs.writeSync(2, 'EXIT-HOOK code=' + code + '\n' + new Error().stack + '\n'); } catch (e) {} return origExit.apply(this, arguments); };

// pkg snapshots are read-only: remap any write/mkdir under /snapshot to a writable dir under HOME.
const os = require('os');
const pathMod = require('path');
function remapSnap(p) {
  if (typeof p === 'string' && p.indexOf('/snapshot') === 0) {
    const rel = p.slice('/snapshot'.length).replace(/^\/+/, '');
    return pathMod.join(os.homedir(), 'tgsrv-data', rel);
  }
  return p;
}
const _mkdirSync = fs.mkdirSync;
fs.mkdirSync = function (p, opts) { try { return _mkdirSync.call(fs, remapSnap(p), opts); } catch (e) { if (e && e.code === 'EEXIST') return undefined; throw e; } };
const _writeFileSync = fs.writeFileSync;
fs.writeFileSync = function (p) { arguments[0] = remapSnap(p); return _writeFileSync.apply(fs, arguments); };
const _appendFileSync = fs.appendFileSync;
fs.appendFileSync = function (p) { arguments[0] = remapSnap(p); return _appendFileSync.apply(fs, arguments); };
const _createWriteStream = fs.createWriteStream;
fs.createWriteStream = function (p) { arguments[0] = remapSnap(p); return _createWriteStream.apply(fs, arguments); };
if (fs.promises) {
  for (const m of ['mkdir', 'writeFile', 'appendFile', 'open']) {
    const orig = fs.promises[m].bind(fs.promises);
    fs.promises[m] = function (p) { arguments[0] = remapSnap(p); return orig.apply(null, arguments); };
  }
}

// Keep the JSON-RPC stdio stream clean: divert every library stdout write to stderr.
// Legitimate JSON-RPC responses go directly to fd 1 below.
process.stdout.write = function (chunk, encoding, cb) {
  try { fs.writeSync(2, typeof chunk === 'string' ? chunk : Buffer.from(chunk)); } catch (e) {}
  if (typeof cb === 'function') cb();
  return true;
};
const origLog = console.log.bind(console);
console.log = function () { try { fs.writeSync(2, Array.prototype.map.call(arguments, String).join(' ') + '\n'); } catch (e) {} };

const NATIVE_NAMES = { 'better-sqlite3': 'better-sqlite3', '@lancedb/lancedb': 'lancedb' };

function nativeUnavailable(name) {
  const err = new Error(name + ' is not available in the packaged ThumbGate binary; related features are disabled in this build.');
  err.code = 'MODULE_NOT_FOUND';
  return err;
}

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (Object.prototype.hasOwnProperty.call(NATIVE_NAMES, request)) throw nativeUnavailable(NATIVE_NAMES[request]);
  return origResolve.call(this, request, parent, isMain, options);
};

try { fs.writeSync(2, 'ENTRY-MARK-before-require\n'); } catch (e) {}
let reqErr = null; let handleRequest, callTool;
try { const m = require('thumbgate/adapters/mcp/server-stdio'); handleRequest = m.handleRequest; callTool = m.callTool; }
catch (e) { reqErr = e; try { fs.writeSync(2, 'ENTRY-MARK-require-failed: ' + (e && (e.stack || e.message)) + '\n'); } catch (e2) {} }
try { fs.writeSync(2, 'ENTRY-MARK-after-require reqErr=' + (reqErr ? 'YES' : 'no') + '\n'); } catch (e) {}
try { fs.writeSync(2, 'ENTRY-MARK-after-require\n'); } catch (e) {}

const EXECUTA_VERSION = '1.0.3';

function reply(id, payload) {
  const s = JSON.stringify(Object.assign({ jsonrpc: '2.0', id: id }, payload)) + '\n'; fs.writeSync(1, s); try { fs.writeSync(2, 'ENTRY-MARK-wrote ' + s.length + 'B\n'); } catch (e) {}
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
try { fs.writeSync(2, 'ENTRY-MARK-rl-attached\n'); } catch (e) {}
rl.on('line', async (line) => {
  try { fs.writeSync(2, 'ENTRY-MARK-line: ' + line.slice(0, 60) + '\n'); } catch (e) {}
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  const id = msg.id;
  const method = msg.method;
  const params = msg.params;
  if (method === 'shutdown') {
    if (id !== undefined) reply(id, { result: {} });
    process.exit(0);
  }
  let result = null;
  let error = null;
  try {
    if (method && method.indexOf('tools/call') === 0) {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      result = await callTool(name, args);
    } else if (method) {
      result = await handleRequest({ id: id, method: method, params: params });
      if (method === 'initialize' && result && result.serverInfo) {
        result.serverInfo = { name: 'thumbgate-gate', version: EXECUTA_VERSION };
      }
    }
  } catch (e) {
    error = { code: -32603, message: (e && e.message) || String(e) };
  }
  try { fs.writeSync(2, 'ENTRY-MARK-done id=' + JSON.stringify(id) + ' err=' + (error ? error.message : 'none') + '\n'); } catch (e) {}
  if (id === undefined) return; // notification: no response expected
  if (error) reply(id, { error: error });
  else reply(id, { result: (result === undefined || result === null) ? {} : result });
});
