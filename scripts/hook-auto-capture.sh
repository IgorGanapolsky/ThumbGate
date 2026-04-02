#!/bin/bash
# Claude Code UserPromptSubmit hook — auto-captures thumbs up/down feedback
# Triggered on every user message. Only acts on feedback signals.
# Shows full verbose output with storage paths, memory IDs, and stats.

PROMPT="$CLAUDE_USER_PROMPT"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAPTURE="$SCRIPT_DIR/../.claude/scripts/feedback/capture-feedback.js"
PROMPT_GUARD="$SCRIPT_DIR/prompt-guard.js"
FEEDBACK_LOG="$SCRIPT_DIR/../.claude/memory/feedback/feedback-log.jsonl"
MEMORY_LOG="$SCRIPT_DIR/../.claude/memory/feedback/memory-log.jsonl"

# Record the latest user prompt so statusline thumbs can distill lessons
# from recent conversation even when the click itself has no body payload.
THUMBGATE_CONVERSATION_TEXT="$PROMPT" node -e "
  const { recordConversationEntry } = require(process.argv[1]);
  recordConversationEntry({
    author: 'user',
    text: process.env.THUMBGATE_CONVERSATION_TEXT || '',
    source: 'claude_user_prompt',
  });
" "$SCRIPT_DIR/feedback-history-distiller.js" 2>/dev/null || true

# Normalize to lowercase for matching
LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

if [ -f "$PROMPT_GUARD" ]; then
  GUARD_RESULT=$(node "$PROMPT_GUARD" 2>/dev/null || true)
  if [ -n "$GUARD_RESULT" ]; then
    echo "$GUARD_RESULT"
    exit 0
  fi
fi

capture_and_report() {
  local SIGNAL="$1"

  # Capture feedback (verbose output already shows IDs, signal, storage)
  node "$CAPTURE" --feedback="$SIGNAL" --context="$PROMPT" --tags="auto-capture,hook"
  local CAPTURE_STATUS=$?

  if [ "$CAPTURE_STATUS" -eq 2 ]; then
    echo "Reusable memory status: signal logged only. Add one specific sentence so the MCP can promote it."
    echo ""
  fi

  # Show storage proof
  echo ""
  echo "Storage Proof:"
  echo "  Feedback log : $FEEDBACK_LOG ($(wc -l < "$FEEDBACK_LOG" 2>/dev/null || echo 0) entries)"
  echo "  Memory log   : $MEMORY_LOG ($(wc -l < "$MEMORY_LOG" 2>/dev/null || echo 0) entries)"
  echo "  LanceDB      : $SCRIPT_DIR/../.claude/memory/feedback/lancedb/"
  echo ""

  # Show last entry written
  echo "Last Entry Written:"
  tail -1 "$FEEDBACK_LOG" 2>/dev/null | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log('  ID        :', d.id);
    console.log('  Signal    :', d.signal, '(' + d.actionType + ')');
    console.log('  Context   :', (d.context||'').slice(0,80));
    console.log('  Tags      :', (d.tags||[]).join(', '));
    console.log('  Timestamp :', d.timestamp);
    console.log('  Domain    :', (d.richContext||{}).domain || 'general');
  " 2>/dev/null

  # Show cumulative stats
  echo ""
  echo "Cumulative Stats:"
  node -e "
    const fs = require('fs');
    const lines = fs.readFileSync('$FEEDBACK_LOG','utf8').trim().split('\n').filter(Boolean);
    const entries = lines.map(l => { try { return JSON.parse(l); } catch(e) { return null; } }).filter(Boolean);
    const pos = entries.filter(e => e.signal === 'positive').length;
    const neg = entries.filter(e => e.signal === 'negative').length;
    const promoted = entries.filter(e => e.actionType === 'store-learning' || e.actionType === 'store-mistake').length;
    console.log('  Total feedback  :', entries.length);
    console.log('  Positive (up)   :', pos);
    console.log('  Negative (down) :', neg);
    console.log('  Promoted to mem :', promoted);
    console.log('  Ratio           :', pos > 0 ? (pos/(pos+neg)*100).toFixed(0) + '% positive' : 'n/a');
  " 2>/dev/null
}

# Check for thumbs up signals
if echo "$LOWER" | grep -qE '(thumbs? ?up|that worked|looks good|nice work|perfect|good job)'; then
  capture_and_report "up"
  exit 0
fi

# Check for thumbs down signals
if echo "$LOWER" | grep -qE '(thumbs? ?down|that failed|that was wrong|fix this)'; then
  capture_and_report "down"
  exit 0
fi
