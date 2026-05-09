# mip-zswap-offer

Zero-dependency TypeScript reference implementation of two Midnight Improvement
Proposals:

| MIP                        | Scope                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **[MIP-offer-files]**      | Binary serialization + bech32m encoding of proven Zswap partial transactions (`zswapoffer` HRP) |
| **[MIP-p2p-atomic-swaps]** | Application-layer `OfferPayload` schema, validation, optional BIP-340 Schnorr auth envelope     |

[MIP-offer-files]: https://github.com/andrew-fleming/midnight-improvement-proposals/blob/a763b64f96ef3cee4ce1fafc29fdf87cf21d39d2/mips/mip-offer-files.md
[MIP-p2p-atomic-swaps]: https://github.com/andrew-fleming/midnight-improvement-proposals/blob/585eb846bda02e5f3a7dcfd30d9d0f5d7963540c/mips/mip-p2p-atomic-swaps.md

The library is the single source of truth for the offer lifecycle:

1. **Building** a well-formed `OfferPayload` from a proven transaction and
   user-supplied metadata
2. **Serializing** the payload to canonical JSON for transport (Celestia DA,
   clipboard, QR, HTTP)
3. **Deserializing** a raw JSON string back into a typed `OfferPayload`
4. **Validating** that `gives` / `wants` match the transaction's actual ledger
   imbalances
5. **Signing** and **verifying** the optional BIP-340 Schnorr auth envelope

It is environment-agnostic (browser, Node.js, Bun, Deno) and has **no runtime
dependency on the Midnight wallet SDK**. The ledger package is needed only for
the Level 2 imbalance check and is declared as an optional peer dependency.

---

## Install

```bash
npm  add mip-zswap-offer
pnpm add mip-zswap-offer
bun  add mip-zswap-offer
```

Peer dependencies — ranges intentionally widened to avoid conflicts with other
packages in a `@midnight-ntwrk/*` tree (where these deps commonly coexist at
multiple versions):

```json
{
  "@midnight-ntwrk/ledger-v8": "*", // optional — only for Level 2 imbalance checks
  "@scure/base": "^1.1.0 || ^2.0.0", // bech32m: stable API across 1.x and 2.x
  "@noble/curves": "^1.0.0 || ^2.0.0", // schnorr.{sign,verify,getPublicKey}: stable since 1.0
  "@noble/hashes": "^1.0.0 || ^2.0.0" // sha256 imported from /sha256 subpath (available since 1.0)
}
```

---

## Quick start

### Build and serialize an offer (producer)

```typescript
import { buildOffer, expiresAtFromTtl, serializeOffer } from "mip-zswap-offer";

// After wallet.initSwap() returns an offerRecipe:
const transactionBytes = offerRecipe.transaction.serialize().toBytes();

const offer = buildOffer({
  transactionBytes,
  gives: [{ token: "a1b2…", amount: "1000000" }],
  wants: [{ token: "c3d4…", amount: "500000" }],
  metadata: {
    expiresAt: expiresAtFromTtl(60 * 60 * 1_000), // 1 hour
    makerNote: "Looking for a quick swap",
  },
});

const json = serializeOffer(offer); // canonical JSON string
// publish `json` to Celestia DA, clipboard, QR, ...
```

### Deserialize, validate, and decode (consumer)

```typescript
import {
  decodeOffer,
  deserializeOffer,
  validateOfferAsync,
} from "mip-zswap-offer";
import { Transaction } from "@midnight-ntwrk/ledger-v8";

const offer = deserializeOffer(raw);
const result = await validateOfferAsync(offer);

if (!result.valid) throw new Error(result.errors.join("; "));

const bytes = decodeOffer(offer.transaction);
const tx = Transaction.deserialize(
  "signature",
  "pre-proof",
  "pre-binding",
  bytes,
);
```

### Optional Schnorr signing

```typescript
import { signOffer, verifyOfferAuth } from "mip-zswap-offer";

const signed = await signOffer(offer, privateKey32bytes);
await verifyOfferAuth(signed); // → true
```

---

## API surface

| Module       | Exports                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `codec`      | `OFFER_HRP`, `encodeOffer`, `decodeOffer`                                                       |
| `builder`    | `buildOffer`, `expiresAtFromTtl`, `normalizeToken`                                              |
| `serializer` | `serializeOffer`, `deserializeOffer`, `toWireOffer`                                             |
| `validator`  | `validateOffer` (sync, Level 1), `validateOfferAsync` (Level 1+2+3), `isWellFormedOffer`        |
| `auth`       | `signOffer`, `verifyOfferAuth`, `createSigningPayload`                                          |
| `types`      | `OfferPayload`, `TokenLeg`, `OfferMetadata`, `OfferAuth`, `BuildOfferInput`, `ValidationResult` |

---

## Validation levels

`validateOfferAsync` runs three layers of checks, each skippable:

| Level | Check                                                                               | Needs peer dep              |
| ----- | ----------------------------------------------------------------------------------- | --------------------------- |
| 1     | Structural — version, hex shape, bech32m HRP, ISO timestamps                        | No                          |
| 2     | Cryptographic — decode + deserialize the transaction, verify `gives`/`wants` deltas | `@midnight-ntwrk/ledger-v8` |
| 3     | Auth — verify the BIP-340 Schnorr signature over the canonical signing payload      | No                          |

The sync `validateOffer` runs Level 1 only. Use it in hot paths and in
generator/state-machine code that cannot `await`.

If `@midnight-ntwrk/ledger-v8` is not installed, Level 2 is silently skipped —
the library stays usable as a pure codec.

---

## Scope

The library does:

- Everything between "I have transaction bytes and token amounts" and "I have a
  canonical JSON string ready to publish"
- Everything between "I have a raw JSON string from Celestia" and "I have a
  validated, typed `OfferPayload` with decoded bytes"

The library does **not**:

- Talk to the Midnight wallet (use `@midnight-ntwrk/wallet-sdk`)
- Submit to Celestia (use your DA client)
- Manage offer storage, TTL, or nullifier tracking
- Implement the indexer REST API

---

## Testing

```bash
bun install
bun test
```

The suite covers structural, codec, builder, serializer, validator, and auth
layers. Level 2 imbalance tests are stubbed (they verify graceful skip when the
ledger peer dep is absent); end-to-end imbalance validation is covered by the
downstream E2E tests in the zswap-da-demo.

---

## License

Apache-2.0
