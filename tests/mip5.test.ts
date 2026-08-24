import { describe, expect, test } from "bun:test";
import { bech32m } from "@scure/base";
import { Transaction } from "@midnightntwrk/ledger-v9";

import { OFFER_HRP, OfferFiles } from "../src/mip5/OfferFiles.ts";
import {
  makeFinalizedShieldedOutputOffer,
  makeUnprovenShieldedOutputOffer,
} from "./ledger-v9-fixtures.ts";

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 131 + 7) & 0xff;
  return b;
}

describe("MIP-0005 OfferFiles", () => {
  test("HRP is swapoffer", () => {
    expect(OFFER_HRP).toBe("swapoffer");
    expect(OfferFiles.HRP).toBe("swapoffer");
  });

  test("round-trips short payload", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = OfferFiles.encode(bytes);
    expect(encoded.startsWith(`${OFFER_HRP}1`)).toBe(true);
    expect(OfferFiles.decode(encoded)).toEqual(bytes);
  });

  test("round-trips payloads larger than the 90-char bech32 limit", () => {
    const bytes = randomBytes(4096);
    const encoded = OfferFiles.encode(bytes);
    expect(encoded.length).toBeGreaterThan(1000);
    expect(OfferFiles.decode(encoded)).toEqual(bytes);
  });

  test("encodes the empty payload", () => {
    const encoded = OfferFiles.encode(new Uint8Array(0));
    expect(OfferFiles.decode(encoded)).toEqual(new Uint8Array(0));
  });

  test("decode rejects wrong HRP (including legacy zswapoffer)", () => {
    const words = bech32m.toWords(new Uint8Array([1, 2, 3]));
    const foreign = bech32m.encode(
      "zswapoffer",
      words,
      false as unknown as number,
    );
    expect(() => OfferFiles.decode(foreign)).toThrow(/HRP/);
  });

  test("decode rejects corrupted checksum", () => {
    const encoded = OfferFiles.encode(new Uint8Array([1, 2, 3, 4]));
    const last = encoded.at(-1)!;
    const mutated = encoded.slice(0, -1) + (last === "q" ? "p" : "q");
    expect(() => OfferFiles.decode(mutated)).toThrow();
  });

  test("encode rejects non-Uint8Array", () => {
    // @ts-expect-error intentional
    expect(() => OfferFiles.encode([1, 2, 3])).toThrow();
  });
});

describe("MIP-0005 ledger-v9 transaction round trips", () => {
  test("serialize → swapoffer1… → deserialize is byte-for-byte lossless", () => {
    const tx = makeFinalizedShieldedOutputOffer(11n);
    const serialized = tx.serialize();

    const encoded = OfferFiles.toBech32(tx);
    const decodedBytes = OfferFiles.decode(encoded);
    const decodedTx = OfferFiles.fromBech32(encoded);

    expect(encoded.startsWith(`${OFFER_HRP}1`)).toBe(true);
    expect(decodedBytes).toEqual(serialized);
    expect(decodedTx.serialize()).toEqual(serialized);
    expect(decodedTx.identifiers()).toEqual(tx.identifiers());
    expect(OfferFiles.offerId(decodedTx.serialize())).toBe(
      OfferFiles.offerId(serialized),
    );
  });

  test("decoded v9 offers merge and the merged transaction round-trips losslessly", () => {
    const left = OfferFiles.fromBech32(
      OfferFiles.toBech32(
        makeFinalizedShieldedOutputOffer(11n, "11".repeat(32)),
      ),
    );
    const right = OfferFiles.fromBech32(
      OfferFiles.toBech32(
        makeFinalizedShieldedOutputOffer(17n, "22".repeat(32)),
      ),
    );

    const merged = left.merge(right);
    const mergedBytes = merged.serialize();
    const mergedEncoded = OfferFiles.toBech32(merged);
    const mergedDecoded = OfferFiles.fromBech32(mergedEncoded);

    expect(OfferFiles.decode(mergedEncoded)).toEqual(mergedBytes);
    expect(mergedDecoded.serialize()).toEqual(mergedBytes);
    expect(mergedDecoded.identifiers().sort()).toEqual(
      [...left.identifiers(), ...right.identifiers()].sort(),
    );

    const imbalances = Array.from(mergedDecoded.imbalances(0), ([token, amount]) => ({
      tag: token.tag,
      token: "raw" in token ? token.raw : undefined,
      amount,
    })).sort((a, b) => (a.token ?? "").localeCompare(b.token ?? ""));
    expect(imbalances).toEqual([
      { tag: "shielded", token: "11".repeat(32), amount: -11n },
      { tag: "shielded", token: "22".repeat(32), amount: -17n },
    ]);
  });

  test("fromBech32 rejects valid bech32m carrying malformed transaction bytes", () => {
    const serialized = makeFinalizedShieldedOutputOffer(23n).serialize();
    const malformed = [
      new Uint8Array(),
      new Uint8Array([1, 2, 3]),
      serialized.slice(0, 1),
      serialized.slice(0, Math.floor(serialized.length / 2)),
      serialized.slice(0, -1),
    ];

    for (const bytes of malformed) {
      expect(() => OfferFiles.fromBech32(OfferFiles.encode(bytes))).toThrow();
    }
  });

  test("fromBech32 rejects an unproven v9 transaction under finalized markers", () => {
    const unproven = makeUnprovenShieldedOutputOffer(29n);
    expect(() =>
      OfferFiles.fromBech32(OfferFiles.encode(unproven.serialize())),
    ).toThrow();

    // The format remains directly inspectable with its correct v9 markers;
    // the codec intentionally accepts only finalized/proven offer files.
    expect(
      Transaction.deserialize(
        "signature",
        "pre-proof",
        "pre-binding",
        unproven.serialize(),
      ).serialize(),
    ).toEqual(unproven.serialize());
  });
});
