#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const BROWSER_TARGETS = Object.freeze({
  darwin: [
    browserTarget(
      'chrome',
      'Google Chrome',
      ['Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'],
      ['/Applications/Google Chrome.app', '~/Applications/Google Chrome.app']
    ),
    browserTarget(
      'edge',
      'Microsoft Edge',
      ['Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'],
      ['/Applications/Microsoft Edge.app', '~/Applications/Microsoft Edge.app']
    ),
    browserTarget(
      'brave',
      'Brave',
      ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'],
      ['/Applications/Brave Browser.app', '~/Applications/Brave Browser.app']
    ),
    browserTarget(
      'arc',
      'Arc',
      ['Library', 'Application Support', 'Arc', 'User Data', 'NativeMessagingHosts'],
      ['/Applications/Arc.app', '~/Applications/Arc.app']
    ),
    browserTarget(
      'chromium',
      'Chromium',
      ['Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'],
      ['/Applications/Chromium.app', '~/Applications/Chromium.app']
    ),
    browserTarget(
      'vivaldi',
      'Vivaldi',
      ['Library', 'Application Support', 'Vivaldi', 'NativeMessagingHosts'],
      ['/Applications/Vivaldi.app', '~/Applications/Vivaldi.app']
    ),
    browserTarget(
      'opera',
      'Opera',
      ['Library', 'Application Support', 'com.operasoftware.Opera', 'NativeMessagingHosts'],
      ['/Applications/Opera.app', '~/Applications/Opera.app']
    ),
  ],
  linux: [
    browserTarget(
      'chrome',
      'Google Chrome',
      ['.config', 'google-chrome', 'NativeMessagingHosts'],
      ['/usr/bin/google-chrome', '/opt/google/chrome/chrome']
    ),
    browserTarget(
      'edge',
      'Microsoft Edge',
      ['.config', 'microsoft-edge', 'NativeMessagingHosts'],
      ['/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge']
    ),
    browserTarget(
      'brave',
      'Brave',
      ['.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'],
      ['/usr/bin/brave-browser', '/opt/brave.com/brave/brave-browser']
    ),
    browserTarget(
      'chromium',
      'Chromium',
      ['.config', 'chromium', 'NativeMessagingHosts'],
      ['/usr/bin/chromium', '/usr/bin/chromium-browser']
    ),
    browserTarget(
      'vivaldi',
      'Vivaldi',
      ['.config', 'vivaldi', 'NativeMessagingHosts'],
      ['/usr/bin/vivaldi', '/opt/vivaldi/vivaldi']
    ),
    browserTarget(
      'opera',
      'Opera',
      ['.config', 'opera', 'NativeMessagingHosts'],
      ['/usr/bin/opera', '/usr/lib/x86_64-linux-gnu/opera/opera']
    ),
  ],
  win32: [],
});

const AI_VENDOR_PATTERNS = Object.freeze([
  { vendor: 'Anthropic', pattern: /\banthropic\b|\bclaude\b/i },
  { vendor: 'OpenAI', pattern: /\bopenai\b|\bcodex\b|\bchatgpt\b/i },
  { vendor: 'Google', pattern: /\bgoogle\b|\bgemini\b/i },
  { vendor: 'Cursor', pattern: /\bcursor\b/i },
  { vendor: 'Perplexity', pattern: /\bperplexity\b/i },
  { vendor: 'Browserbase', pattern: /\bbrowserbase\b|\bstagehand\b/i },
]);

function browserTarget(key, displayName, manifestDirParts, installHints) {
  return Object.freeze({ key, displayName, manifestDirParts, installHints });
}

function normalizePlatform(platform) {
  const normalized = String(platform || process.platform).toLowerCase();
  if (normalized === 'mac' || normalized === 'macos' || normalized === 'darwin') return 'darwin';
  if (normalized === 'linux') return 'linux';
  if (normalized === 'windows' || normalized === 'win32') return 'win32';
  return normalized;
}

function resolveInstallHint(hint, homeDir) {
  return hint.startsWith('~/')
    ? path.join(homeDir, hint.slice(2))
    : hint;
}

function getBrowserTargets(platform) {
  return BROWSER_TARGETS[normalizePlatform(platform)] || [];
}

function listJsonFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

function guessVendor(manifestPath, manifest) {
  const haystack = [
    manifestPath,
    manifest && manifest.name,
    manifest && manifest.description,
    manifest && manifest.path,
    ...(Array.isArray(manifest && manifest.allowed_origins) ? manifest.allowed_origins : []),
  ]
    .filter(Boolean)
    .join(' ');

  for (const candidate of AI_VENDOR_PATTERNS) {
    if (candidate.pattern.test(haystack)) {
      return candidate.vendor;
    }
  }

  return 'Unknown';
}

function isAiVendor(vendor) {
  return vendor !== 'Unknown';
}

