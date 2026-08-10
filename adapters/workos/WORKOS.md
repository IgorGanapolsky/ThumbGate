# WorkOS + ThumbGate (identity vs pre-action gates)

## Split of responsibility

| Concern | WorkOS AuthKit / MCP Auth | ThumbGate |
|---------|---------------------------|-----------|
| Who is the user/org? | SSO, social login, orgs, SCIM (paid) | — |
| OAuth for MCP servers | AuthKit as OAuth 2.1 AS; scopes → RBAC | Remote MCP OAuth 2.1 PKCE (`scripts/mcp-oauth.js`) |
| What may this tool call do *now*? | Scope admission only | Pre-action gates, lessons, prevention rules |
| Agent skill install / auth scaffold | WorkOS CLI / widget skills | Gate: `review-workos-skill-and-auth-installer-actions` |

**One line for buyers:** WorkOS (or any IdP) decides *who* the agent is. ThumbGate decides *which tool calls may run*.

## ThumbGate production policy ($10/mo)

Public `thumbgate.app` auth uses **WorkOS Production AuthKit only**:

- AuthKit host: `progressive-mouse-13.authkit.app`
- Production client id: `client_01KY0306CYDV6QSXE43QKM2ZXW`
- Allowed under cap: email + password, **own** social OAuth apps (Google free under AuthKit MAU tier)
- **Forbidden without budget rewrite:** custom AuthKit domain (~$99/mo), enterprise SSO/SAML connections (~$125/conn), Directory Sync, public traffic on staging AuthKit

Guard (secret-free):

```bash
node scripts/workos-production-guard.js --json
npm run prove:workos
```

## MCP OAuth scopes (hierarchy)

ThumbGate remote MCP supports:

| Scope | Allows |
|-------|--------|
| `mcp:read` | Tools with `readOnlyHint: true` |
| `mcp:gates` | Gate-evaluation tools (+ read) |
| `mcp:feedback` | Feedback capture tools (+ read) |
| `mcp:write` | Mutating tools **and** everything above |

`mcp:write` **implies** read/gates/feedback so operator tokens are not fail-closed on read-only tools (WorkOS-style role implication).

## Complementary, not competitive

Do not pitch ThumbGate as “WorkOS for agents.” Pitch as the **runtime prevention layer after identity** — the same gap as claw-style enterprise agents and GDG “dark agent” demos (poisoned specs, secret egress, destructive tool use).

## Related

- `scripts/workos-production-guard.js`
- `scripts/mcp-oauth.js`
- `scripts/prove-workos.js`
- Gate category: **Enterprise Identity & MCP Auth Governance** in `config/gate-templates.json`
