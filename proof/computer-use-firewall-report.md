# Computer-Use Action Firewall — Proof Report

## Feature Description

The Computer-Use Action Firewall gates browser, shell, file, and system actions from OpenAI's Responses API computer environment through ThumbGate's pre-action gate system. It normalizes raw actions into a gate-compatible schema, evaluates them against configurable policy presets, detects dangerous shell commands and secret leaks, and produces structured audit entries.

## Policy Preset Matrix

| Action | safe-readonly | dev-sandbox | human-approval-for-write |
|---|---|---|---|
| `browser.open` | ✅ allow | ✅ allow | ✅ allow |
| `browser.click` | ✅ allow | ✅ allow | ✅ allow |
| `browser.type` | ⚠️ approval | ✅ allow | ⚠️ approval |
| `shell.exec` | ❌ deny | ⚠️ approval | ⚠️ approval |
| `file.read` | ✅ allow | ✅ allow | ✅ allow |
| `file.write` | ❌ deny | ✅ allow | ⚠️ approval |
| `file.delete` | ❌ deny | ⚠️ approval | ⚠️ approval |
| `clipboard.read` | ✅ allow | ✅ allow | ✅ allow |
| `clipboard.write` | ⚠️ approval | ✅ allow | ⚠️ approval |
| `download` | ⚠️ approval | ✅ allow | ⚠️ approval |
| `upload` | ❌ deny | ❌ deny | ⚠️ approval |
| `message.send` | ❌ deny | ❌ deny | ⚠️ approval |

## Example Audit Entries

```json
{
  "timestamp": "2026-03-31T12:00:00.000Z",
  "actionType": "shell.exec",
  "target": "rm -rf /",
  "decision": "deny",
  "reason": "Dangerous shell pattern: rm\\s+-rf\\s+/",
  "preset": "dev-sandbox"
}
```

```json
{
  "timestamp": "2026-03-31T12:00:01.000Z",
  "actionType": "browser.open",
  "target": "https://docs.example.com",
  "decision": "allow",
  "reason": "Allowed by preset",
  "preset": "safe-readonly"
}
```

```json
{
  "timestamp": "2026-03-31T12:00:02.000Z",
  "actionType": "file.write",
  "target": "/tmp/config.env",
  "decision": "deny",
  "reason": "Secret pattern: (?i)(api[_-]?key|secret|token|password|credential|auth)\\s*[:=]",
  "preset": "dev-sandbox"
}
```

## Secret Detection Patterns Tested

| Pattern | Example Match |
|---|---|
| `(?i)(api[_-]?key\|secret\|token\|password\|credential\|auth)\s*[:=]` | `API_KEY=sk-1234...` |
| `(?i)bearer\s+[a-zA-Z0-9._-]+` | `Bearer eyJhbGci...` |
| `ghp_[a-zA-Z0-9]{36}` | `ghp_abc...xyz123` |
| `sk-[a-zA-Z0-9]{48}` | `sk-abcdef...` |

## Dangerous Shell Pattern Detection

| Pattern | Blocks |
|---|---|
| `rm\s+-rf\s+/` | Recursive delete from root |
| `rm\s+-rf\s+~` | Recursive delete home directory |
| `:()\{ :\|:& \};:` | Fork bomb |
| `dd\s+if=/dev/zero` | Disk overwrite |
| `mkfs\.` | Filesystem format |
| `curl.*\|.*sh` | Remote code execution via curl pipe |
| `wget.*\|.*bash` | Remote code execution via wget pipe |

## Test Evidence

```
TAP version 13
# Subtest: normalizeAction converts raw browser.open action correctly
ok 1 - normalizeAction converts raw browser.open action correctly
# Subtest: normalizeAction converts raw shell.exec action correctly
ok 2 - normalizeAction converts raw shell.exec action correctly
# Subtest: normalizeAction handles unknown action types (defaults to high risk)
ok 3 - normalizeAction handles unknown action types (defaults to high risk)
# Subtest: normalizeAction handles null/undefined input
ok 4 - normalizeAction handles null/undefined input
# Subtest: evaluateAction allows browser.open in safe-readonly preset
ok 5 - evaluateAction allows browser.open in safe-readonly preset
# Subtest: evaluateAction denies shell.exec in safe-readonly preset
ok 6 - evaluateAction denies shell.exec in safe-readonly preset
# Subtest: evaluateAction requires approval for browser.type in safe-readonly preset
ok 7 - evaluateAction requires approval for browser.type in safe-readonly preset
# Subtest: evaluateAction allows file.write in dev-sandbox preset
ok 8 - evaluateAction allows file.write in dev-sandbox preset
# Subtest: evaluateAction denies upload in dev-sandbox preset
ok 9 - evaluateAction denies upload in dev-sandbox preset
# Subtest: evaluateAction requires approval for shell.exec in dev-sandbox preset
ok 10 - evaluateAction requires approval for shell.exec in dev-sandbox preset
# Subtest: evaluateAction denies shell.exec matching dangerous pattern (rm -rf /)
ok 11 - evaluateAction denies shell.exec matching dangerous pattern (rm -rf /)
# Subtest: evaluateAction detects secret patterns in file.write content
ok 12 - evaluateAction detects secret patterns in file.write content
# Subtest: createAuditEntry includes all required fields
ok 13 - createAuditEntry includes all required fields
# Subtest: evaluateBatch returns correct decisions for mixed actions
ok 14 - evaluateBatch returns correct decisions for mixed actions
# Subtest: All presets are consistent (no action in both allow and deny)
ok 15 - All presets are consistent (no action in both allow and deny)
# Subtest: Config file presets match code PRESETS
ok 16 - Config file presets match code PRESETS
# Subtest: Custom rules override preset defaults
ok 17 - Custom rules override preset defaults
# Subtest: human-approval-for-write requires approval for all write actions
ok 18 - human-approval-for-write requires approval for all write actions
1..18
# tests 18
# pass 18
# fail 0
# duration_ms 50.038792
```