function extractExtensionId(origin) {
  const match = String(origin || '').match(/^chrome-extension:\/\/([^/]+)/i);
  return match ? match[1] : null;
}

function readManifest(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return { raw, parsed, parseError: null };
  } catch (error) {
    return { raw, parsed: null, parseError: error.message };
  }
}

function guessBrowserInstalled(target, { platform, homeDir, explicitHomeDir }) {
  const normalizedPlatform = normalizePlatform(platform);
  if (normalizedPlatform !== 'darwin' && normalizedPlatform !== 'linux') {
    return null;
  }

  const installHints = Array.isArray(target.installHints) ? target.installHints : [];
  if (installHints.length === 0) return null;
  return installHints.some((hint) => {
    if (explicitHomeDir && !hint.startsWith('~/')) {
      return false;
    }
    return fs.existsSync(resolveInstallHint(hint, homeDir));
  });
}

function describeFinding(code, severity, message) {
  return { code, severity, message };
}

function analyzeManifestEntry(entry) {
  const findings = [];

  if (entry.parseError) {
    findings.push(describeFinding(
      'invalid_manifest_json',
      'high',
      'Manifest JSON is invalid, so the host registration cannot be reviewed safely.'
    ));
    return findings;
  }

  if (!entry.hostName) {
    findings.push(describeFinding(
      'missing_host_name',
      'medium',
      'Manifest is missing the required host name.'
    ));
  }

  if (!entry.hostPath) {
    findings.push(describeFinding(
      'missing_host_path',
      'high',
      'Manifest does not declare a host binary path.'
    ));
  } else if (!entry.hostPathExists) {
    findings.push(describeFinding(
      'missing_host_binary',
      'high',
      'Manifest points at a host binary that is not present on disk.'
    ));
  }

  if (entry.allowedOriginsCount > 0) {
    findings.push(describeFinding(
      'preauthorized_extension_bridge',
      'medium',
      `Manifest pre-authorizes ${entry.allowedOriginsCount} browser extension origin${entry.allowedOriginsCount === 1 ? '' : 's'}.`
    ));
  }

  if (entry.aiBridge) {
    findings.push(describeFinding(
      'ai_browser_bridge',
      'medium',
      `${entry.vendor} browser bridge detected through native messaging.`
    ));
  }

  if (entry.browserInstalledGuess === false) {
    findings.push(describeFinding(
      'browser_not_detected',
      'medium',
      `${entry.browser} is not detected in the usual install locations for this machine.`
    ));
  }

  if (entry.aiBridge && entry.allowedOriginsCount > 0 && entry.browserInstalledGuess === false) {
    findings.push(describeFinding(
      'dormant_ai_browser_bridge',
      'high',
      'An AI browser bridge is registered for a browser that is not detected locally, which expands future attack surface without an obvious active integration.'
    ));
  }

  return findings;
}

function shouldIncludeEntry(entry, options = {}) {
  if (options.aiOnly !== true) return true;
  return entry.aiBridge;
}

function collectNativeMessagingEntries(options = {}) {
  const platform = normalizePlatform(options.platform);
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const explicitHomeDir = typeof options.homeDir === 'string' && options.homeDir.trim().length > 0;
  const targets = getBrowserTargets(platform);
  const entries = [];

  if (platform === 'win32') {
    return {
      platform,
      homeDir,
      entries,
      notes: ['Windows native messaging is registry-based; this file audit focuses on macOS and Linux host manifests.'],
    };
  }

  for (const target of targets) {
    const manifestDir = path.join(homeDir, ...target.manifestDirParts);
    for (const manifestPath of listJsonFiles(manifestDir)) {
      const { parsed, parseError } = readManifest(manifestPath);
      const allowedOrigins = Array.isArray(parsed && parsed.allowed_origins)
        ? parsed.allowed_origins.filter((origin) => typeof origin === 'string' && origin.trim())
        : [];
      const extensionIds = allowedOrigins.map(extractExtensionId).filter(Boolean);
      const hostPath = parsed && typeof parsed.path === 'string' ? parsed.path : null;
      const vendor = guessVendor(manifestPath, parsed);
      const entry = {
        browser: target.displayName,
        browserKey: target.key,
        manifestPath,
        manifestDir,
        hostName: parsed && typeof parsed.name === 'string' ? parsed.name : null,
        hostPath,
        hostPathExists: hostPath ? fs.existsSync(hostPath) : false,
        allowedOrigins,
        allowedOriginsCount: allowedOrigins.length,
        extensionIds,
        vendor,
        aiBridge: isAiVendor(vendor),
        browserInstalledGuess: guessBrowserInstalled(target, { platform, homeDir, explicitHomeDir }),
        parseError,
      };
      entry.findings = analyzeManifestEntry(entry);
      if (shouldIncludeEntry(entry, options)) {
        entries.push(entry);
      }
    }
  }

  return { platform, homeDir, entries, notes: [] };
}

