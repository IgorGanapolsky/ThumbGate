#!/bin/bash

# obsidian-sync.sh
#
# Layer 5: Obsidian Knowledge Bridge
# Exports RLHF data as interlinked Obsidian markdown notes to a vault.

VAULT_PATH=$RLHF_OBSIDIAN_VAULT_PATH
PROJECT_NAME=$(basename "$(pwd)")

if [ -z "$VAULT_PATH" ]; then
  echo "🤖 [Layer 5] RLHF_OBSIDIAN_VAULT_PATH not set. Skipping sync."
  exit 0
fi

echo "🤖 [Layer 5] Exporting memories to Obsidian vault: $VAULT_PATH/AI-Memories/$PROJECT_NAME"

npx mcp-memory-gateway obsidian-export --vault-path="$VAULT_PATH" --output-dir="AI-Memories/$PROJECT_NAME"

echo "✅ Sync complete."
