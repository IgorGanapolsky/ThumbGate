'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'deterministic-appsec-guard.json');

const SECRET_PATTERNS = [
  { name: 'AWS_ACCESS_KEY', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'OPENAI_API_KEY', regex: /sk-[a-zA-Z0-9]{32,}/ },
  { name: 'GITHUB_TOKEN', regex: /ghp_[a-zA-Z0-9]{36}/ },
  { name: 'JWT_TOKEN', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { name: 'PRIVATE_KEY_BLOCK', regex: /-----BEGIN (RSA|EC|DSA|OPENSSH|PRIVATE) KEY-----/ },
  { name: 'STRIPE_SECRET_KEY', regex: /sk_(live|test)_[0-9a-zA-Z]{24,}/ },
];

const SSRF_TARGETS = [
  /169\.254\.169\.254/,
  /127\.0\.0\.1/,
  /localhost/i,
  /0\.0\.0\.0/,
  /10\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  /192\.168\.\d{1,3}\.\d{1,3}/,
  /172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}/,
];

function loadAppSecConfig(customPath) {
  const filePath = customPath || DEFAULT_CONFIG_PATH;
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_ignored) {
    // fallback
  }
  return {
    gateId: 'gate_deterministic_appsec_guard_2026',
    name: 'Deterministic AppSec 10-Point Preflight Guard',
    enforcementMode: 'fail_closed',
  };
}

