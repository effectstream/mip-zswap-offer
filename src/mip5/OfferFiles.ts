/**
 * MIP-0005 — Offer Files.
 *
 * bech32m encoding of a proven, imbalanced Midnight `Transaction`.
 * HRP `swapoffer`; 90-char bech32 limit is not enforced.
 */

import { bech32m } from "@scure/base";
import {
  Transaction,
  type Bindingish,
  type Proofish,
  type Signaturish,
} from "@midnight-ntwrk/ledger-v8";

/** Human-readable part for offer-file strings (`swapoffer1…`). */
export const OFFER_HRP = "swapoffer";

/** `@scure/base` accepts `false` to skip the 90-char limit. */
const NO_LIMIT = false as unknown as number;

/** Any ledger Transaction that can serialize. */
type AnyTx = Transaction<Signaturish, Proofish, Bindingish>;

/**
 * MIP-0005 offer-file codec.
 *
 * Canonical form is raw `Transaction` bytes; bech32m is display/share only.
 */
export class OfferFiles {
  static readonly HRP = OFFER_HRP;

  /** Raw tx bytes → `swapoffer1…`. */
  static encode(transactionBytes: Uint8Array): string {
    if (!(transactionBytes instanceof Uint8Array)) {
      throw new TypeError("OfferFiles.encode: transactionBytes must be a Uint8Array");
    }
    return bech32m.encode(OFFER_HRP, bech32m.toWords(transactionBytes), NO_LIMIT);
  }

  /** `swapoffer1…` → raw tx bytes. Throws on bad HRP / checksum. */
  static decode(encoded: string): Uint8Array {
    if (typeof encoded !== "string") {
      throw new TypeError("OfferFiles.decode: input must be a string");
    }
    const { prefix, words } = bech32m.decode(
      encoded as `${string}1${string}`,
      NO_LIMIT,
    );
    if (prefix !== OFFER_HRP) {
      throw new Error(
        `OfferFiles.decode: expected HRP "${OFFER_HRP}", got "${prefix}"`,
      );
    }
    return Uint8Array.from(bech32m.fromWords(words));
  }

  /** Proven `Transaction` → `swapoffer1…` (MIP-0005 reference). */
  static toBech32(tx: AnyTx): string {
    return OfferFiles.encode(tx.serialize());
  }

  /** `swapoffer1…` → proven `Transaction` (MIP-0005 reference). */
  static fromBech32(text: string): AnyTx {
    // Markers match Lace-shaped <signature, proof, binding> offers.
    return Transaction.deserialize(
      "signature" as const,
      "proof" as const,
      "binding" as const,
      OfferFiles.decode(text),
    );
  }
}
