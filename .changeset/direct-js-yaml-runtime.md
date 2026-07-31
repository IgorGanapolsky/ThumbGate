---
'thumbgate': patch
---

Declare the YAML parser used by the packaged API server as a production dependency so production-only installs can load the runtime without relying on a transitive development package.
