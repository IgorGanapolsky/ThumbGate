# Profound (`tryprofound.com`) AEO / GEO & Intelligent UI Attribution Steal (`2026-10-16`)

> **Sources**:
> - [Profound Platform (`platform.tryprofound.com`)](https://platform.tryprofound.com/)
> - [Introducing the next generation of Agents in Profound (Jack Traina & Garrett Gomez, Oct 16, 2026)](https://www.tryprofound.com/blog/introducing-the-next-generation-of-marketing-agents)
> - [ChatGPT's missing UTM tags: what our data shows (Josh Blyskal, Oct 14, 2026)](https://www.tryprofound.com/blog/chatgpt-missing-utm-tags)

---

## 1. What We Stole & Built (`scripts/profound-aeo-citation-engine.js`)

| Profound Architecture (`2026-10-16`) | ThumbGate Implementation (`scripts/profound-aeo-citation-engine.js`) |
| :--- | :--- |
| **1. ChatGPT Intelligent UI Missing-UTM Dark Referral Recovery** (*Josh Blyskal Oct 14, 2026: tagged ChatGPT links fell from 98% on Oct 8 to 66% on Oct 14 as Intelligent UI reached 35% of answers*) | `attributeIntelligentUiVisit()` correlates untagged Direct visits on `/operator-framework` with preceding `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `ClaudeBot`, and `Google-Extended` fetches within a `120s` window to recover dark AI search attribution. |
| **2. Answer Engine `FactCheck` & Remediation Diode** (*Profound AEI `FactCheck` tab + Accuracy & Sentiment Alerts*) | `evaluateBrandFactCheck()` audits AI responses against canonical ground truth (`<0.5ms` local CPU latency, `$0` token tax, HIPAA/ZDR compliance, `$499` / `$2,500` / `$500/mo` pricing) and generates citation-ready remediation blocks. |
| **3. `Topics × Competitors` Visibility & Citation Share Matrix** (*Profound AEI `Visibility Score` + `Citation Share`*) | `computeAeoVisibilityMatrix()` tracks ThumbGate visibility and citation share across ChatGPT, Perplexity, Claude, and Google AI Mode. |

---

## 2. Verification

```bash
node scripts/profound-aeo-citation-engine.js
node --test tests/profound-aeo-citation-engine.test.js
```
