# GitHub Sponsors Setup — ThumbGate

## Current Status

| Check | Result |
|-------|--------|
| `hasSponsorsListing` (GraphQL) | **true** — listing exists |
| `is_sponsorable` (REST) | `null` — REST field not exposed; GraphQL confirms listing is live |
| Existing tiers (REST) | **404** — no tiers configured yet |
| Sponsors listing description | Present (generic open-source description, not ThumbGate-specific) |

**Summary:** The GitHub Sponsors profile for `IgorGanapolsky` is live and accepting sponsors, but no tiers have been created yet, and the listing description does not mention ThumbGate. Both need to be updated.

---

## Recommended Tier Structure

These tiers map directly to ThumbGate's existing pricing and feature set.

### $5/mo — Supporter

**Perks:**
- Name listed in the ThumbGate README under "Sponsors"
- Early access to release notes and changelog before public announcement
- Access to the `#sponsors` discussion category on GitHub

**Rationale:** Entry point for individuals who use the free `thumbgate` npm package and want to give back. Low friction, no license delivery required.

---

### $19/mo — Pro Sponsor

**Perks:**
- Full **ThumbGate Pro** license (`thumbgate-pro` npm package)
- Access to Pro features: LanceDB vector similarity, Thompson Sampling bandit, ContextFS context packs, DPO export
- Priority support via GitHub Issues (SLA: response within 48 hours)
- All Supporter perks

**Rationale:** Mirrors the standalone ThumbGate Pro price point. Sponsors at this tier get the same commercial value as a direct Pro subscriber, with the added benefit of supporting open-source development.

---

### $49/mo — Power Sponsor

**Perks:**
- Everything in Pro Sponsor
- **1 hour onboarding/architecture call per month** (scheduled via Calendly or GitHub discussion)
- Direct feedback channel — sponsor's use cases prioritized in roadmap planning
- Pre-release beta access to new features before npm publish

**Rationale:** Targets individual power users or consultants who want hands-on help integrating ThumbGate into their agent pipelines. The onboarding call converts sponsors into active product champions.

---

### $149/mo — Team Sponsor

**Perks:**
- Everything in Power Sponsor
- **Team license for up to 10 seats** (`thumbgate-pro` for 10 npm accounts or CI environments)
- Dedicated **private Slack channel** (or Discord thread) for direct async support
- Logo placement in README and on the ThumbGate landing page
- Quarterly roadmap review call (30 min)

**Rationale:** Targets small engineering teams running AI coding agents at scale. Maps to the ThumbGate team/enterprise tier. Slack channel access reduces friction for multi-engineer adoption.

---

## Step-by-Step: Create Tiers on GitHub Sponsors

The listing already exists. The only remaining step is adding tiers.

1. Go to [github.com/sponsors/IgorGanapolsky/manage](https://github.com/sponsors/IgorGanapolsky/manage)
2. Click **"Tiers"** in the left sidebar.
3. Click **"Add tier"** and fill in for each tier:
   - **Monthly price** (5, 19, 49, 149)
   - **Name** (Supporter, Pro Sponsor, Power Sponsor, Team Sponsor)
   - **Description** (copy from the perks above)
   - **Is one-time?** — leave unchecked (recurring monthly)
4. For the $19 tier, enable **"Welcome message"** with instructions on how to access the `thumbgate-pro` package (npm token or GitHub Packages invite).
5. Click **"Publish"** on each tier.

To verify tiers are live after creation:

```bash
gh api users/IgorGanapolsky/sponsorship-tiers --jq '.[].monthly_price_in_dollars'
```

Expected output once tiers exist:
```
5
19
49
149
```

---

## Update the Sponsors Listing Description

The current listing description is generic. Replace it with ThumbGate-specific copy at:
[github.com/sponsors/IgorGanapolsky/manage](https://github.com/sponsors/IgorGanapolsky/manage) → **"Profile"**

Suggested description:

```markdown
## Support ThumbGate

**ThumbGate** is an open-source pre-action gate system for AI coding agents.
It captures thumbs-up/down feedback, promotes it to persistent memory, generates
prevention rules, and blocks known-bad tool calls via PreToolUse hooks.

Sponsoring funds:
- Continued development of the free `thumbgate` npm package
- LanceDB vector similarity and Thompson Sampling in `thumbgate-pro`
- ContextFS context assembly and DPO export for fine-tuning pipelines
- Documentation, examples, and community support

Pro and Team sponsors receive a `thumbgate-pro` license as part of their tier.
```

---

## Sponsor Perks Mapped to ThumbGate Pro Features

| Perk | ThumbGate Feature | Available At |
|------|-------------------|--------------|
| npm package access | `thumbgate` (free) | All tiers |
| Pro npm package | `thumbgate-pro` | $19+/mo |
| LanceDB vector similarity search | `npm run feedback:summary` with vector index | $19+/mo |
| Thompson Sampling bandit | Adaptive lesson retrieval | $19+/mo |
| ContextFS context packs | `npm run feedback:rules` context assembly | $19+/mo |
| DPO export for fine-tuning | `npm run feedback:export:dpo` | $19+/mo |
| Onboarding call | Architecture review, pipeline integration | $49+/mo |
| Multi-seat license | 10 CI/CD environments or npm accounts | $149/mo |
| Direct async support channel | Slack/Discord | $149/mo |

---

## Verification Commands

After tiers are created, run these to confirm the setup is complete:

```bash
# Confirm listing is live
gh api graphql -f query='{ user(login: "IgorGanapolsky") { hasSponsorsListing sponsorsListing { fullDescription } } }'

# Confirm tiers exist
gh api users/IgorGanapolsky/sponsorship-tiers --jq '.[].monthly_price_in_dollars'

# Check repo has Sponsor button configured (.github/FUNDING.yml)
cat .github/FUNDING.yml
```

### .github/FUNDING.yml (create if missing)

```yaml
github: IgorGanapolsky
```

This adds the **"Sponsor"** button to the top of the `IgorGanapolsky/ThumbGate` repository page.
