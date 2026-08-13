#!/usr/bin/env bash
# Re-sync system-wide Gurobi (gurobipy free pip / Fabrizio Ellis path).
# Installs ~/.hermes/gurobi-venv, CLI wrappers, MCP entry, shell env, eval proof.
set -euo pipefail

INSTALL="${HOME}/.hermes/gurobi/install.sh"
if [ ! -x "$INSTALL" ]; then
  echo "Missing $INSTALL — seed from session install or gurobi_fleet_lib layout." >&2
  echo "Creating minimal installer..." >&2
  mkdir -p "${HOME}/.hermes/gurobi/bin" "${HOME}/.hermes/gurobi/evals"
  # Prefer already-present install.sh content; otherwise fail with guidance.
  if [ -f "${HOME}/.hermes/gurobi/gurobi-fleet-optimize.py" ]; then
    cat > "$INSTALL" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
GUROBI_HOME="${HOME}/.hermes/gurobi"
GUROBI_VENV="${HOME}/.hermes/gurobi-venv"
[ -x "$GUROBI_VENV/bin/python" ] || python3 -m venv "$GUROBI_VENV"
"$GUROBI_VENV/bin/pip" install -q --upgrade pip 'gurobipy>=13'
export PYTHONPATH="$GUROBI_HOME${PYTHONPATH:+:$PYTHONPATH}"
"$GUROBI_VENV/bin/python" "$GUROBI_HOME/gurobi-fleet-optimize.py" evaluate --json \
  | tee "$GUROBI_HOME/evals/latest.json" >/dev/null
echo "EVAL_OK"
EOF
    chmod +x "$INSTALL"
  else
    echo "Fleet library not found under ~/.hermes/gurobi — restore gurobi_fleet_lib.py first." >&2
    exit 1
  fi
fi

bash "$INSTALL"

# Register MCP for agent hosts that read ~/.mcp.json
python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / '.mcp.json'
data = json.loads(p.read_text()) if p.exists() else {}
servers = data.setdefault('mcpServers', {})
servers['gurobi'] = {
    'command': str(Path.home() / '.hermes/gurobi/bin/gurobi-mcp'),
    'args': [],
    'env': {'PYTHONPATH': str(Path.home() / '.hermes/gurobi')},
}
p.write_text(json.dumps(data, indent=2) + '\n')
print('mcp: gurobi registered in', p)
PY

echo "ThumbGate product bridge: scripts/gurobi-optimizer.js (PYTHON via GUROBI_PYTHON)"
echo "Proof: cat ~/.hermes/gurobi/evals/latest.json"
