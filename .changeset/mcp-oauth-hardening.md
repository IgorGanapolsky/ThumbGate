---
"thumbgate": patch
---

Harden the MCP OAuth authorization server:

- **Bound the in-memory store** (FIFO eviction on clients/codes/tokens) so
  anonymous calls to /oauth/register and /oauth/authorize cannot exhaust memory.
- **Enforce the MCP redirect_uri rule** — the MCP authorization spec requires all
  redirect URIs to be `localhost` or HTTPS. Registration now accepts only HTTPS
  and loopback and rejects every other scheme (custom app schemes included),
  replacing the previous over-permissive custom-scheme handling.
- **Document the in-memory durability limitation** in createStore (state is lost
  on restart / not shared across instances — production multi-tenancy follow-up).
