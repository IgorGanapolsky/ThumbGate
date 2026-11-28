"""ThumbGate hooks for the Claude Agent SDK (Python).

    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    from thumbgate_agent_sdk import thumbgate_hooks

    options = ClaudeAgentOptions(hooks=thumbgate_hooks())

Copy this file into your project (it has no dependencies beyond the SDK). Each hook call runs ThumbGate's Node
bridge, so Node 18+ must be on PATH. By default it runs `npx --yes thumbgate sdk-bridge`; set THUMBGATE_SDK_BRIDGE to
a command (for example "node /path/to/node_modules/thumbgate/adapters/claude-agent-sdk/bridge.js") to skip npx.

PreToolUse runs the same gate check as the Claude Code hook. PostToolUse redacts secrets from tool output through
updatedToolOutput and flags instruction-like text (prompt injection) with additionalContext, or removes it with
injection="strip". The tool has already run by then: scrubbing changes only what the model sees.
"""

import asyncio
import json
import os
import shlex

try:  # Optional: HookMatcher only exists once the SDK is installed.
    from claude_agent_sdk import HookMatcher
except Exception:  # pragma: no cover
    HookMatcher = None

DEFAULT_BRIDGE = "npx --yes thumbgate sdk-bridge"


async def _bridge(event, hook_input, options=None, timeout=30):
    command = shlex.split(os.environ.get("THUMBGATE_SDK_BRIDGE", DEFAULT_BRIDGE))
    payload = json.dumps({"event": event, "input": hook_input, "options": options or {}}, default=str)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(payload.encode()), timeout)
        return json.loads(out.decode() or "{}")
    except Exception:
        if os.environ.get("THUMBGATE_SDK_FAIL_CLOSED") == "1" and event == "PreToolUse":
            return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                           "permissionDecisionReason": "ThumbGate check could not run"}}
        return {}


def thumbgate_hooks(matcher=None, injection="warn", secrets=True, post=True):
    """Return a hooks dict for ClaudeAgentOptions(hooks=...)."""
    options = {"injection": injection, "secrets": secrets}

    async def pre_tool_use(input_data, tool_use_id, context):
        return await _bridge("PreToolUse", input_data)

    async def post_tool_use(input_data, tool_use_id, context):
        return await _bridge("PostToolUse", input_data, options)

    def entry(fn):
        if HookMatcher is not None:
            return HookMatcher(matcher=matcher, hooks=[fn])
        return {"matcher": matcher, "hooks": [fn]}

    hooks = {"PreToolUse": [entry(pre_tool_use)]}
    if post:
        hooks["PostToolUse"] = [entry(post_tool_use)]
    return hooks
