#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env.paperbanana ]]; then
  # shellcheck source=/dev/null
  source .env.paperbanana
fi

if [[ ! -f .env ]]; then
  echo "Missing .env. Add GEMINI_API_KEY first."
  exit 1
fi

# shellcheck source=/dev/null
source .env

if [[ -z "${GOOGLE_API_KEY:-}" && -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY or GOOGLE_API_KEY is required in .env"
  exit 1
fi

# Prefer explicit GOOGLE_API_KEY since paperbanana/google-genai prioritizes it.
if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
  export GOOGLE_API_KEY="$GEMINI_API_KEY"
fi

PB_ESTIMATE_PER_DIAGRAM="${PB_ESTIMATE_PER_DIAGRAM:-0.80}"
PB_MAX_ITERATIONS="${PB_MAX_ITERATIONS:-1}"
PB_VLM_MODEL="${PB_VLM_MODEL:-gemini-2.5-flash}"
PB_IMAGE_MODEL="${PB_IMAGE_MODEL:-gemini-3-pro-image-preview}"

budget_check() {
  local estimate="$1"
  node -e '
    const { getBudgetStatus } = require("./scripts/budget-guard");
    const est = Number(process.argv[1]);
    const s = getBudgetStatus();
    const projected = s.totalUsd + est;
    if (projected > s.budgetUsd) {
      console.error(`Blocked: projected spend ${projected.toFixed(2)} exceeds budget ${s.budgetUsd.toFixed(2)} USD`);
      process.exit(3);
    }
  ' "$estimate"
}

mkdir -p docs/diagrams

cat > docs/diagrams/rlhf-architecture.txt <<'TXT'
The system starts when a user gives explicit thumbs up/down feedback. A capture layer enriches the signal with context and tags.
An action resolver maps the signal to store-learning, store-mistake, or no-action.
A schema validator enforces strict structure before memory promotion.
Valid records are stored in a local memory log categorized as error or learning.
An analytics layer computes quality trends and recurrence patterns.
A prevention-rule engine converts repeated mistakes into hard guardrails.
A DPO export layer pairs learning and error memories into prompt/chosen/rejected JSONL.
All channels (ChatGPT Actions, Claude MCP, Codex MCP, Gemini tools, Amp skills) route through one shared API and policy core.
TXT

cat > docs/diagrams/plugin-topology.txt <<'TXT'
Show a central RLHF Feedback API with five adapters around it.
Adapter 1: ChatGPT via GPT Actions OpenAPI.
Adapter 2: Claude via local MCP server and .mcp.json.
Adapter 3: Codex via MCP server config.toml.
Adapter 4: Gemini via function-calling tool declarations.
Adapter 5: Amp via skills template.
Include bidirectional arrows from each adapter to the API.
Under the API place three internal modules: schema validation, prevention rules, and DPO export.
Add a budget guard module enforcing a strict monthly cost cap of 10 USD.
TXT

budget_check "$PB_ESTIMATE_PER_DIAGRAM"
paperbanana generate \
  --input docs/diagrams/rlhf-architecture.txt \
  --caption "RLHF Feedback Loop architecture for AI coding agents with schema gate, memory store, prevention rules, and DPO export" \
  --vlm-provider gemini \
  --vlm-model "$PB_VLM_MODEL" \
  --image-provider google_imagen \
  --image-model "$PB_IMAGE_MODEL" \
  --iterations "$PB_MAX_ITERATIONS" \
  --output docs/diagrams/rlhf-architecture.png
node scripts/budget-guard.js --add="$PB_ESTIMATE_PER_DIAGRAM" --source=paperbanana --note="architecture-overview"

budget_check "$PB_ESTIMATE_PER_DIAGRAM"
paperbanana generate \
  --input docs/diagrams/plugin-topology.txt \
  --caption "Go-to-market plugin topology: ChatGPT Actions, Claude MCP, Codex MCP, Gemini function calling, and Amp skills through one RLHF API core" \
  --vlm-provider gemini \
  --vlm-model "$PB_VLM_MODEL" \
  --image-provider google_imagen \
  --image-model "$PB_IMAGE_MODEL" \
  --iterations "$PB_MAX_ITERATIONS" \
  --output docs/diagrams/plugin-topology.png
node scripts/budget-guard.js --add="$PB_ESTIMATE_PER_DIAGRAM" --source=paperbanana --note="plugin-topology"

echo "Generated diagrams:"
ls -la docs/diagrams/*.png
