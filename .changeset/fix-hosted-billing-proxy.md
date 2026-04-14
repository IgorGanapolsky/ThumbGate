---
"thumbgate": patch
---

Fix hosted billing fetch in proxy environments. Node.js native fetch (undici) does not honour HTTPS_PROXY env vars; bootstraps ProxyAgent when a proxy URL is detected so `node bin/cli.js cfo --today` works correctly in sandboxed or corporate network environments.
