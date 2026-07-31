# MIP-0006 — Peer-to-Peer Atomic Swaps

Implements the WIP MIP-0006 core library: on-chain / off-chain payloads,
authoritative gives/wants derivation, and the two-sided swap rule.

Depends on MIP-0005 via `OfferFiles` (raw bytes on DA; bech32m for display).

| Export | Role |
|--------|------|
| `P2pAtomicSwaps` | Class: `toOffchain`, `deriveTokenLegs`, `assertTwoSided`, `earliestIntentTtl`, … |
| *(on-chain)* | The DA blob **is** the raw MIP-0005 `Transaction` bytes — no envelope (see MIP-0006) |
| `OffchainOfferPayload` | Indexer discovery shape (`offerBech32` + `computed.*`) |
| `TokenLeg` | `{ token, amount, type: SHIELDED \| UNSHIELDED }` |

## Rules encoded here

- **gives/wants are derived** from the transaction — never trusted from the maker.
- **Two-sided**: ≥1 give and ≥1 want; give-only offers are rejected (`NotASwapError`).
- **No auth envelope** — BIP-340 wrapper signing was removed from the MIP as unsound.

Does **not** publish to Celestia or implement the indexer REST API.
