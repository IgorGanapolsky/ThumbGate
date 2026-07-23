# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest `main` / current npm `thumbgate` release | Yes |
| Older npm versions | Best-effort; upgrade recommended |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: **iganapolsky@gmail.com** (subject: `ThumbGate security`)

Include:

- Affected package/version or commit
- Reproduction steps / PoC (non-destructive preferred)
- Impact assessment
- Whether the issue is already public

You should receive an acknowledgment within a few business days. We will coordinate disclosure after a fix is available when possible.

## Scope

In scope:

- Remote code execution, auth bypass, secret leakage in the hosted API or npm package
- PreToolUse / gate bypass that allows catastrophic classes despite default deny
- XSS / injection on `thumbgate.ai` production surfaces

Out of scope:

- Issues that require already-compromised local machine root
- Social engineering of the maintainer
- Dependency CVEs already tracked by Dependabot with no practical exploit path in our usage

## Automated scanning

This repository enables:

- GitHub Code scanning (CodeQL)
- Dependabot alerts
- Secret scanning
