# Adapter Compatibility Proof

Generated: 2026-03-06T22:01:58.023Z

Passed: 21
Failed: 0

## Checks
- PASS api.healthz
- PASS api.auth.required
- PASS api.intents.catalog
- PASS api.intents.plan
- PASS api.capture_feedback
- PASS api.capture_feedback.rubric_gate
- PASS api.context.construct
- PASS api.context.evaluate
- PASS mcp.initialize
- PASS mcp.stdio.framed.initialize
- PASS mcp.stdio.ndjson.initialize
- PASS mcp.tools.list
- PASS mcp.tools.call.feedback_summary
- PASS mcp.tools.call.plan_intent
- PASS mcp.tools.call.capture_feedback.rubric_gate
- PASS mcp.policy.locked_profile_denies_write_tool
- PASS adapter.chatgpt.openapi.parity
- PASS adapter.gemini.declarations
- PASS adapter.files.present
- PASS subagent.profiles.valid
- PASS mcp.policy.profile_differentiation

