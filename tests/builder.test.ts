import { describe, expect, test } from 'bun:test';

import { buildOffer, expiresAtFromTtl, normalizeToken } from '../src/builder.js';
import { decodeOffer } from '../src/codec.js';

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);

describe('normalizeToken', () => {
  test('strips 0x and lowercases', () => {
    expect(normalizeToken('0xABCDEF'.padEnd(66, '0'))).toBe(
      'abcdef'.padEnd(64, '0').toLowerCase(),
    );
  });

  test('left-pads short tokens to 64 chars', () => {
    expect(normalizeToken('a')).toBe('a'.padStart(64, '0'));
    expect(normalizeToken('0xff')).toBe('ff'.padStart(64, '0'));
  });

  test('rejects non-hex strings', () => {
    expect(() => normalizeToken('zzz')).toThrow();
  });

  test('rejects tokens longer than 64 hex chars', () => {
    expect(() => normalizeToken('a'.repeat(65))).toThrow();
  });
});

describe('buildOffer', () => {
  const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);

  test('bech32m-encodes transactionBytes', () => {
    const o = buildOffer({
      transactionBytes: bytes,
      gives: [{ token: tokenA, amount: '1' }],
      wants: [{ token: tokenB, amount: '2' }],
    });
    expect(o.transaction.startsWith('zswapoffer1')).toBe(true);
    expect(decodeOffer(o.transaction)).toEqual(bytes);
  });

  test('normalises tokens (lowercase, strip 0x, zero-pad to 64)', () => {
    const o = buildOffer({
      transactionBytes: bytes,
      gives: [{ token: '0xABCD', amount: '1' }],
      wants: [{ token: 'FFFF', amount: '2' }],
    });
    expect(o.gives[0].token).toBe('abcd'.padStart(64, '0'));
    expect(o.wants[0].token).toBe('ffff'.padStart(64, '0'));
  });

  test('coerces amounts and strips leading zeros', () => {
    const o = buildOffer({
      transactionBytes: bytes,
      gives: [{ token: tokenA, amount: '00001000' }],
      wants: [{ token: tokenB, amount: '42' }],
    });
    expect(o.gives[0].amount).toBe('1000');
    expect(o.wants[0].amount).toBe('42');
  });

  test('stamps metadata.createdAt when omitted', () => {
    const before = Date.now();
    const o = buildOffer({
      transactionBytes: bytes,
      gives: [{ token: tokenA, amount: '1' }],
      wants: [{ token: tokenB, amount: '2' }],
    });
    const after = Date.now();
    const t = new Date(o.metadata!.createdAt!).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  test('preserves provided createdAt', () => {
    const createdAt = '2020-01-01T00:00:00.000Z';
    const o = buildOffer({
      transactionBytes: bytes,
      gives: [{ token: tokenA, amount: '1' }],
      wants: [{ token: tokenB, amount: '2' }],
      metadata: { createdAt },
    });
    expect(o.metadata!.createdAt).toBe(createdAt);
  });

  test('rejects empty gives/wants', () => {
    expect(() =>
      buildOffer({
        transactionBytes: bytes,
        gives: [],
        wants: [{ token: tokenB, amount: '1' }],
      }),
    ).toThrow();
  });

  test('preserves leg.name field', () => {
    const o = buildOffer({
      transactionBytes: bytes,
      gives: [{ token: tokenA, amount: '1', name: 'tDUST' }],
      wants: [{ token: tokenB, amount: '2' }],
    });
    expect(o.gives[0].name).toBe('tDUST');
  });
});

describe('expiresAtFromTtl', () => {
  test('returns an ISO string in the future', () => {
    const now = Date.now();
    const s = expiresAtFromTtl(60_000);
    const t = new Date(s).getTime();
    expect(t).toBeGreaterThanOrEqual(now + 59_000);
    expect(t).toBeLessThanOrEqual(now + 61_000);
  });

  test('rejects negative TTL', () => {
    expect(() => expiresAtFromTtl(-1)).toThrow();
  });
});
