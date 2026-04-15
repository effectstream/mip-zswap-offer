import { describe, expect, test } from 'bun:test';

import { OFFER_HRP, decodeOffer, encodeOffer } from '../src/codec.js';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 131 + 7) & 0xff;
  return b;
}

describe('codec', () => {
  test('round-trips short payload', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = encodeOffer(bytes);
    expect(encoded.startsWith(`${OFFER_HRP}1`)).toBe(true);
    expect(decodeOffer(encoded)).toEqual(bytes);
  });

  test('round-trips payloads larger than the standard 90-char bech32 limit', () => {
    // A ~4KB payload produces a >6KB bech32m string — well over 90 chars.
    const bytes = randomBytes(4096);
    const encoded = encodeOffer(bytes);
    expect(encoded.length).toBeGreaterThan(1000);
    expect(decodeOffer(encoded)).toEqual(bytes);
  });

  test('encodes the empty payload', () => {
    const encoded = encodeOffer(new Uint8Array(0));
    expect(decodeOffer(encoded)).toEqual(new Uint8Array(0));
  });

  test('decodeOffer rejects the wrong HRP', () => {
    // A valid bech32m string with a different HRP.
    // Build one by encoding via the library, then swapping the HRP manually.
    const encoded = encodeOffer(new Uint8Array([1, 2, 3]));
    const swapped = encoded.replace(/^zswapoffer/, 'notoffer');
    expect(() => decodeOffer(swapped)).toThrow();
  });

  test('decodeOffer rejects a corrupted checksum', () => {
    const encoded = encodeOffer(new Uint8Array([1, 2, 3, 4]));
    // Flip the last data character to break the checksum.
    const last = encoded.at(-1)!;
    const mutated = encoded.slice(0, -1) + (last === 'q' ? 'p' : 'q');
    expect(() => decodeOffer(mutated)).toThrow();
  });

  test('encodeOffer rejects non-Uint8Array input', () => {
    // @ts-expect-error intentional bad input
    expect(() => encodeOffer([1, 2, 3])).toThrow();
  });
});
