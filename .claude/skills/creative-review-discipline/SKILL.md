# Software Release Discipline for Creative Outputs Steal

## Steal Source
YouTube: "AI as a Force Multiplier for Creatives" (DgX3XqhIhas, timestamps 10:07-11:36)

## Problem
Creative/AI-generated content ships without reviews or retrospectives. Unlike code, creative outputs skip QA entirely. Bugs repeat. Bad patterns persist.

## Pattern Stolen

### 1. Enforce Pre-Launch Reviews
Apply software code review to non-software deliverables:
- **Blog posts** → Reviewed by engineer + editor + security (3 sign-offs minimum)
- **Marketing copy** → Reviewed by product + legal + founder
- **Social posts** → Reviewed by brand + compliance (no ECI domain mentions)

### 2. Run Post-Launch Retrospectives
After a creative deliverable ships:
- What worked? (capture as reinforcement rule)
- What failed? (capture as prevention rule)
- What would we do differently? (write into the skill file)

### 3. Test Monetization Vectors in Localized Pockets
Instead of betting on one monetization strategy:
- Test different pricing in US vs India vs EU
- Run 3 checkout funnels simultaneously
- Graduate only winning mechanics to full rollout

## How ThumbGate Applies It

We already implement this via:
- **Pre-launch**: `bin/agent-loop --health --json` gates (12 checks before any merge)
- **Post-launch**: `thumbgate__capture_feedback` auto-promotes lessons to prevention rules
- **Localized pockets**: `/playbook.html` and `/checkout/pro` A/B test conversion

### What we add: creative review checklist

`scripts/creative-review-checklist.js`:
```javascript
const CHECKS = [
  { id: 'no_eci_domains', check: (content) => !/@(ecisolutions|ecinexus|eci\.com)/i.test(content), severity: 'BLOCK' },
  { id: 'verified_numbers', check: (content) => !/\d{3,}/.test(content.replace(/[^\d]/g, '')), severity: 'WARN' },
  { id: 'anti_slop', check: (content) => !/(brilliant|great|as an AI)/i.test(content), severity: 'WARN' },
  { id: 'pro_link_present', check: (content) => content.includes('buy.stripe.com'), severity: 'BLOCK' },
  { id: 'no_yaml_frontmatter', check: (content) => !/^---\n/.test(content), severity: 'BLOCK' },
];
```

## Pro Value
Pro adds:
- Automated creative review via LLM judge (rubric-locked)
- A/B testing framework for marketing copy (3 variants → metrics → winner)
- Revenue attribution tagging (UTM params on every outbound link)

**Steal command**: `npx thumbgate init` → select "creative-review-pack"
