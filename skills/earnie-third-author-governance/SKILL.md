---
name: earnie-third-author-governance
description: >
  The Third Author Governance (SCANOSS Earnie FORMAT Steal). Enforces One Policy across
  Three Checkpoints (MCP PreToolUse, Git Pre-Commit, PR Merge Gate) and Four Risks
  (AI Models/AIBOM, Cryptography/CBOM PQC, License Compliance/SBOM, Security Vulnerabilities).
  Blocks copyleft/AGPL dependencies in <0.5ms and suggests permissive MIT/Apache alternatives.
  Never vendor SCANOSS SaaS or call external knowledge bases.
---

# 🛡️ The Third Author Governance (SCANOSS Earnie Steal)

Your code got a third author:
1. **The Human Engineer** (accountable, peer-reviewed).
2. **Open Source** (packages, snippets, license obligations).
3. **AI Agents** (faster than review, never learned your policy).

Earnie by SCANOSS (October 2026) introduced the paradigm of **"One policy, three checkpoints"** and **"Four risks, one record"**. ThumbGate steals the architectural format and operationalizes it as an in-line, CPU-local, zero-token PreToolUse execution firewall.

---

## 🚦 One Policy, Three Checkpoints

1. **Checkpoint 1: MCP / PreToolUse Gate (<0.5ms on CPU)**
   - Intercepts proposed tool calls (`Bash`, `terminal`, `run_command`).
   - Blocks copyleft package installs (e.g. `fast-charts` [AGPL-3.0]) before execution.
   - Injects vetted, permissive alternatives (e.g. `chart.js` [MIT], `recharts` [MIT]) directly into the agent's context.
   - Blocks unpinned supply chain downloads (`curl ... | bash`).

2. **Checkpoint 2: Git Pre-Commit Hook**
   - Evaluates staged files against cryptography, licensing, and secret policies before commit.
   - Emits deterministic finding IDs (`TG-LIC-XXXX`, `TG-PQC-XXXX`).
   - Blocks commits on critical violations; developer runs `npx thumbgate explain <FINDING-ID>` to see evidence.

3. **Checkpoint 3: PR Gate / CI Evaluator**
   - Evaluates pull request diffs against organizational governance rulesets.
   - Emits definitive verdicts: `PASS`, `WARN`, `REQUIRE_APPROVAL`, `BLOCK`.

---

## 📦 Four Risks, One Record (The BOM Quadrant)

| Risk | Inventory / BOM | Check & Remediation |
| :--- | :--- | :--- |
| **1. AI Models** | **AIBOM** (CycloneDX ML-BOM) | Catalogs AI SDKs (`@anthropic-ai/sdk`, `openai`), local model weights (`.gguf`, `.safetensors`, `.onnx`), and vector databases. |
| **2. Cryptography & PQC** | **CBOM** (Crypto Bill of Materials) | Flags classical algorithms vulnerable to Shor's algorithm (RSA, classical ECC, DH) and broken hashes (MD5, SHA-1). Enforces NIST FIPS 203/204 Post-Quantum transition (ML-KEM, ML-DSA). |
| **3. License Compliance** | **SBOM & Notice** | Identifies viral copyleft (`AGPL-3.0`, `GPL-3.0`, `SSPL-1.0`). Auto-suggests approved MIT/Apache-2.0 alternatives. |
| **4. Security Vulnerabilities** | **VDB Diode** | Intercepts unpinned versions, `latest` tags, and untrusted pipe-to-bash scripts. |

---

## 🛠️ CLI Commands & Usage

```bash
# Run full Third Author audit across all 3 checkpoints and 4 risks
npx thumbgate third-author

# Run audit in machine-readable JSON
npx thumbgate third-author --json

# Inspect any finding with raw evidence and permissive alternatives
npx thumbgate explain <FINDING-ID>

# Run PreToolUse gate check manually
echo '{"tool_name": "bash", "tool_input": {"command": "npm i fast-charts@4.2.1"}}' | npx thumbgate gate-check
```

---

## 🚫 Hard Boundaries (Honesty & Compliance)

- **Never vendor SCANOSS SaaS:** Do not call `scanoss.com` APIs, install `scanoss-py`, or send code fingerprints over the network.
- **Local-First Ground Truth:** All evaluations run on CPU in `<0.5ms` using local pattern registries and AST detectors.
- **Fail Closed:** Any tool call attempting to introduce unvetted viral copyleft or broken classical cryptography into production is blocked before execution.
