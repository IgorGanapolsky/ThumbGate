# Profound (`tryprofound.com`) AEO / GEO & Intelligent UI Attribution Steal (`2026-10-16`)

> **Sources**:
> - [Profound Platform (`platform.tryprofound.com`)](https://platform.tryprofound.com/)
> - [Introducing the next generation of Agents in Profound (Jack Traina & Garrett Gomez, Oct 16, 2026)](https://www.tryprofound.com/blog/introducing-the-next-generation-of-marketing-agents)
> - [ChatGPT's missing UTM tags: what our data shows (Josh Blyskal, Oct 14, 2026)](https://www.tryprofound.com/blog/chatgpt-missing-utm-tags)

---

## 1. What We Stole & Built (`scripts/profound-aeo-citation-engine.js`)

| Profound Architecture (`2026-10-16`) | ThumbGate Implementation (`scripts/profound-aeo-citation-engine.js`) |
| :--- | :--- |
| **1. ChatGPT Intelligent UI Missing-UTM Dark Referral Recovery** (*Josh Blyskal Oct 14, 2026: tagged ChatGPT answer samples fell from 98% on Oct 8 to 66% on Oct 14 — 34% untagged answer share — as Intelligent UI reached 35% of answers*) | `attributeIntelligentUiVisit()` correlates untagged Direct visits on `/operator-framework` with preceding eligible answer-engine fetches (`OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `Claude-SearchBot`, `Applebot-Extended`) within a `120s` pre-visit window (`0 <= deltaMs <= windowMs`). |
| **2. Answer Engine `FactCheck` & Remediation Diode** (*Profound AEI `FactCheck` tab + Accuracy & Sentiment Alerts*) | `evaluateBrandFactCheck()` audits AI responses against canonical ground truth (`<0.5ms` local CPU latency, `$0` token tax, HIPAA/ZDR compliance, `$19/mo` / `$499` / `$2,500` / `$500/mo` pricing) while respecting negations (`not cloud-only`). |
| **3. `Topics × Competitors × Engines` Visibility & Citation Share Matrix** (*Profound AEI `Visibility Score` + `Citation Share`*) | `computeAeoVisibilityMatrix()` reports `byTopic`, `byEngine` (`chatgpt`, `perplexity`, `claude`, `google_ai_mode`), and `competitorMentions`, keeping explicit empty observations (`[]`) distinct from demo fixtures. |

---

## 2. Verification

```bash
node scripts/profound-aeo-citation-engine.js
node --test tests/profound-aeo-citation-engine.test.js
```
