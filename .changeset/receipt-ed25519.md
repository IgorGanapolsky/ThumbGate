---
"thumbgate": minor
---

Receipts can be signed with Ed25519, so an auditor can check them with a public key and no shared secret. `thumbgate receipts keygen` writes a private key to `~/.thumbgate/receipt-signing-ed25519.pem` (owner-only; or set `THUMBGATE_RECEIPT_ED25519_KEY`), and every new receipt then carries `ed25519KeyId` and `ed25519Signature` over its `entryHash`. `thumbgate receipts pubkey` prints the public key, and `thumbgate receipts verify --pubkey public.pem [--require-signed]` reports `bad_signature`, `signed_by_other_key` or `unsigned`. Without a key, receipts are unchanged.
