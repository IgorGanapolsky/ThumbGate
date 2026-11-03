---
applyTo: "public/**"
---

# Copilot Instructions for Public & Checkout Surfaces (`public/**`)

1. **1-Click Stripe & 4-Tier Money Ladder:**
   - Route primary self-serve Pro CTAs (`Start Pro`) on `public/index.html`, `public/pricing.html`, `public/dashboard.html`, and `public/lessons.html` directly to `/go/pro-direct` (`$19/mo` or `$149/yr` 1-click Stripe), never the `/checkout/pro` email wall.
   - Keep one-time purchase downsells (`/go/bundle-49` -> `https://iganapolsky.gumroad.com/l/vcrho` `$49` Production Rule-Pack and `/go/playbook-999` -> `https://iganapolsky.gumroad.com/l/odrkon` `$9.99` Playbook) active on `/cancel` and `/checkout/pro`.
2. **Honesty & Scannability Guardrails:**
   - Never invent unverified GitHub star counts or npm download counts in `public/*.html`.
   - Keep visible homepage body copy `<= 1,100` words (`node --test tests/public-landing.test.js` and `node --test tests/landing-page-claims.test.js`).
