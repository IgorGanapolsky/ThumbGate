---
"thumbgate": patch
---

chore(brand): canonical TG monogram on README + Stripe coherence

The canonical ThumbGate mark (TG gate monogram, dark rounded square with
teal-to-cyan gradient frame) now renders consistently across the three
public brand surfaces. Before this change each surface had drifted to
its own raster:

- Landing page (thumbgate.ai): already canonical (header + favicon + og.png)
- Stripe product catalog: ThumbGate Pro and ThumbGate Team each had a
  different one-off upload (teal shield / dark gate-with-lightning).
  Re-pointed at `https://thumbgate.ai/assets/brand/thumbgate-icon-512.png`
  via the Stripe API so the checkout surface matches the landing page
  and the npm package page.
- GitHub repo / npmjs.com: README had no brand image. Now renders the
  same canonical 128x128 PNG at the top so github.com visitors and npm
  installers see the same mark that renders on the landing page.

`public/og.png` (already present, already canonical) still needs to be
uploaded to GitHub's Settings -> Social preview separately — GitHub does
not expose that surface via REST or GraphQL, so it can only be uploaded
via the web UI.
