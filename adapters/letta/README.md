# Letta Adapter

Letta is a stateful-agent runtime with persistent memory, MCP tools, custom server tools, and client-side tool execution. ThumbGate should not compete with that memory surface. ThumbGate should sit underneath it as the deterministic local enforcement layer.

## Integration Pattern

Use `thumbgate-letta-adapter.js` to wrap Letta tool execution:

1. Letta agent proposes a tool call.
2. The wrapper normalizes the Letta event into ThumbGate's provider-action schema.
3. Your app calls ThumbGate's local gate-check transport.
4. If ThumbGate blocks or requires approval, the tool executor is never called.
5. If allowed, the original Letta tool executes normally.

This works for the two practical Letta surfaces:

- **MCP tools**: Letta forwards the tool call through the Letta server to an MCP server. Wrap the forwarding boundary or expose the downstream tool through a ThumbGate-guarded MCP server.
- **Client tools**: Letta asks your client application to execute a tool locally. Wrap the client tool handler with `createLettaToolGuard`.

## Example

```js
const { createLettaToolGuard } = require('./thumbgate-letta-adapter');

const guardedTool = createLettaToolGuard({
  gateCheck: async (normalizedAction) => thumbgateGateCheck(normalizedAction),
  executeTool: async (lettaEvent) => runOriginalTool(lettaEvent),
});

await guardedTool({
  agentId: 'agent-123',
  clientTool: {
    name: 'shell',
    input: { command: 'git push --force origin main' },
  },
});
```

## Positioning

Letta helps agents remember and operate with state. ThumbGate helps teams decide what those agents are allowed to do next. The moat is adapter coverage: ThumbGate works under memory-first runtimes instead of asking buyers to replace them.
