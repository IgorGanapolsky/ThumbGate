'use strict';

/**
 * ThumbGate Universal Agent Driver & Multi-Agent Verify-and-Repair Diode
 *
 * Stolen & Improved from Dan Kornas / GenAIcode (https://github.com/gtanczyk/genaicode)
 * and enhanced with ThumbGate Pre-Action Firewall Diodes, Cross-Agent Swarm Fallbacks,
 * and Memory-Scope Invariant Injection.
 *
 * Drives: Claude Code, OpenAI Codex, GitHub Copilot CLI, Cursor, Gemini CLI,
 *         OpenCode, Poolside Laguna 2.1, and Antigravity.
 */

const { spawn, execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Standard supported agent metadata & CLI argument adapters
const SUPPORTED_AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    binNames: ['claude'],
    buildArgs: ({ prompt, permissions, mcpConfigPath }) => {
      const args = ['--print', prompt];
      if (permissions === 'yolo') {
        args.push('--dangerously-skip-permissions');
      }
      if (mcpConfigPath) {
        args.push('--mcp-config', mcpConfigPath);
      }
      return args;
    },
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    binNames: ['codex'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['exec', prompt];
      if (permissions === 'yolo') {
        args.push('--yolo');
      }
      return args;
    },
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    binNames: ['copilot', 'gh-copilot'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['-p', prompt];
      if (permissions === 'yolo') {
        args.push('--allow-all-tools');
      }
      return args;
    },
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor Agent CLI',
    binNames: ['cursor', 'cursor-agent'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['--agent', prompt];
      if (permissions === 'yolo') {
        args.push('--force');
      }
      return args;
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    binNames: ['gemini'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['run', prompt];
      if (permissions === 'yolo') {
        args.push('--approval-mode', 'auto');
      }
      return args;
    },
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode CLI',
    binNames: ['opencode'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['run', prompt];
      if (permissions === 'yolo') {
        args.push('--yes');
      }
      return args;
    },
  },
  poolside: {
    id: 'poolside',
    name: 'Poolside Laguna 2.1',
    binNames: ['poolside'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['run', prompt];
      if (permissions === 'yolo') {
        args.push('--sandbox', 'disabled', '--mode', 'always-allow');
      }
      return args;
    },
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity CLI',
    binNames: ['antigravity'],
    buildArgs: ({ prompt, permissions }) => {
      const args = ['exec', prompt];
      if (permissions === 'yolo') {
        args.push('--auto-approve');
      }
      return args;
    },
  },
};

/**
 * Searches standard system paths and environment PATH for an executable binary.
 */