function summarizeFindings(entries) {
  return entries.flatMap((entry) => entry.findings.map((finding) => ({
    browser: entry.browser,
    manifestPath: entry.manifestPath,
    hostName: entry.hostName,
    vendor: entry.vendor,
    ...finding,
  })));
}

function buildRecommendations(findings, options = {}) {
  const recommendations = [
    'Review every native messaging host that grants browser automation or extension bridge access before allowing high-risk tasks.',
    'Prefer ask-before-acting modes for browser-use agents until connector scope, extension permissions, and revocation steps are explicit.',
    'Use ThumbGate to gate new connector installs and require explicit approval before cross-app integrations become part of the workflow.',
  ];

  if (findings.some((finding) => finding.code === 'dormant_ai_browser_bridge')) {
    recommendations.unshift('Remove or disable AI browser bridge manifests for browsers you did not intentionally integrate, then re-enable only after explicit approval.');
  }

  if (findings.some((finding) => finding.code === 'missing_host_binary')) {
    recommendations.push('Clean up broken host registrations so browsers do not keep stale native messaging entries that point at missing binaries.');
  }

  if (options.aiOnly === true) {
    recommendations.push('Re-run the full audit without --ai-only when you need a complete inventory of non-AI browser bridge registrations.');
  }

  return recommendations;
}

function buildNativeMessagingAudit(options = {}) {
  const collected = collectNativeMessagingEntries(options);
  const findings = summarizeFindings(collected.entries);
  const highSeverityCount = findings.filter((finding) => finding.severity === 'high').length;
  const mediumSeverityCount = findings.filter((finding) => finding.severity === 'medium').length;
  const browsersCovered = [...new Set(collected.entries.map((entry) => entry.browser))];
  const aiBridgeCount = collected.entries.filter((entry) => entry.aiBridge).length;

  let status = 'clear';
  if (highSeverityCount > 0) {
    status = 'review';
  } else if (mediumSeverityCount > 0) {
    status = 'watch';
  }

  return {
    name: 'thumbgate-native-messaging-audit',
    generatedAt: new Date().toISOString(),
    platform: collected.platform,
    homeDir: collected.homeDir,
    status,
    summary: {
      manifestCount: collected.entries.length,
      browsersCovered: browsersCovered.length,
      aiBridgeCount,
      highSeverityCount,
      mediumSeverityCount,
    },
    notes: collected.notes,
    manifests: collected.entries,
    findings,
    recommendations: buildRecommendations(findings, options),
  };
}

function formatNativeMessagingAudit(report) {
  const lines = [];
  lines.push('ThumbGate Native Messaging Audit');
  lines.push(`Status : ${report.status}`);
  lines.push(`Hosts  : ${report.summary.manifestCount} manifest${report.summary.manifestCount === 1 ? '' : 's'} across ${report.summary.browsersCovered} browser${report.summary.browsersCovered === 1 ? '' : 's'}`);
  lines.push(`AI     : ${report.summary.aiBridgeCount} AI browser bridge${report.summary.aiBridgeCount === 1 ? '' : 's'}`);
  if (report.notes.length > 0) {
    lines.push('');
    for (const note of report.notes) {
      lines.push(`Note   : ${note}`);
    }
  }

  if (report.findings.length > 0) {
    lines.push('');
    lines.push('Findings:');
    for (const finding of report.findings) {
      lines.push(`  - [${finding.severity}] ${finding.browser}: ${finding.message}`);
    }
  }

  if (report.manifests.length > 0) {
    lines.push('');
    lines.push('Registered manifests:');
    for (const entry of report.manifests) {
      lines.push(`  - ${entry.browser} -> ${entry.hostName || path.basename(entry.manifestPath)}`);
      lines.push(`    manifest: ${entry.manifestPath}`);
      if (entry.hostPath) {
        lines.push(`    host: ${entry.hostPath}${entry.hostPathExists ? '' : ' (missing)'}`);
      }
      if (entry.allowedOriginsCount > 0) {
        lines.push(`    allowed origins: ${entry.allowedOriginsCount}`);
      }
    }
  }

  lines.push('');
  lines.push('Recommendations:');
  for (const recommendation of report.recommendations) {
    lines.push(`  - ${recommendation}`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey;
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
      continue;
    }
    args[key] = true;
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = buildNativeMessagingAudit({
    homeDir: args['home-dir'],
    platform: args.platform,
    aiOnly: args['ai-only'] === true,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatNativeMessagingAudit(report));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  AI_VENDOR_PATTERNS,
  BROWSER_TARGETS,
  buildNativeMessagingAudit,
  collectNativeMessagingEntries,
  formatNativeMessagingAudit,
  getBrowserTargets,
  guessVendor,
  normalizePlatform,
};
