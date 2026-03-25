# [Showcase] Stop AI Agents from mass-deleting data: Semantic Firewall for MCP

I built a Pre-Action Gates for MCP servers (Cursor, Claude Code, etc.) that blocks dangerous tool calls before they fire. 

The core issue with agents today is **repetition of known failures**. You thumbs-down a force-push once, and the agent does it again 10 minutes later. 

**mcp-memory-gateway** solves this by:
1. Capturing thumbs-up/down signals programmatically.
2. Converting failures into "Semantic Firewall Rules" (prevention rules).
3. Using Bayesian uncertainty estimation to block actions when the agent is "hallucinating" confidence.

Free OSS: https://github.com/IgorGanapolsky/thumbgate
Starter Pack (9 one-time): Includes 500 pre-calibrated consolidations so you don't start from zero.

Would love to hear how you're handling agent reliability right now.
