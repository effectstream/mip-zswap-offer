import { describe, expect, test } from 'bun:test';

import { buildOffer } from '../src/builder.js';
import {
  deserializeOffer,
  serializeOffer,
  toWireOffer,
} from '../src/serializer.js';
import type { OfferPayload } from '../src/types.js';

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);

function sampleOffer(): OfferPayload {
  return buildOffer({
    transactionBytes: new Uint8Array([1, 2, 3, 4]),
    gives: [{ token: tokenA, amount: '100', name: 'DUST' }],
    wants: [{ token: tokenB, amount: '200', name: 'NIGHT' }],
    metadata: { createdAt: '2025-01-01T00:00:00.000Z' },
  });
}

describe('serializeOffer', () => {
  test('produces valid JSON without the UI-only `name` field', () => {
    const json = serializeOffer(sampleOffer());
    const parsed = JSON.parse(json);
    expect(parsed.gives[0].name).toBeUndefined();
    expect(parsed.wants[0].name).toBeUndefined();
    expect(parsed.gives[0].token).toBe(tokenA);
  });

  test('sorts object keys lexicographically (RFC 8785-ish)', () => {
    const json = serializeOffer(sampleOffer());
    // The top-level keys should appear in sorted order.
    const topKeys = Array.from(json.matchAll(/"(version|transaction|wants|gives|metadata|auth)":/g))
      .map((m) => m[1]);
    const sorted = [...topKeys].sort();
    expect(topKeys).toEqual(sorted);
  });

  test('serialization is deterministic regardless of insertion order', () => {
    const a = sampleOffer();
    const b: OfferPayload = {
      metadata: a.metadata,
      wants: a.wants,
      gives: a.gives,
      transaction: a.transaction,
      version: a.version,
    };
    expect(serializeOffer(a)).toBe(serializeOffer(b));
  });
});

describe('deserializeOffer', () => {
  test('round-trips through serialize', () => {
    const offer = sampleOffer();
    const parsed = deserializeOffer(serializeOffer(offer));
    expect(parsed.version).toBe(1);
    expect(parsed.transaction).toBe(offer.transaction);
    expect(parsed.gives[0].amount).toBe('100');
    expect(parsed.gives[0].name).toBeUndefined();
  });

  test('throws on malformed JSON', () => {
    expect(() => deserializeOffer('not json')).toThrow();
  });

  test('throws on wrong version', () => {
    const bad = JSON.stringify({ ...sampleOffer(), version: 2 });
    expect(() => deserializeOffer(bad)).toThrow();
  });

  test('throws when gives is not an array', () => {
    const bad = JSON.stringify({ ...sampleOffer(), gives: 'nope' });
    expect(() => deserializeOffer(bad)).toThrow();
  });
});

describe('toWireOffer', () => {
  test('drops `name` from legs but keeps token and amount', () => {
    const wire = toWireOffer(sampleOffer());
    expect(wire.gives[0]).toEqual({ token: tokenA, amount: '100' });
  });
});
