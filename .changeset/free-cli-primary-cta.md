---
"thumbgate": patch
---

fix: lead with free CLI install as primary CTA, make Pro secondary

10 visitors clicked "Start 7-day free trial" but 0 completed checkout because
Stripe requires a credit card upfront. Flip the CTA strategy: lead with the
zero-friction free CLI install (`npx thumbgate init`) as the hero action, and
position Pro as the upgrade path once users hit free tier limits (3 captures/day).

Changes:
- Hero: `npx thumbgate init` is now the prominent hero element with enlarged
  copy-to-clipboard; "Install Free CLI" is the primary button; "Upgrade to Pro"
  is smaller and secondary
- Sticky bottom bar: leads with `npx thumbgate init` copy command, "Go Pro" is
  a smaller secondary link
- Final CTA section: install command and free CLI link are primary, Pro is
  secondary
- Pricing section: Free tier gets cyan highlight border, "Most Popular" badge,
  and inline install command; Pro card border demoted
- PostHog events updated: `hero_install_click`, `hero_pro_click`,
  `sticky_pro_click`, `final_install_click`, `final_pro_click`
- Tests updated to match new CTA text patterns
