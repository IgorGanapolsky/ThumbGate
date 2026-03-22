#!/bin/bash
# Terminal demo scripts for @keshavsuki response reel
# Run each section separately while screen recording

echo "============================================"
echo "DEMO 1: Gate BLOCKS a force push attempt"
echo "============================================"
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | node scripts/gates-engine.js | python3 -m json.tool

echo ""
echo "============================================"
echo "DEMO 2: Gate BLOCKS rm -rf /"
echo "============================================"
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | node scripts/gates-engine.js | python3 -m json.tool

echo ""
echo "============================================"
echo "DEMO 3: Audit trail — enforcement proof"
echo "============================================"
npm run audit:stats 2>/dev/null

echo ""
echo "============================================"
echo "DEMO 4: Skill adherence rates"
echo "============================================"
node scripts/audit-trail.js --adherence

echo ""
echo "============================================"
echo "DEMO 5: One-command install"
echo "============================================"
echo "$ npx mcp-memory-gateway init --agent claude-code"
