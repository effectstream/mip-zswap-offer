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
npm  add @effectstream/mip-zswap-offer @midnightntwrk/ledger-v9@^1.0.0 @scure/base
pnpm add @effectstream/mip-zswap-offer @midnightntwrk/ledger-v9@^1.0.0 @scure/base
bun  add @effectstream/mip-zswap-offer @midnightntwrk/ledger-v9@^1.0.0 @scure/base
```

Peer dependencies:

```json
{
  "@midnightntwrk/ledger-v9": "^1.0.0",
  "@scure/base": "^1.1.0 || ^2.0.0"
}
```

The package is built and tested against `@midnightntwrk/ledger-v9` `1.0.0`,
the version the stable Midnight JS client set pins. Use the same
`ledger-v9` version as the rest of your Midnight stack: two copies of the
ledger WASM in one process cannot exchange objects.

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

## Compatibility

Midnight mainnet, preview and preprod all run ledger 9. This package encodes
and decodes ledger-9 `Transaction` bytes through `@midnightntwrk/ledger-v9`
(`^1.0.0`). Release candidates of `ledger-v9` (such as `1.0.0-rc.3`) are
outside the peer range and are not supported: they do not match the live
networks.

The `swapoffer` HRP, bech32m envelope, MIP-0006 raw-blob rule, and SHA-256
`offerId` algorithm are the same as in the ledger-v8 line, but the bytes inside
the envelope are ledger-9 `Transaction` bytes. V8 offer bytes are not a
supported input and there is no implicit conversion. Producers, validators, and
takers must upgrade together and must not load v8 and v9 ledger WASM in the
same process. Existing v8 offers must be regenerated or handled by an isolated
legacy reader.

### Version history

| Version | Ledger | Status |
| --- | --- | --- |
| `0.4.0` | `@midnightntwrk/ledger-v9` `^1.0.0` (ledger 9) | Current, npm `latest` |
| `0.4.0-v9.0` | `@midnightntwrk/ledger-v9` `1.0.0-rc.3` | Release-candidate prerelease, deprecated: use `0.4.0` |
| `0.3.x` | `@midnight-ntwrk/ledger-v8` | Last ledger-v8 line; no live network runs ledger 8 |

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

CI and the publish workflow use Bun 1.4.0.

```bash
bun install --frozen-lockfile
bun test
bun run build
bun test ./.github/release-guard.test.ts   # release workflow guard
```

---

## Releasing

Publishing runs in GitHub Actions (`.github/workflows/publish.yml`) with npm
trusted publishing; no npm token is stored in the repository.

1. Set `version` in `package.json` and merge it to `main`.
2. Push the tag `v<version>` (or create a GitHub release with that tag) at the
   merge commit. The tag must equal `v` + the `package.json` version.
3. The workflow publishes stable versions (`X.Y.Z`) with dist-tag `latest` and
   prereleases (`X.Y.Z-<pre>`, for example `0.4.1-rc.1`) with dist-tag `next`.
   The old `X.Y.Z-v9.N` prerelease scheme is rejected.

The workflow packs the package once and publishes that tarball. If
`npm publish` exits non-zero but the registry already serves that version with
the same `dist.integrity` as the packed tarball, the run passes; otherwise it
fails.

---

## License

Apache-2.0
