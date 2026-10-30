#!/bin/bash
# Claude Code UserPromptSubmit hook — auto-captures thumbs up/down feedback
# Triggered on every user message. Only acts on feedback signals.
# Shows full verbose output with storage paths, memory IDs, and stats.

PROMPT="$CLAUDE_USER_PROMPT"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAPTURE="$SCRIPT_DIR/../.claude/scripts/feedback/capture-feedback.js"
PROMPT_GUARD="$SCRIPT_DIR/prompt-guard.js"
ACTIVE_CWD="${CLAUDE_PROJECT_DIR:-${PWD:-$(pwd)}}"
FEEDBACK_DIR="$(node -e "const path = require('path'); const { resolveFeedbackDir } = require(path.join(process.argv[1], 'feedback-paths.js')); process.stdout.write(resolveFeedbackDir({ cwd: process.argv[2] || process.cwd(), feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR || undefined }));" "$SCRIPT_DIR" "$ACTIVE_CWD" 2>/dev/null)"
if [ -z "$FEEDBACK_DIR" ]; then
  FEEDBACK_DIR="${THUMBGATE_FEEDBACK_DIR:-$ACTIVE_CWD/.thumbgate}"
fi
FEEDBACK_LOG="$FEEDBACK_DIR/feedback-log.jsonl"
MEMORY_LOG="$FEEDBACK_DIR/memory-log.jsonl"

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

if [ -f "$PROMPT_GUARD" ]; then
  GUARD_RESULT=$(node "$PROMPT_GUARD" 2>/dev/null || true)
  if [ -n "$GUARD_RESULT" ]; then
    echo "$GUARD_RESULT"
    exit 0
  fi
fi

capture_and_report() {
  local SIGNAL="$1"
  local LESSON="$2"
  local -a EXTRA=()
  if [ -n "$LESSON" ]; then
    if [ "$SIGNAL" = "up" ]; then
      EXTRA+=(--what-worked="$LESSON")
    else
      EXTRA+=(--what-went-wrong="$LESSON" --what-to-change="$LESSON")
    fi
  fi

  # Capture feedback (verbose output already shows IDs, signal, storage).
  # The lesson is one line. The raw prompt stays in context and is not copied
  # into the lesson fields.
  node "$CAPTURE" --feedback="$SIGNAL" --context="$PROMPT" --tags="auto-capture,hook" "${EXTRA[@]}"
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
  echo "  LanceDB      : $FEEDBACK_DIR/lancedb/"
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

# A reaction is a short opener (thumbs up, 👍, bad, great, and the same
# family), optionally followed by one lesson line. A sentence that merely
# contains those words is a reply, not a rating. "fix this" is a work order.
DECISION="$(THUMBGATE_REACTION_PROMPT="$PROMPT" node -e '
const { detectFeedbackSignal, reactionLessonLine } = require(process.argv[1]);
const prompt = process.env.THUMBGATE_REACTION_PROMPT || "";
const detected = detectFeedbackSignal(prompt);
if (!detected) process.exit(0);
const lesson = reactionLessonLine(prompt) || "";
process.stdout.write(detected.signal + "\n" + lesson);
' "$SCRIPT_DIR/feedback-quality.js" 2>/dev/null || true)"

if [ -z "$DECISION" ]; then
  exit 0
fi

SIGNAL=$(printf '%s\n' "$DECISION" | head -n 1)
LESSON=$(printf '%s\n' "$DECISION" | tail -n +2)
capture_and_report "$SIGNAL" "$LESSON"
exit 0
