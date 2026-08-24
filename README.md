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
npm  add @effectstream/mip-zswap-offer
pnpm add @effectstream/mip-zswap-offer
bun  add @effectstream/mip-zswap-offer
```

Peer dependencies:

```json
{
  "@midnightntwrk/ledger-v9": "1.0.0-rc.3",
  "@scure/base": "^1.1.0 || ^2.0.0"
}
```

---

## Quick start

### MIP-0005 — encode / decode

```typescript
import { OfferFiles } from "@effectstream/mip-zswap-offer/mip5";
// or: import { OfferFiles } from "@effectstream/mip-zswap-offer";

const bech32 = OfferFiles.encode(tx.serialize()); // swapoffer1…
const bytes = OfferFiles.decode(bech32);
const tx2 = OfferFiles.fromBech32(bech32);
```

### MIP-0006 — DA + discovery payloads

```typescript
import { P2pAtomicSwaps } from "@effectstream/mip-zswap-offer/mip6";

// The MIP-0006 DA blob is the raw MIP-0005 transaction bytes.
const offerBytes = tx.serialize();
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

## Ledger-v9 compatibility (breaking)

This line uses the Midnight 2.x transaction representation from
`@midnightntwrk/ledger-v9@1.0.0-rc.3`. The `swapoffer` HRP, bech32m envelope,
MIP-0006 raw-blob rule, and SHA-256 `offerId` algorithm are unchanged, but the
bytes inside the envelope are now ledger-v9 `Transaction` bytes.

That dependency and wire-format boundary is breaking relative to version
0.3.0, which used `@midnight-ntwrk/ledger-v8`. V8 offer bytes are not a
supported input to this v9 codec and there is no implicit conversion. Producers,
validators, and takers must upgrade atomically and must not load v8 and v9
ledger WASM in the same process. Existing v8 offers must be regenerated or
handled by an isolated legacy reader.

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
