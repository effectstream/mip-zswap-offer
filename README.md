# mip-zswap-offer

TypeScript reference library for two Midnight Improvement Proposals:

| MIP | Module | Class |
| --- | --- | --- |
| **MIP-0005** Offer Files | [`src/mip5/`](src/mip5/) | `OfferFiles` |
| **MIP-0006** P2P Atomic Swaps | [`src/mip6/`](src/mip6/) | `P2pAtomicSwaps` |

Aligned with the July 2026 WIP drafts (`swapoffer` HRP, full `Transaction`
payload, on-chain/off-chain split, auth removed, derived typed legs).

---

## Install

```bash
npm  add mip-zswap-offer
pnpm add mip-zswap-offer
bun  add mip-zswap-offer
```

Peer dependencies:

```json
{
  "@midnight-ntwrk/ledger-v8": "*",
  "@scure/base": "^1.1.0 || ^2.0.0"
}
```

---

## Quick start

### MIP-0005 — encode / decode

```typescript
import { OfferFiles } from "mip-zswap-offer/mip5";
// or: import { OfferFiles } from "mip-zswap-offer";

const bech32 = OfferFiles.encode(tx.serialize()); // swapoffer1…
const bytes = OfferFiles.decode(bech32);
const tx2 = OfferFiles.fromBech32(bech32);
```

### MIP-0006 — DA + discovery payloads

```typescript
import { P2pAtomicSwaps } from "mip-zswap-offer/mip6";

const onchain = P2pAtomicSwaps.buildOnchain(offerBytes, "optional note");
const { gives, wants } = P2pAtomicSwaps.deriveTokenLegs(tx);
P2pAtomicSwaps.assertTwoSided(gives, wants);

const offchain = P2pAtomicSwaps.toOffchain({
  offerBytes,
  tx,
  inputNullifiers: ["…"],
  firstSeenAt: new Date().toISOString(),
  status: "live",
});
```

---

## Layout

```
src/
  mip5/   OfferFiles.ts     ← MIP-0005 only
  mip6/   P2pAtomicSwaps.ts ← MIP-0006 only (imports mip5 for bech32 display)
  index.ts                  ← re-exports both
```

Each MIP folder has a short README. Spec details live in the WIP MIP docs.

---

## Breaking changes vs 0.1.x

| Old (0.1) | New (0.2) |
| --- | --- |
| HRP `zswapoffer` | HRP `swapoffer` |
| Single `OfferPayload` JSON with maker `gives`/`wants` + optional Schnorr `auth` | `OnchainOfferPayload` (raw bytes) + `OffchainOfferPayload` (`computed.*`) |
| Maker-asserted legs | Derived legs with `SHIELDED` / `UNSHIELDED` |
| `signOffer` / `verifyOfferAuth` | Removed (unsound per MIP-0006) |

---

## Scope

Does: codec, payload construction, gives/wants derivation, two-sided rule.

Does not: wallet SDK, Celestia publish, indexer REST, nullifier monitoring.

---

## Testing

```bash
bun install
bun test
bun run build
```

---

## License

Apache-2.0
