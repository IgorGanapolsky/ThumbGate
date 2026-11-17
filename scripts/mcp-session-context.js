'use strict';

// Per-connection process.env and process.cwd() for the shared MCP daemon.
//
// The tool code reads process.env and process.cwd() at call time to resolve the
// project, feedback directory, MCP profile and agent identity. One daemon serves
// many clients, so each connection gets its own env/cwd, carried through async
// calls with AsyncLocalStorage. Code running outside a connection (daemon
// startup, watchers) sees the daemon's real env.

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();
let installed = null;

function currentEnv(realEnv) {
  const store = storage.getStore();
  return store ? store.env : realEnv;
}

function installSessionContext() {
  if (installed) return installed;
  const realEnv = process.env;
  const realCwd = process.cwd.bind(process);

  const proxy = new Proxy({}, {
    get: (_t, key) => currentEnv(realEnv)[key],
    set: (_t, key, value) => { currentEnv(realEnv)[key] = String(value); return true; },
    has: (_t, key) => key in currentEnv(realEnv),
    deleteProperty: (_t, key) => { delete currentEnv(realEnv)[key]; return true; },
    ownKeys: () => Reflect.ownKeys(currentEnv(realEnv)),
    getOwnPropertyDescriptor: (_t, key) => {
      const env = currentEnv(realEnv);
      if (!Object.prototype.hasOwnProperty.call(env, key)) return undefined;
      return { value: env[key], writable: true, enumerable: true, configurable: true };
    },
    defineProperty: (_t, key, descriptor) => {
      currentEnv(realEnv)[key] = String(descriptor.value);
      return true;
    },
  });

  process.env = proxy;
  process.cwd = () => {
    const store = storage.getStore();
    return store && store.cwd ? store.cwd : realCwd();
  };
  installed = { realEnv, realCwd };
  return installed;
}

function runInSession(session, fn) {
  return storage.run(session, fn);
}

function createSession({ env, cwd } = {}) {
  const safeEnv = {};
  if (env && typeof env === 'object') {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') safeEnv[key] = value;
    }
  }
  return { env: safeEnv, cwd: typeof cwd === 'string' && cwd ? cwd : null };
}

module.exports = { createSession, installSessionContext, runInSession };
