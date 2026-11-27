---
"thumbgate": patch
---

The dashboard loads again. `/project-switcher.js` was served as `application/octet-stream`, which the browser refuses to run under `nosniff`, so `npx thumbgate dashboard --open` and the hosted dashboard stopped at "Sign in". Scripts and styles now go out with their real content type, and new browser journey tests (`npm run test:journeys`) walk the real dashboard, DPO download and thumbgate.ai every day.
