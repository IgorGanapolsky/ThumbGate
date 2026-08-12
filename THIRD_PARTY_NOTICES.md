# Third-Party Notices

This repository and the `thumbgate` npm package include software developed by
third parties. This notice is informational; license texts of dependencies
ship with those packages.

## 1. ThumbGate core license

ThumbGate open-source materials in this repository are licensed under the
**MIT License**. See [`LICENSE`](./LICENSE).

Hosted commercial components, operational tooling, and non-public adapters may
be proprietary even when the public MIT engine is available via npm. See
[`MOAT.md`](./MOAT.md) for the public/hosted boundary posture.

## 2. Third-party trademarks

Anthropic, Claude, OpenAI, ChatGPT, Cursor, Codex, Perplexity, Hermes,
Model Context Protocol (MCP), GitHub, Google, Nvidia, Railway, Vercel, Stripe,
PayPal, Plausible, PostHog, and other product names are trademarks of their
respective owners. References are for identification and compatibility only.
ThumbGate is not affiliated with, sponsored by, or endorsed by those owners.

## 3. Production npm dependencies (direct)

| Package | License (as published by package) |
| --- | --- |
| `@anthropic-ai/sdk` | See package license |
| `@google/genai` | See package license |
| `@lancedb/lancedb` | See package license |
| `apache-arrow` | Apache-2.0 |
| `better-sqlite3` | MIT |
| `dotenv` | BSD-2-Clause |
| `js-yaml` | MIT |
| `playwright-core` | Apache-2.0 |
| `protobufjs` | BSD-3-Clause |
| `stripe` | MIT |

Transitive dependency licenses are determined by the lockfile and each package’s
own `LICENSE` file. For a machine-readable inventory in a release environment,
run your preferred license scanner against `package-lock.json`.

## 4. Contributor license posture

By contributing to this repository, contributors agree their contributions are
provided under the MIT License for public materials unless a contribution
agreement states otherwise. Prefer Developer Certificate of Origin (DCO)
sign-off on commits for external contributions.
