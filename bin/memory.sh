#!/bin/bash
# bin/memory.sh - Layer 3 & 4 & 5 Memory Stack Refresher

PRIMER_FILE="primer.md"

if [ ! -f "$PRIMER_FILE" ]; then
  echo "Error: $PRIMER_FILE not found."
  exit 1
fi

echo "🤖 [Memory Stack] Refreshing context..."

# 1. Behavioral Extraction (Layer 4)
node scripts/behavioral-extraction.js > /dev/null
TRAITS_FILE="$(node -e "const path = require('path'); const { resolveFeedbackDir } = require('./scripts/feedback-paths'); process.stdout.write(path.join(resolveFeedbackDir(), 'behavioral-traits.json'));" 2>/dev/null)"
if [ -z "$TRAITS_FILE" ]; then
  TRAITS_FILE=".thumbgate/behavioral-traits.json"
fi

# 2. Capture git context (Layer 3)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
LAST_COMMITS=$(git log -n 5 --oneline 2>/dev/null || echo "No commits found")
DIRTY_FILES=$(git status --short 2>/dev/null || echo "")

# 3. Rebuild Primer
TEMP_FILE=$(mktemp)

# Read primer until "## Behavioral Traits"
sed -n '1,/## Behavioral Traits/p' "$PRIMER_FILE" > "$TEMP_FILE"
echo "" >> "$TEMP_FILE"

if [ -f "$TRAITS_FILE" ]; then
  # Extract trait descriptions from JSON
  cat "$TRAITS_FILE" | grep "description" | sed 's/.*: "//;s/".*//' | sed 's/^/- /' >> "$TEMP_FILE"
else
  echo "_No strong behavioral patterns identified yet._" >> "$TEMP_FILE"
fi

echo "" >> "$TEMP_FILE"
echo "## Live Git Context" >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"
echo "### Branch: $CURRENT_BRANCH" >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"
echo "### Last 5 Commits:" >> "$TEMP_FILE"
echo '```' >> "$TEMP_FILE"
echo "$LAST_COMMITS" >> "$TEMP_FILE"
echo '```' >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"
echo "### Modified Files:" >> "$TEMP_FILE"
if [ -z "$DIRTY_FILES" ]; then
  echo "_None (Clean working tree)_" >> "$TEMP_FILE"
else
  echo '```' >> "$TEMP_FILE"
  echo "$DIRTY_FILES" >> "$TEMP_FILE"
  echo '```' >> "$TEMP_FILE"
fi

mv "$TEMP_FILE" "$PRIMER_FILE"

# 4. Sync to Obsidian (Layer 5)
chmod +x bin/obsidian-sync.sh
./bin/obsidian-sync.sh

echo "✅ Context refresh complete."