function evaluateDeterministicAppSec(codeOrPayload, options = {}) {
  const code = typeof codeOrPayload === 'string' ? codeOrPayload : JSON.stringify(codeOrPayload || '');
  const violations = [];

  // Check 1: Unauthenticated Endpoint Exposure
  if (/(app|router)\.(get|post|put|delete|patch)\s*\(\s*[`"']\/(admin|internal|settings|billing|metrics)[^`"']*[`"']\s*,\s*(async\s*)?\([^)]*\)\s*=>/i.test(code) &&
      !/(requireAuth|authenticate|verifyToken|checkSession|passport|authMiddleware)/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_01_UNAUTH_ENDPOINT',
      severity: 'CRITICAL',
      message: 'Privileged route declared without explicit authentication middleware.',
      remediation: 'Inject verified auth middleware before route handler.',
    });
  }

  // Check 2: Hardcoded Credential & Key Leak
  for (const secret of SECRET_PATTERNS) {
    if (secret.regex.test(code)) {
      violations.push({
        ruleId: 'APPSEC_02_HARDCODED_SECRETS',
        severity: 'CRITICAL',
        message: `Hardcoded secret detected matching signature ${secret.name}.`,
        remediation: 'Extract credential to environment variables or secret vault.',
      });
      break;
    }
  }

  // Check 3: Permissive CORS Wildcard with Credentials
  if (/origin\s*:\s*[`"']\*[`"']/i.test(code) && /credentials\s*:\s*true/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_03_PERMISSIVE_CORS',
      severity: 'HIGH',
      message: 'Wildcard CORS origin paired with credentials: true creates CSRF / credential leakage vulnerability.',
      remediation: 'Pin explicit domain whitelist for CORS origin when credentials are enabled.',
    });
  }

  // Check 4: SSRF Egress to Private / Cloud Metadata
  for (const target of SSRF_TARGETS) {
    if (target.test(code) && /(fetch|axios|request|http\.get|https\.get|got)/i.test(code)) {
      violations.push({
        ruleId: 'APPSEC_04_SSRF_EGRESS',
        severity: 'CRITICAL',
        message: 'Outbound HTTP egress targeting private subnet or cloud metadata endpoint (SSRF vulnerability).',
        remediation: 'Enforce egress IP allowlist and block RFC 1918 / link-local metadata addresses.',
      });
      break;
    }
  }

  // Check 5: Dynamic SQL / Command Injection
  if (/(query|execute|raw|exec|execSync|spawn)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/i.test(code) ||
      /(query|execute|raw|exec|execSync|spawn)\s*\(\s*[`"'][^`"']*[`"']\s*\+/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_05_DYNAMIC_INJECTION',
      severity: 'CRITICAL',
      message: 'Unparameterized dynamic template literal or concatenation in database query / shell execution creates injection vulnerability.',
      remediation: 'Use parameterized queries ($1, ? placeholder) or execFile with structured arguments array.',
    });
  }

  // Check 6: Path Traversal
  if (/(\.\.\/|\.\.\\)/.test(code) && /(readFile|writeFile|createReadStream|createWriteStream|unlink|stat)/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_06_PATH_TRAVERSAL',
      severity: 'HIGH',
      message: 'Unsanitized relative path traversal sequence (../) in file system call.',
      remediation: 'Use path.resolve and assert target path resides within trusted base directory.',
    });
  }

  // Check 7: Telemetry & Log PII/Credential Leak
  if (/console\.(log|error|warn|info)\s*\(.*(req\.headers|authorization|password|credit_card|secret_token).*\)/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_07_TELEMETRY_PII_LEAK',
      severity: 'HIGH',
      message: 'Structured logger emitting raw authentication headers, passwords, or PII.',
      remediation: 'Redact sensitive keys through safe logging sanitizer before output.',
    });
  }

  // Check 8: Multi-Tenant IDOR Missing Tenant Scope
  if (/(FROM\s+(accounts|users|billing_records|orders|subscriptions)|SELECT\s+.*FROM\s+[a-z_]+_data)/i.test(code) &&
      !/(WHERE\s+.*tenant_id|org_id|account_id|user_id)/i.test(code) &&
      /(WHERE|LIMIT)/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_08_TENANT_IDOR',
      severity: 'CRITICAL',
      message: 'Multi-tenant entity query lacks explicit tenant_id / org_id boundary filter.',
      remediation: 'Enforce mandatory tenant_id = $tenantId filter on all tenant-isolated tables.',
    });
  }

  // Check 9: Unrestricted Web-Executable File Upload
  if (/(upload|saveFile|destination).*\.(exe|sh|php|py|bat|jsp)/i.test(code) && /(public|static|www|dist)/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_09_EXECUTABLE_UPLOAD',
      severity: 'HIGH',
      message: 'Executable script or binary upload configured targeting public web asset directory.',
      remediation: 'Store user uploads in private object storage with un-executable MIME boundaries.',
    });
  }

  // Check 10: Insecure Deserialization & Eval
  if (/(eval\s*\(|vm\.runInContext|vm\.runInNewContext|new\s+Function\s*\()/i.test(code)) {
    violations.push({
      ruleId: 'APPSEC_10_INSECURE_DESERIALIZATION',
      severity: 'CRITICAL',
      message: 'Dynamic code execution via eval/vm/Function creates arbitrary code execution risk.',
      remediation: 'Replace dynamic code execution with deterministic AST parsers or safe JSON serializers.',
    });
  }

  return {
    passed: violations.length === 0,
    decision: violations.length === 0 ? 'PASSED' : 'BLOCKED',
    violationCount: violations.length,
    violations,
    checkedRules: 10,
    framework: '10-Point Deterministic AppSec Preflight (Ralph Villanueva / Carnival AppSec Model)',
    timestamp: new Date().toISOString(),
  };
}

function explainAppSecViolation(violationCode) {
  const explanations = {
    APPSEC_01_UNAUTH_ENDPOINT: {
      title: 'Unauthenticated Route Exposure',
      rootCause: 'An endpoint handling internal or administrative logic was registered without an authentication middleware chain.',
      fix: 'Add router.use(verifyAuthToken) or pass the auth guard directly to the route definition.',
    },
    APPSEC_02_HARDCODED_SECRETS: {
      title: 'Hardcoded Credential Leak',
      rootCause: 'High-entropy secrets or private tokens were hardcoded into plaintext code files.',
      fix: 'Replace inline credentials with process.env references and load via secure secret manager.',
    },
    APPSEC_03_PERMISSIVE_CORS: {
      title: 'Permissive CORS with Credentials',
      rootCause: 'Access-Control-Allow-Origin: * was enabled alongside credentials: true, exposing user sessions to cross-origin exfiltration.',
      fix: 'Specify trusted domain whitelist instead of wildcard *.',
    },
    APPSEC_04_SSRF_EGRESS: {
      title: 'SSRF Egress to Private Network',
      rootCause: 'Outbound network request accepts user-controlled URLs resolving to private subnets or cloud metadata services (169.254.169.254).',
      fix: 'Validate target host against public IP ranges and block loopback/metadata IP resolutions.',
    },
    APPSEC_05_DYNAMIC_INJECTION: {
      title: 'SQL / Command Injection',
      rootCause: 'User parameters are interpolated directly into SQL statements or shell commands via template strings.',
      fix: 'Use parameterized queries or array-based argument passing in child_process.execFile.',
    },
    APPSEC_06_PATH_TRAVERSAL: {
      title: 'Arbitrary Path Traversal',
      rootCause: 'Path parameters containing ../ are concatenated without boundary verification, enabling file access outside the working root.',
      fix: 'Validate resolved path begins with safe base root: resolvedPath.startsWith(baseDir).',
    },
    APPSEC_07_TELEMETRY_PII_LEAK: {
      title: 'Telemetry PII & Credential Leak',
      rootCause: 'Sensitive authentication tokens, cookies, or personal data are dumped directly to stdout or logging drains.',
      fix: 'Implement redaction mask for sensitive field names before emitting logs.',
    },
    APPSEC_08_TENANT_IDOR: {
      title: 'Multi-Tenant IDOR Filter Missing',
      rootCause: 'Database queries retrieve records without restricting results by the authenticated tenant ID.',
      fix: 'Add WHERE tenant_id = :tenantId predicate to every query accessing multi-tenant data.',
    },
    APPSEC_09_EXECUTABLE_UPLOAD: {
      title: 'Executable File Upload to Web Root',
      rootCause: 'Uploaded files with executable extensions are written into web-accessible public asset folders.',
      fix: 'Sanitize filenames, strip executable extensions, and save files to isolated object storage buckets.',
    },
    APPSEC_10_INSECURE_DESERIALIZATION: {
      title: 'Insecure Code Execution / Deserialization',
      rootCause: 'Dynamic execution functions (eval, vm.runInNewContext) execute arbitrary strings at runtime.',
      fix: 'Refactor dynamic logic into deterministic switch statements and standard JSON parsers.',
    },
  };

  return explanations[violationCode] || {
    title: 'Unknown AppSec Violation',
    rootCause: 'An unspecified security invariant was violated.',
    fix: 'Review code against AppSec compliance standards.',
  };
}

function mainCli(argv = process.argv.slice(2)) {
  const args = argv;
  if (args.includes('--help') || args.length === 0) {
    console.log('ThumbGate Deterministic AppSec 10-Point Preflight Guard');
    console.log('Usage: node scripts/deterministic-appsec-guard.js [options]');
    console.log('  --scan-file=<path>        Scan a specific file against 10 AppSec rules');
    console.log('  --explain=<ruleId>        Explain violation cause and remediation (e.g. APPSEC_04_SSRF_EGRESS)');
    console.log('  --test-sample             Run verification check against safe and vulnerable samples');
    console.log('  --json                    Output in JSON format');
    return;
  }

  const jsonMode = args.includes('--json');
  const fileArg = args.find((a) => a.startsWith('--scan-file='))?.slice(12);
  const explainArg = args.find((a) => a.startsWith('--explain='))?.slice(10);

  if (explainArg) {
    const explanation = explainAppSecViolation(explainArg);
    if (jsonMode) console.log(JSON.stringify(explanation, null, 2));
    else console.log(`[${explainArg}] ${explanation.title}:\n  Cause: ${explanation.rootCause}\n  Fix:   ${explanation.fix}`);
    return;
  }

  if (fileArg) {
    if (!fs.existsSync(fileArg)) {
      console.error(`File not found: ${fileArg}`);
      process.exit(1);
    }
    const code = fs.readFileSync(fileArg, 'utf8');
    const result = evaluateDeterministicAppSec(code);
    if (jsonMode) console.log(JSON.stringify(result, null, 2));
    else console.log(`[AppSec-Guard] ${fileArg}: ${result.decision} (${result.violationCount} violations)`);
    return;
  }

  if (args.includes('--test-sample')) {
    const safeCode = "function getHealth() { return { status: 'ok' }; }";
    const vulnCode = "const key = 'AKIA1234567890ABCDEF'; fetch('http://169.254.169.254/latest/meta-data');";
    const safeResult = evaluateDeterministicAppSec(safeCode);
    const vulnResult = evaluateDeterministicAppSec(vulnCode);
    if (jsonMode) console.log(JSON.stringify({ safeResult, vulnResult }, null, 2));
    else {
      console.log(`Safe code sample: ${safeResult.decision}`);
      console.log(`Vulnerable code sample: ${vulnResult.decision} (${vulnResult.violationCount} violations caught)`);
    }
  }
}

if (require.main === module) {
  mainCli();
}

module.exports = {
  SECRET_PATTERNS,
  SSRF_TARGETS,
  loadAppSecConfig,
  evaluateDeterministicAppSec,
  explainAppSecViolation,
  mainCli,
};
