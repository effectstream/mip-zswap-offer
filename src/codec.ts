/**
 * MIP-offer-files — bech32m encode/decode.
 *
 *   HRP:   zswapoffer
 *   Limit: none (the standard 90-char bech32 cap is lifted by the MIP)
 */

import { bech32m } from '@scure/base';

export const OFFER_HRP = 'zswapoffer';

/**
 * Disable the standard 90-character bech32 length cap.
 * `@scure/base` accepts `false` here to skip the limit check entirely.
 */
const NO_LIMIT = false as unknown as number;

/**
 * Encodes raw transaction bytes into a bech32m string with the `zswapoffer` HRP.
 * The result may be several thousand characters long.
 */
export function encodeOffer(transactionBytes: Uint8Array): string {
  if (!(transactionBytes instanceof Uint8Array)) {
    throw new TypeError('encodeOffer: transactionBytes must be a Uint8Array');
  }
  const words = bech32m.toWords(transactionBytes);
  return bech32m.encode(OFFER_HRP, words, NO_LIMIT);
}

/**
 * Decodes a bech32m `zswapoffer` string back to raw transaction bytes.
 *
 * @throws {Error} if the HRP is not `zswapoffer`, the checksum is invalid,
 *                 or the string is malformed.
 */
export function decodeOffer(encoded: string): Uint8Array {
  if (typeof encoded !== 'string') {
    throw new TypeError('decodeOffer: input must be a string');
  }
  const { prefix, words } = bech32m.decode(
    encoded as `${string}1${string}`,
    NO_LIMIT,
  );
  if (prefix !== OFFER_HRP) {
    throw new Error(
      `decodeOffer: expected HRP "${OFFER_HRP}", got "${prefix}"`,
    );
  }
  return Uint8Array.from(bech32m.fromWords(words));
}
