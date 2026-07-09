# MIP-0005 — Offer Files

Implements the WIP MIP-0005 codec: a proven Midnight `Transaction` as bech32m
with HRP `swapoffer`.

| Export | Role |
|--------|------|
| `OfferFiles` | Class: `encode` / `decode` / `toBech32` / `fromBech32` |
| `OFFER_HRP` | `"swapoffer"` |

- Canonical form = **raw transaction bytes** (use on DA layers).
- bech32m = display/share only (`swapoffer1…`).
- 90-character bech32 limit is **not** enforced.
- Payload is a full `Transaction` (shielded, unshielded, or mixed) — not a bare Zswap offer.
