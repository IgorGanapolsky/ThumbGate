# ThumbGate for the Claude Agent SDK

Your thumbs-down rules, the default gates and secret scrubbing, in an agent you build with the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). ThumbGate is not made by Anthropic.

## TypeScript / JavaScript

```bash
npm install thumbgate @anthropic-ai/claude-agent-sdk
```

```js
import { query } from '@anthropic-ai/claude-agent-sdk';
import { thumbgateHooks } from 'thumbgate/adapters/claude-agent-sdk/index.js';

for await (const message of query({
  prompt: 'Clean up the build folder',
  options: { hooks: thumbgateHooks() },
})) console.log(message);
```

## Python

Copy [`thumbgate_agent_sdk.py`](./thumbgate_agent_sdk.py) into your project. It needs Node 18+ on PATH.

```python
from claude_agent_sdk import ClaudeAgentOptions
from thumbgate_agent_sdk import thumbgate_hooks

options = ClaudeAgentOptions(hooks=thumbgate_hooks())
```

## What each hook does

| Hook | What it does |
| --- | --- |
| `PreToolUse` | The same check as the Claude Code hook: learned rules, default gates, hard floor. A deny stops the call. |
| `PostToolUse` | Replaces secrets in the tool output with `[REDACTED:<kind>]` (`updatedToolOutput`). Flags text that reads like instructions to the model, such as "ignore previous instructions" in a fetched page, with `additionalContext`. |

Options: `thumbgateHooks({ matcher: 'Bash|Write', injection: 'warn' | 'strip' | 'off', secrets: true, post: true })`.
Python takes the same names: `thumbgate_hooks(matcher=None, injection="warn", secrets=True, post=True)`.

## Limits

- PostToolUse runs after the tool. Scrubbing changes what the model reads; the command already ran, and
  OpenTelemetry spans still hold the original output.
- Injection detection is a short list of phrases. It warns by default because it can be wrong both ways.
- For built-in tools the SDK ignores a replacement that does not match the tool's output shape. The hook keeps the
  shape and only changes strings inside it.
- A ThumbGate crash lets the call through, like the CLI hook. Set `THUMBGATE_SDK_FAIL_CLOSED=1` to deny instead.
