# Poolside Pool + ThumbGate

This adapter gives the Pool terminal agent a local ThumbGate MCP server for
retrieving prior failures, evaluating actions, and recording proof-backed
feedback. It uses Pool's documented `mcp_servers` settings shape and pins the
published ThumbGate version so unattended sessions do not drift.

## Install

Merge [`settings.yaml`](./settings.yaml) into
`~/.config/poolside/settings.yaml`, or run:

```bash
pool mcp add thumbgate -- npx --yes --package thumbgate@1.35.0 thumbgate serve
pool mcp get thumbgate
```

Keep Pool's native permissions, sandbox, tool allow/deny rules, and repository
boundaries enabled. Pool's lifecycle hooks are fail-open by design, so a hook
must not be described as a hard security boundary. MCP makes ThumbGate tools
available to Pool; the agent still has to call the gate before a consequential
action unless Pool adds a fail-closed pre-action contract.

## Governed workflow

1. Ask ThumbGate for relevant prior lessons before the first write or command.
2. Evaluate the pending action through safety, business, and client-SLA policy.
3. Use sidecar or simulation mode for new rules; compare `observedDecision`
   without blocking the host action.
4. Promote a rule to live mode only after deterministic replay passes.
5. Keep the action receipt, test output, and resulting Git SHA together.

This is an independent interoperability adapter. It does not imply a Poolside
partnership or endorsement.

## Upstream opportunity

The useful upstream change is a documented fail-closed pre-action hook mode
with explicit timeout behavior. Until that exists, ThumbGate MCP plus Pool's
native permissions is the honest integration boundary.

Pool settings reference: <https://poolsideai.gitbook.io/pool/settings-reference>
