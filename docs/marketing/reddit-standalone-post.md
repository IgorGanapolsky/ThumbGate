# [Showcase] Stop AI Agents from mass-deleting data: Semantic Firewall for MCP

I built Pre-Action Checks for MCP servers (Cursor, Claude Code, etc.) that block dangerous tool calls before they fire.

The core issue with agents today is **repetition of known failures**. You thumbs-down a force-push once, and the agent does it again 10 minutes later. 

**thumbgate** solves this by:
1. Capturing thumbs-up/down signals programmatically.
2. Converting failures into "Semantic Firewall Rules" (prevention rules).
3. Using Bayesian uncertainty estimation to block actions when the agent is "hallucinating" confidence.

Try free for 7 days (card required, no charge today): https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_standalone_post

Source code (MIT licensed, free OSS): https://github.com/IgorGanapolsky/ThumbGate

Would love to hear how you're handling agent reliability right now.
