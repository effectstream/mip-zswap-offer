import { describe, expect, test } from 'bun:test';

import { buildOffer } from '../src/builder.js';
import {
  isWellFormedOffer,
  validateOffer,
  validateOfferAsync,
} from '../src/validator.js';
import type { OfferPayload } from '../src/types.js';

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);

function sampleOffer(overrides: Partial<OfferPayload> = {}): OfferPayload {
  return {
    ...buildOffer({
      transactionBytes: new Uint8Array([1, 2, 3, 4]),
      gives: [{ token: tokenA, amount: '100' }],
      wants: [{ token: tokenB, amount: '200' }],
    }),
    ...overrides,
  };
}

describe('validateOffer (structural)', () => {
  test('accepts a well-formed offer', () => {
    const r = validateOffer(sampleOffer());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('rejects wrong version', () => {
    const r = validateOffer({ ...sampleOffer(), version: 2 as unknown as 1 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('version'))).toBe(true);
  });

  test('rejects bech32m with wrong HRP', () => {
    const r = validateOffer({ ...sampleOffer(), transaction: 'bc1qxyz' });
    expect(r.valid).toBe(false);
  });

  test('rejects empty gives', () => {
    const r = validateOffer({ ...sampleOffer(), gives: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('gives'))).toBe(true);
  });

  test('rejects bad hex token', () => {
    const r = validateOffer({
      ...sampleOffer(),
      gives: [{ token: 'zz', amount: '1' }],
    });
    expect(r.valid).toBe(false);
  });

  test('rejects non-integer amount', () => {
    const r = validateOffer({
      ...sampleOffer(),
      wants: [{ token: tokenB, amount: 'not-a-number' }],
    });
    expect(r.valid).toBe(false);
  });

  test('rejects invalid ISO timestamp in metadata', () => {
    const r = validateOffer({
      ...sampleOffer(),
      metadata: { createdAt: 'yesterday' },
    });
    expect(r.valid).toBe(false);
  });

  test('rejects auth with wrong signature length', () => {
    const r = validateOffer({
      ...sampleOffer(),
      auth: {
        scheme: 'schnorr-bip340',
        signerPublicKey: 'a'.repeat(64),
        signature: 'a'.repeat(100),
      },
    });
    expect(r.valid).toBe(false);
  });
});

describe('isWellFormedOffer', () => {
  test('accepts valid offer', () => {
    expect(isWellFormedOffer(sampleOffer())).toBe(true);
  });

  test('rejects non-objects', () => {
    expect(isWellFormedOffer(null)).toBe(false);
    expect(isWellFormedOffer('nope')).toBe(false);
    expect(isWellFormedOffer([])).toBe(false);
  });

  test('rejects wrong version', () => {
    expect(isWellFormedOffer({ ...sampleOffer(), version: 2 })).toBe(false);
  });
});

describe('validateOfferAsync', () => {
  test('skips Level 2 when @midnight-ntwrk/ledger-v8 is not installed', async () => {
    // The peer dep isn't installed in the test environment, so Level 2 is a no-op.
    const r = await validateOfferAsync(sampleOffer(), { skipAuthCheck: true });
    expect(r.valid).toBe(true);
  });

  test('honours skipImbalanceCheck flag', async () => {
    const r = await validateOfferAsync(sampleOffer(), {
      skipImbalanceCheck: true,
      skipAuthCheck: true,
    });
    expect(r.valid).toBe(true);
  });
});