function findExecutable(binName) {
  const envPath = process.env.PATH || '';
  const searchDirs = [
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    ...envPath.split(path.delimiter).filter(Boolean),
  ];

  for (const dir of searchDirs) {
    const candidate = path.join(dir, binName);
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
        if (stats.isFile() && (stats.mode & 0o111)) {
          return candidate;
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return null;
}

/**
 * Detects all installed and available coding agent CLIs on the current host.
 */
function detectAgents(requestedList = null) {
  const targetKeys = requestedList && requestedList.length > 0
    ? requestedList.map(k => String(k).toLowerCase())
    : Object.keys(SUPPORTED_AGENTS);

  const results = [];

  for (const key of targetKeys) {
    const agentDef = SUPPORTED_AGENTS[key];
    if (!agentDef) continue;

    let resolvedPath = null;
    for (const bName of agentDef.binNames) {
      resolvedPath = findExecutable(bName);
      if (resolvedPath) break;
    }

    let version = null;
    if (resolvedPath) {
      try {
        const out = execFileSync(resolvedPath, ['--version'], {
          timeout: 2500,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const match = out.match(/(\d+\.\d+(\.\d+)?)/);
        version = match ? match[1] : out.trim().split('\n')[0];
      } catch {
        version = 'detected';
      }
    }

    results.push({
      id: agentDef.id,
      name: agentDef.name,
      path: resolvedPath,
      available: Boolean(resolvedPath),
      version,
    });
  }

  return results;
}

/**
 * Environment credential isolator: strips parent process provider credentials
 * so agent runs isolated without unexpected billing leakage.
 */
function withoutProviderCredentials(env = process.env) {
  const stripped = { ...env };
  const keysToRemove = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'MISTRAL_API_KEY',
    'GROQ_API_KEY',
  ];
  for (const key of keysToRemove) {
    delete stripped[key];
  }
  return stripped;
}

/**
 * Pre-action firewall diode check for universal driver.
 * Rejects high-risk actions before tool invocation.
 */
function evaluatePreActionSafety(command, changedPaths = []) {
  const dangerousCommandPatterns = [
    /rm\s+-rf\s+(\/|~|\$HOME|\.\.|\*)/i,
    /git\s+reset\s+--hard/i,
    /git\s+checkout\s+--force/i,
    /git\s+clean\s+-fdx/i,
    /git\s+push\s+.*--force/i,
    /mkfs\./i,
    /dd\s+if=/i,
    /:>{1,2}\s*\/etc\//i,
  ];

  for (const pat of dangerousCommandPatterns) {
    if (pat.test(command)) {
      return {
        allowed: false,
        reason: `Blocked by ThumbGate Pre-Action Firewall: prohibited destructive command pattern '${command}'`,
      };
    }
  }

  const corporateDomains = [
    /@ecisolutions\.com/i,
    /@ecinexus\.com/i,
    /@eci\.com/i,
  ];
  for (const dom of corporateDomains) {
    if (dom.test(command)) {
      return {
        allowed: false,
        reason: 'Blocked by ThumbGate Pre-Action Firewall: prohibited corporate ECI domain detected',
      };
    }
  }

  const protectedPathPatterns = [
    /\.env($|\.)/i,
    /id_rsa/i,
    /\.aws\/credentials/i,
    /\.ssh\//i,
  ];

  for (const p of changedPaths) {
    for (const pat of protectedPathPatterns) {
      if (pat.test(p)) {
        return {
          allowed: false,
          reason: `Blocked by ThumbGate Pre-Action Firewall: writing or modifying protected secret path '${p}'`,
        };
      }
    }
  }

  return { allowed: true, reason: 'Allowed by policy' };
}

/**
 * Formats options and generates CLI arguments for an agent execution.
 */
function buildAgentCommand(agentId, options = {}) {
  const agentDef = SUPPORTED_AGENTS[agentId];
  if (!agentDef) {
    throw new Error(`Unsupported agent id '${agentId}'. Supported: ${Object.keys(SUPPORTED_AGENTS).join(', ')}`);
  }

  const { prompt, permissions = 'yolo', mcpConfigPath = null } = options;
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('A prompt string is required to run an agent.');
  }

  const args = agentDef.buildArgs({ prompt, permissions, mcpConfigPath });
  return { agentDef, args };
}

/**
 * Runs an agent task with normalized event streaming.
 */
async function runAgent(options = {}, onEvent = null) {
  const {
    agent = 'claude',
    prompt,
    cwd = process.cwd(),
    permissions = 'yolo',
    isolateCredentials = false,
    timeoutMs = 180_000,
    mcpConfigPath = null,
    mockRunner = null, // for deterministic testing
  } = options;

  const safety = evaluatePreActionSafety(prompt);
  if (!safety.allowed) {
    if (typeof onEvent === 'function') {
      try { onEvent({ type: 'safety-violation', agent, reason: safety.reason }); } catch {}
    }
    return {
      ok: false,
      agent,
      status: 'blocked',
      text: '',
      changedFiles: [],
      durationMs: 0,
      error: safety.reason,
    };
  }

  const detected = detectAgents([agent])[0];
  if (!detected || !detected.available) {
    if (!mockRunner) {
      throw new Error(`Agent '${agent}' is not installed or available on this system.`);
    }
  }

  const emit = (event) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event);
      } catch {
        // Safe event callback
      }
    }
  };

  emit({ type: 'status', phase: 'starting', agent });

  const env = isolateCredentials
    ? withoutProviderCredentials(process.env)
    : { ...process.env };

  const startTime = Date.now();

  if (mockRunner) {
    emit({ type: 'status', phase: 'running', agent });
    const mockRes = await mockRunner({ prompt, cwd, permissions, env });
    emit({ type: 'status', phase: 'completed', agent });
    return {
      ok: mockRes.ok ?? true,
      agent,
      status: mockRes.ok ? 'completed' : 'failed',
      text: mockRes.text || '',
      changedFiles: mockRes.changedFiles || [],
      durationMs: Date.now() - startTime,
      error: mockRes.error || null,
    };
  }

  const { args } = buildAgentCommand(agent, { prompt, permissions, mcpConfigPath });

  return new Promise((resolve) => {
    emit({ type: 'status', phase: 'running', agent, command: [detected.path, ...args].join(' ') });

    const proc = spawn(detected.path, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const changedFiles = new Set();

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      emit({ type: 'status', phase: 'timeout', agent });
      resolve({
        ok: false,
        agent,
        status: 'timeout',
        text: stdout,
        changedFiles: Array.from(changedFiles),
        durationMs: Date.now() - startTime,
        error: `Agent timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      emit({ type: 'message', text, agent });

      // Heuristic extraction of file-change events from stdout
      const fileMatches = text.matchAll(/(?:created|edited|wrote|modified)\s+([a-zA-Z0-9_\-./]+)/gi);
      for (const m of fileMatches) {
        if (m[1] && !m[1].startsWith('http')) {
          changedFiles.add(m[1]);
          emit({ type: 'file-change', paths: [m[1]], agent });
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      emit({ type: 'stderr', text, agent });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      emit({ type: 'status', phase: ok ? 'completed' : 'failed', code, agent });

      resolve({
        ok,
        agent,
        status: ok ? 'completed' : 'failed',
        exitCode: code,
        text: stdout,
        stderr,
        changedFiles: Array.from(changedFiles),
        durationMs: Date.now() - startTime,
        error: ok ? null : stderr.trim() || `Agent exited with code ${code}`,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      emit({ type: 'status', phase: 'error', error: err.message, agent });
      resolve({
        ok: false,
        agent,
        status: 'error',
        text: stdout,
        changedFiles: Array.from(changedFiles),
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

/**
 * Executes a verification command in the target directory.
 */
function executeVerificationCheck(verifyCmd, cwd = process.cwd()) {
  const startTime = Date.now();
  try {
    const stdout = execSync(verifyCmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return {
      passed: true,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: '',
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      passed: false,
      exitCode: err.status ?? 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim() || err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Universal Verify-and-Repair Loop:
 * 1. Runs the agent task.
 * 2. Runs the verify command.
 * 3. If failed, feeds error back to agent for automatic repair (up to maxRepairs).
 * 4. If primary agent fails repeatedly, falls back to fallbackAgent if configured.
 */
async function runWithVerify(options = {}, onEvent = null) {
  const {
    agent = 'claude',
    fallbackAgent = null,
    prompt,
    cwd = process.cwd(),
    verifyCmd,
    maxRepairs = 3,
    permissions = 'yolo',
    mockRunner = null,
    mockVerifier = null,
  } = options;

  if (!verifyCmd) {
    throw new Error('A verifyCmd string is required for runWithVerify (e.g. "npm test").');
  }

  const emit = (event) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event);
      } catch {
        // Safe callback
      }
    }
  };

  let currentAgent = agent;
  let currentPrompt = prompt;
  let attempt = 0;
  const history = [];

  while (attempt <= maxRepairs) {
    attempt += 1;
    emit({
      type: 'repair-attempt-start',
      attempt,
      maxRepairs,
      agent: currentAgent,
      prompt: currentPrompt,
    });

    // 1. Run agent
    const agentResult = await runAgent(
      {
        agent: currentAgent,
        prompt: currentPrompt,
        cwd,
        permissions,
        mockRunner,
      },
      onEvent
    );

    if (!agentResult.ok && agentResult.status === 'blocked') {
      return {
        ok: false,
        status: 'blocked',
        agent: currentAgent,
        attempts: attempt,
        history: [{ attempt, agent: currentAgent, agentResult }],
        error: `ThumbGate pre-action diode blocked execution: ${agentResult.error}`,
      };
    }

    // 2. Run verification check
    emit({ type: 'verify-start', attempt, verifyCmd });
    const verifyResult = mockVerifier
      ? await mockVerifier({ attempt, agent: currentAgent, agentResult })
      : executeVerificationCheck(verifyCmd, cwd);

    history.push({
      attempt,
      agent: currentAgent,
      agentResult,
      verifyResult,
    });

    if (verifyResult.passed) {
      emit({ type: 'verify-passed', attempt, verifyCmd, durationMs: verifyResult.durationMs });
      return {
        ok: true,
        status: 'verified',
        agent: currentAgent,
        attempts: attempt,
        history,
        finalVerification: verifyResult,
        lastAgentResult: agentResult,
      };
    }

    emit({
      type: 'verify-failed',
      attempt,
      verifyCmd,
      stderr: verifyResult.stderr,
      stdout: verifyResult.stdout,
    });

    // If out of attempts on primary agent and fallbackAgent is available, switch agent!
    if (attempt >= 2 && fallbackAgent && currentAgent !== fallbackAgent) {
      emit({
        type: 'agent-fallback',
        fromAgent: currentAgent,
        toAgent: fallbackAgent,
        reason: `Primary agent ${currentAgent} failed verification after ${attempt} attempts. Escalating to ${fallbackAgent}.`,
      });
      currentAgent = fallbackAgent;
    }

    // Build repair prompt for next attempt
    const errorDetails = (verifyResult.stderr || verifyResult.stdout || 'Verification command failed with exit code ' + verifyResult.exitCode).slice(0, 4000);
    currentPrompt = `Your previous implementation failed verification check '${verifyCmd}'.\n` +
      `Verification Error Output:\n\`\`\`\n${errorDetails}\n\`\`\`\n` +
      `Please inspect the codebase, fix the failing tests or syntax errors, and ensure the check passes.`;
  }

  return {
    ok: false,
    status: 'repair-exhausted',
    agent: currentAgent,
    attempts: attempt,
    history,
    error: `Failed to pass verification after ${maxRepairs} repair attempts.`,
  };
}

module.exports = {
  SUPPORTED_AGENTS,
  findExecutable,
  detectAgents,
  withoutProviderCredentials,
  evaluatePreActionSafety,
  buildAgentCommand,
  runAgent,
  executeVerificationCheck,
  runWithVerify,
};
