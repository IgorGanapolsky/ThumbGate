# Colab compute honesty (FORMAT steal)

Source (BrowserOS, 2026-09-17, signed in as `iganapolsky@gmail.com`):
https://colab.research.google.com/signup

Colab is always free. Paid SKUs sell **Compute Units**, not a dedicated GPU:

| Plan | Price on /signup | Notes |
|------|------------------|--------|
| Pay As You Go | $9.99 / 100 CU, $49.99 / 500 CU | Buttons were **disabled** on this account |
| Pro | $9.99 / month | Subscribe still visible |
| Pro+ | $49.99 / month | Subscribe still visible; 24h background is this tier |
| Enterprise | pay for what you use | GCP notebooks |

Subscribe visible ≠ already subscribed. Do not buy a plan from an agent session. Not affiliated with Google.

ThumbGate evals stay on GitHub Actions. This doctor refuses colab-cli / ngrok-SSH / zero-cost A100 theater.

```bash
npx thumbgate colab-compute-honesty --json --map-only
npx thumbgate colab-compute-honesty --json --claim='Colab Pro+ A100'
npm run test:colab-compute-honesty
```
