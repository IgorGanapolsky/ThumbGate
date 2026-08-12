# Trademark, brand hierarchy, and open-source IP hygiene

**Status:** Internal checklist for counsel + engineering.  
**Not** a clearance opinion.

## 1. Trademark clearance (recommended before heavy brand spend)

| Item | Action for counsel |
| --- | --- |
| Word mark **ThumbGate** | USPTO / EUIPO (and other markets as needed) clearance in software/SaaS classes |
| Logo / icon | Clearance for design mark if distinctive |
| Domain family | `thumbgate.ai`, `thumbgate.app`, npm `thumbgate` |

Suggested classes (counsel to confirm):

- **Class 9** — downloadable software; AI agent governance / security tools  
- **Class 42** — SaaS; monitoring; cloud runner / orchestration services  

## 2. Brand hierarchy

| Mark / property | Role |
| --- | --- |
| **ThumbGate** | Primary product and company brand |
| **thumbgate.ai** | Marketing, docs, legal URLs, SEO/GEO hub |
| **thumbgate.app** | Hosted application / pairing / runner product surface |
| **npm `thumbgate`** | Public package name (MIT local engine) |

Default: one brand, two product surfaces (`.ai` marketing vs `.app` product).
Only split into distinct product marks if counsel sees conflict or GTM needs.

## 3. Third-party marks (mandatory presentation)

Names and logos for integrations are third-party property. Public copy must
use nominative fair use and **not** imply endorsement or affiliation.

Include near compatibility claims and in footers where practical:

> Anthropic, Claude, OpenAI, ChatGPT, Cursor, Codex, Perplexity, Hermes,
> Model Context Protocol (MCP), GitHub, Google, Nvidia, Railway, Stripe, and
> other product names are trademarks of their respective owners. ThumbGate is
> an independent product and is not affiliated with, sponsored by, or
> endorsed by those owners.

Never place third-party logos in a way that suggests partnership without a
written trademark license or partner agreement.

## 4. Copyright and contributor hygiene

| Topic | Posture |
| --- | --- |
| Public repo license | MIT (`LICENSE`) |
| Contributors | Prefer DCO (“sign-off”) or CLA so ThumbGate can distribute under MIT and operate commercially |
| Contractors | Written assignment or work-for-hire covering code, docs, and design |
| Hosted / commercial boundary | Proprietary hosted components and operational tooling may remain outside MIT distribution; do not claim a private “intelligence moat” that the public bundle contradicts (`MOAT.md`) |

## 5. Asset and dependency audit checklist

Before major releases or enterprise deals, verify:

- [ ] npm production dependencies licenses recorded in `THIRD_PARTY_NOTICES.md`  
- [ ] No copied proprietary snippets without license  
- [ ] Fonts, icons, diagrams, demo media have commercial-use rights  
- [ ] Generated images/content rights understood for marketing use  
- [ ] Third-party logos used only with permission or fair-use text marks  
- [ ] Releases ship required notices (npm package / repo root)  

## 6. Claims that interact with IP / brand risk

Avoid marketing that suggests:

- Official Claude / Cursor / Codex / Hermes product status  
- “Certified by” a model vendor without agreement  
- Ownership of MCP or other standards  

Prefer: “works with,” “compatible with,” “adapter for.”
