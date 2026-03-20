#!/bin/bash
/**
 * obsidian-sync.sh
 * 
 * Layer 5: Obsidian Knowledge Bridge
 * Syncs the local memory logs and primer to an Obsidian vault for long-term storage and search.
 */

VAULT_PATH=$RLHF_OBSIDIAN_VAULT_PATH
PROJECT_NAME=$(basename $(pwd))
TARGET_DIR="$VAULT_PATH/AI-Memories/$PROJECT_NAME"

if [ -z "$VAULT_PATH" ]; then
  echo "🤖 [Layer 5] OBSIDIAN_VAULT_PATH not set. Skipping sync."
  exit 0
fi

echo "🤖 [Layer 5] Syncing memories to Obsidian vault: $TARGET_DIR"

mkdir -p "$TARGET_DIR"

# Sync markdown files
cp primer.md "$TARGET_DIR/Primer.md" 2>/dev/null
cp .rlhf/prevention-rules.md "$TARGET_DIR/Prevention Rules.md" 2>/dev/null
cp .claude/memory/feedback/prevention-rules.md "$TARGET_DIR/Prevention Rules (Legacy).md" 2>/dev/null

# Sync log as markdown for searchability
echo "# Memory Log" > "$TARGET_DIR/Memory Log.md"
echo "---" >> "$TARGET_DIR/Memory Log.md"
if [ -f ".rlhf/memory-log.jsonl" ]; then
  cat .rlhf/memory-log.jsonl >> "$TARGET_DIR/Memory Log.md"
elif [ -f ".claude/memory/feedback/memory-log.jsonl" ]; then
  cat .claude/memory/feedback/memory-log.jsonl >> "$TARGET_DIR/Memory Log.md"
fi

echo "✅ Sync complete."
