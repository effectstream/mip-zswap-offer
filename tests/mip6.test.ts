import { describe, expect, test } from "bun:test";

import { OfferFiles, OFFER_HRP } from "../src/mip5/OfferFiles.ts";
import {
  NotASwapError,
  P2pAtomicSwaps,
  UnknownTokenTagError,
} from "../src/mip6/P2pAtomicSwaps.ts";
import { makeUnprovenShieldedOutputOffer } from "./ledger-v9-fixtures.ts";

const shielded = (raw: string) => ({ tag: "shielded" as const, raw });
const unshielded = (raw: string) => ({ tag: "unshielded" as const, raw });
const dust = () => ({ tag: "dust" as const });

function mockTx(opts: {
  fallible?: Map<number, unknown>;
  intents?: Map<number, unknown>;
  imbalances?: Map<number, Map<unknown, bigint>>;
}) {
  return {
    guaranteedOffer: undefined,
    fallibleOffer: opts.fallible,
    intents: opts.intents,
    imbalances(seg: number) {
      return opts.imbalances?.get(seg) ?? new Map();
    },
  } as any;
}

describe("MIP-0006 P2pAtomicSwaps.deriveTokenLegs", () => {
  test("derives legs from a real ledger-v9 transaction", () => {
    const token = "ab".repeat(32);
    const tx = makeUnprovenShieldedOutputOffer(37n, token);
    expect(P2pAtomicSwaps.deriveTokenLegs(tx)).toEqual({
      gives: [],
      wants: [{ token, amount: "37", type: "SHIELDED" }],
    });
  });

  test("tags legs SHIELDED / UNSHIELDED; dust ignored", () => {
    const tx = mockTx({
      imbalances: new Map([
        [
          0,
          new Map<unknown, bigint>([
            [unshielded("aabb"), 100n],
            [shielded("ccdd"), -50n],
            [dust(), 999n],
          ]),
        ],
      ]),
    });
    const { gives, wants } = P2pAtomicSwaps.deriveTokenLegs(tx);
    expect(gives).toEqual([
      { token: "aabb", amount: "100", type: "UNSHIELDED" },
    ]);
    expect(wants).toEqual([
      { token: "ccdd", amount: "50", type: "SHIELDED" },
    ]);
  });

  test("keeps same color on different layers separate", () => {
    const tx = mockTx({
      imbalances: new Map([
        [
          0,
          new Map<unknown, bigint>([
            [shielded("aa"), 10n],
            [unshielded("aa"), -5n],
          ]),
        ],
      ]),
    });
    const { gives, wants } = P2pAtomicSwaps.deriveTokenLegs(tx);
    expect(gives).toEqual([{ token: "aa", amount: "10", type: "SHIELDED" }]);
    expect(wants).toEqual([{ token: "aa", amount: "5", type: "UNSHIELDED" }]);
  });

  test("throws UnknownTokenTagError on unexpected tag", () => {
    const tx = mockTx({
      imbalances: new Map([
        [0, new Map<unknown, bigint>([[{ tag: "weird", raw: "00" }, 1n]])],
      ]),
    });
    expect(() => P2pAtomicSwaps.deriveTokenLegs(tx)).toThrow(
      UnknownTokenTagError,
    );
  });
});

describe("MIP-0006 two-sided rule", () => {
  test("isTwoSided requires both sides", () => {
    expect(
      P2pAtomicSwaps.isTwoSided(
        [{ token: "a", amount: "1", type: "SHIELDED" }],
        [],
      ),
    ).toBe(false);
    expect(
      P2pAtomicSwaps.isTwoSided(
        [{ token: "a", amount: "1", type: "SHIELDED" }],
        [{ token: "b", amount: "1", type: "SHIELDED" }],
      ),
    ).toBe(true);
  });

  test("assertTwoSided throws NotASwapError for give-only", () => {
    expect(() =>
      P2pAtomicSwaps.assertTwoSided(
        [{ token: "a", amount: "1", type: "SHIELDED" }],
        [],
      ),
    ).toThrow(NotASwapError);
  });
});

describe("MIP-0006 payload builders", () => {
  test("the on-chain envelope is gone — no buildOnchain export (spec removal)", () => {
    // The DA blob IS the raw MIP-0005 bytes; a wrapper would need its own
    // canonical byte encoding and carried nothing trustworthy.
    expect((P2pAtomicSwaps as any).buildOnchain).toBeUndefined();
  });

  test("offerId is sha256 of the RAW bytes (never the string)", async () => {
    const { createHash } = await import("node:crypto");
    const offerBytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const expected = createHash("sha256").update(offerBytes).digest("hex");
    expect(OfferFiles.offerId(offerBytes)).toBe(expected);
    // interconvertibility: same id from either representation
    expect(OfferFiles.offerId(OfferFiles.decode(OfferFiles.encode(offerBytes)))).toBe(expected);
  });

  test("toOffchain derives legs and encodes bech32", () => {
    const offerBytes = new Uint8Array([7, 7, 7]);
    const tx = mockTx({
      imbalances: new Map([
        [
          0,
          new Map<unknown, bigint>([
            [shielded("aa"), 10n],
            [shielded("bb"), -5n],
          ]),
        ],
      ]),
    });
    const off = P2pAtomicSwaps.toOffchain({
      offerBytes,
      tx,
      inputNullifiers: ["dead"],
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      status: "live",
    });
    expect(off.version).toBe(1);
    expect(off.offerId).toBe(OfferFiles.offerId(offerBytes));
    expect(off.offerBech32!.startsWith(`${OFFER_HRP}1`)).toBe(true);
    expect(off.computed.gives[0]!.type).toBe("SHIELDED");
    expect(off.computed.wants[0]!.token).toBe("bb");
    expect(off.computed.inputNullifiers).toEqual(["dead"]);
    expect((off as any).unverifiedMessage).toBeUndefined();
  });

  test("includeBech32: false omits the string but keeps offerId (list context)", () => {
    const offerBytes = new Uint8Array([9, 9, 9]);
    const tx = mockTx({
      imbalances: new Map([
        [0, new Map<unknown, bigint>([[shielded("aa"), 10n], [shielded("bb"), -5n]])],
      ]),
    });
    const off = P2pAtomicSwaps.toOffchain({
      offerBytes,
      tx,
      inputNullifiers: [],
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      status: "live",
      includeBech32: false,
    });
    expect(off.offerBech32).toBeUndefined();
    expect(off.offerId).toBe(OfferFiles.offerId(offerBytes)); // at least one present
  });

  test("earliestIntentTtl picks the soonest ttl", () => {
    const tx = mockTx({
      intents: new Map([
        [1, { ttl: new Date("2026-06-30T12:00:00Z") }],
        [2, { ttl: new Date("2026-06-01T00:00:00Z") }],
      ]),
    });
    expect(P2pAtomicSwaps.earliestIntentTtl(tx)).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });
});
