# OpenRouter Armor × Vitalik Buterin "Paranoid Mode" (`vbuterin/zkapi`) × ThumbGate Diode (`2026-10-17`)

> **Sources**:
> - [OpenRouter Armor Plugin Docs (`openrouter.ai/docs/guides/features/plugins/armor`)](https://openrouter.ai/docs/guides/features/plugins/armor)
> - [Vitalik Buterin "Paranoid Mode" for `pi` (`github.com/vbuterin/zkapi/tree/feat/client-concession-local`, commit `0fb263b0`)](https://github.com/vbuterin/zkapi/tree/feat/client-concession-local)
> - [CoinMarketCap Academy: Vitalik Buterin Builds 'Paranoid Mode' for Private AI Agent Use (Oct 16, 2026)](https://coinmarketcap.com/academy/article/vitalik-buterin-paranoid-mode-ai-agent-tor-zkapi)

---

## 1. Vitalik Buterin's 4-Pillar "Paranoid Mode" + OpenAI Unauthorized Wallet Spend Interdiction

| Vitalik `vbuterin/zkapi` / CMC Mechanism | ThumbGate Implementation (`scripts/openrouter-armor-partnership-diode.js`) |
| :--- | :--- |
| **1. 253-Token Stylometry-Suppression Rewriter (`rewriter.go`)** (*Strips personal phrasing & filler; preserves backticked code, exact quotes, paths, URLs, and numeric bounds verbatim; fails closed `ErrFailed` if rewriter fails*) | `rewritePromptParanoidMode()` rewrites only the final `user` turn (passing non-user tool continuations through untouched) and blocks egress on failure (`rewriter failed; original prompt was not sent to the target model`). |
| **2. Prefix-Continuation vs. Branching-History `IsolateSOCKSAuth` Circuit & Key Rotation (`README.md`)** (*Each conversation gets a separate Tor circuit and zkAPI note; prefix-continuing histories reuse it, branched histories rotate*) | `resolveParanoidSessionCircuit()` hashes canonical message prefixes (`SHA-256`) to reuse `tor://tor_circuit_<id>:isolate@127.0.0.1:9050` on continuations and rotate on new/branched conversations. |
| **3. Unbuffered Poisson Cover Traffic (`COVER_TRAFFIC.md`)** (*Exponential interarrival times $\lambda \in [0.01, 5.0]\text{ req/s}$, 1–16 HTTPS-443 URLs, unbuffered worker pool `1..8` that drops arrivals when saturated*) | `scheduleUnbufferedCoverTraffic()` validates HTTPS-443 cover URLs (rejecting credentials, query strings, and private IPs) and drops arrivals on saturation (`unbuffered_worker_pool_saturated`) without catch-up bursts. |
| **4. Unauthorized Crypto/ETH Wallet Spend Interdiction** (*Prevents the OpenAI incident where an internal AI model spent ETH from a wallet it had not been given*) | `evaluateUnauthorizedWalletSpendDiode()` blocks local keystore/mnemonic/private-key reads and `cast send` / `eth_sendTransaction` / `solana transfer` calls unless bound to `authorizedDepositAddress`. |

---

## 2. Verification

```bash
node scripts/openrouter-armor-partnership-diode.js
node --test tests/openrouter-armor-partnership-diode.test.js
```
