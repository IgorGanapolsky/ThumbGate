# ThumbGate ↔ Open Policy Agent (OPA / Rego)

ThumbGate and [Open Policy Agent](https://www.openpolicyagent.org/) operate at **different layers of the same defense**, and they compose:

- **OPA** is the server-side, enterprise **policy-as-code** engine (Rego). It governs infrastructure, API/microservice authorization, and increasingly AI-agent gateways — centrally authored, evaluated outside the LLM, enforced everywhere.
- **ThumbGate** is the **local-first, dev-loop** enforcement point. It runs in the PreToolUse hook on the developer's machine and blocks dangerous coding-agent tool calls (`rm -rf`, force-push, secret writes, destructive SQL) *before* execution — zero config (`npx thumbgate init`), and it **learns** (a 👎 becomes an auto-promoted rule across every agent).

This page documents the interop: **ThumbGate's deterministic block gates export to Rego**, so a team can author/learn rules locally with ThumbGate and run the same intent inside their existing OPA stack.

## The generated policy

[`thumbgate-policy.rego`](./thumbgate-policy.rego) in this directory is generated from ThumbGate's shipped gate configs (`config/gates/*.json`). It is a real, loadable OPA policy:

```rego
package thumbgate.authz

default allow := false

allow if {
    count(deny) == 0
}

deny contains msg if {
    input.tool == "Bash"
    regex.match(`^(git\s+(add|commit|push|tag)|gh\s+pr\s+|...)`, input.command)
    msg := "User requested local-only work. Git writes ... are blocked."
}
```

**Input shape** (what your agent gateway feeds OPA):

```json
{ "tool": "Bash", "command": "rm -rf /" }
```

**Decision:** `allow` is `false` whenever any `deny` rule matches; the `deny` set carries the human-readable reasons.

### Try it

```bash
opa eval -d docs/integrations/thumbgate-policy.rego \
  -i <(echo '{"tool":"Bash","command":"git push --force origin main"}') \
  'data.thumbgate.authz'
```

## Honest limitation: RE2 vs PCRE

OPA's `regex.match` uses **RE2**, which does **not** support PCRE lookaround (`(?!`, `(?=`) or backreferences. Several ThumbGate gates use negative lookahead to carve out test/staging paths (e.g. `DROP\s+TABLE(?!.*test|.*staging)`). Those **cannot** be translated automatically without changing their meaning, so the generator emits them as `# TODO(manual)` comments rather than shipping subtly-wrong rules.

In the current export: **27 of 33 block gates** translate cleanly; **6** are flagged for manual translation (the lookahead-based DB/permission gates). The honest path for those is to rewrite them as a positive match plus a separate allow-list carve-out in Rego, by hand.

## What ThumbGate gives you that hand-written Rego does not

Rego is hand-authored, static policy — powerful, but you write and maintain every rule. ThumbGate adds the **learning loop**: a thumbs-down on a blocked action becomes a new rule automatically, tuned by outcomes, propagated across Claude Code, Cursor, Codex, Gemini, Amp, Cline, and OpenCode. Use ThumbGate as the **local on-ramp** where rules are discovered from real agent behavior, then export the deterministic ones to OPA for org-wide, server-side enforcement.

## Status

This is a v1 interop artifact (committed sample + generator). A shipped `thumbgate export --format=rego` CLI command is the planned follow-up once there is enterprise demand to maintain it.
