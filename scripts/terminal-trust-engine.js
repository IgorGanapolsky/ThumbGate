'use strict';

/**
 * ThumbGate Terminal Trust & Exploit Path Analysis Engine
 *
 * Adopted from Dan Kornas & CodeRabbit Secure:
 * - "Giving AI access to your terminal is easy. Knowing which commands to trust is the harder part."
 * - Trace attack paths and exploit scenarios before executing agent-generated shell commands.
 * - Propose safe, least-privilege alternatives automatically.
 */

const TRUST_RULES = [
  {
    id: 'chmod_broad_permission',
    pattern: /chmod\s+(-[a-zA-Z0-9_-]+\s+)*(777|a\+rwx|u\+s)(\s|$)/i,
    trustLevel: 'BLOCKED',
    risk: 'CRITICAL',
    title: 'Insecure Broad File Permissions',
    exploitPath: 'Granting 777 or SUID to files or directories allows any local unprivileged process or compromised worker to read, modify, or execute arbitrary code.',
    suggestAlternative: (cmd) => cmd.replace(/(777|a\+rwx)/g, '755').replace(/chmod\s+u\+s/g, 'chmod 750'),
  },
  {
    id: 'pipe_to_bash_unverified',
    pattern: /(curl|wget)\s+[^|]+\|\s*(ba|z)?sh(\s|$)/i,
    trustLevel: 'SUSPICIOUS',
    risk: 'HIGH',
    title: 'Unverified Remote Script Execution',
    exploitPath: 'Piping arbitrary HTTP response directly into an execution shell allows Man-in-the-Middle or compromised external servers to gain instant Remote Code Execution (RCE).',
    suggestAlternative: () => 'Download script first, verify SHA256 checksum, then execute.',
  },
  {
    id: 'credential_exfiltration_exposure',
    pattern: /\b(cat|grep|awk|sed)\b.*(\.aws\/credentials|\.ssh\/id_rsa|\.env|id_ed25519)\b|printenv\b|export\s+[A-Z_]*KEY/i,
    trustLevel: 'BLOCKED',
    risk: 'CRITICAL',
    title: 'Sensitive Credential Exposure',
    exploitPath: 'Printing private SSH keys, AWS credentials, or .env files exposes master tokens in child stdout/stderr, which can be scraped by telemetry, logs, or LLM context providers.',
    suggestAlternative: () => 'Use ThumbGate credential isolation or source secrets into memory without printing.',
  },
  {
    id: 'system_root_mutation',
    pattern: /rm\s+-rf\s+(\/|\/\*|~\/|\$HOME)(\s|$)|mkfs\b|dd\s+if=\/dev\/zero\b/i,
    trustLevel: 'BLOCKED',
    risk: 'CRITICAL',
    title: 'Destructive Host Destruction',
    exploitPath: 'Executing recursive deletion on root or user home directory causes unrecoverable operating system or user workspace destruction.',
    suggestAlternative: () => 'Target specific scoped project build directories (e.g. rm -rf ./build or ./dist).',
  },
  {
    id: 'reverse_shell_network',
    pattern: /\bbash\s+-i\s+>&|\/dev\/tcp\/|\bnc\s+(-e|-c)\b/i,
    trustLevel: 'BLOCKED',
    risk: 'CRITICAL',
    title: 'Interactive Reverse Shell Detected',
    exploitPath: 'Spawning an interactive bash socket over TCP binds the host terminal to an external attacker IP for unmonitored command injection.',
    suggestAlternative: () => 'Use authenticated SSH tunnels or standard REST/RPC APIs.',
  },
  {
    id: 'cron_persistence',
    pattern: />>\s*\/etc\/(crontab|cron\.)|crontab\s+-[r|e]/i,
    trustLevel: 'SUSPICIOUS',
    risk: 'MEDIUM',
    title: 'System Cron Persistence Mutation',
    exploitPath: 'Modifying system cron files grants persistent background execution that survives reboot and escapes agent session bounds.',
    suggestAlternative: () => 'Use project-scoped task runners or explicit CI schedule workflows.',
  },
];

/**
 * Evaluates terminal command trustworthiness and returns detailed exploit path diagnosis.
 * @param {string} command
 */
function evaluateTerminalTrust(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return {
      command: '',
      trustLevel: 'TRUSTED',
      allowed: true,
      findings: [],
    };
  }

  const trimmed = command.trim();
  const matchedRules = [];

  for (const rule of TRUST_RULES) {
    if (rule.pattern.test(trimmed)) {
      matchedRules.push({
        id: rule.id,
        title: rule.title,
        trustLevel: rule.trustLevel,
        risk: rule.risk,
        exploitPath: rule.exploitPath,
        suggestedAlternative: rule.suggestAlternative(trimmed),
      });
    }
  }

  const hasBlocked = matchedRules.some(r => r.trustLevel === 'BLOCKED');
  const hasSuspicious = matchedRules.some(r => r.trustLevel === 'SUSPICIOUS');

  let trustLevel = 'TRUSTED';
  if (hasBlocked) trustLevel = 'BLOCKED';
  else if (hasSuspicious) trustLevel = 'SUSPICIOUS';

  return {
    command: trimmed,
    trustLevel,
    allowed: trustLevel === 'TRUSTED',
    requiresHumanReview: trustLevel !== 'TRUSTED',
    findingsCount: matchedRules.length,
    findings: matchedRules,
    primaryRecommendation: matchedRules.length > 0 ? matchedRules[0].suggestedAlternative : 'Command safe for standard execution.',
  };
}

module.exports = {
  TRUST_RULES,
  evaluateTerminalTrust,
};
