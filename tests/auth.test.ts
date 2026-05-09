import { describe, expect, test } from 'bun:test';
import { schnorr } from '@noble/curves/secp256k1';

import { buildOffer } from '../src/builder.js';
import { createSigningPayload, signOffer, verifyOfferAuth } from '../src/auth.js';
import type { OfferPayload } from '../src/types.js';

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);

function sampleOffer(): OfferPayload {
  return buildOffer({
    transactionBytes: new Uint8Array([42, 43, 44, 45]),
    gives: [{ token: tokenA, amount: '1000' }],
    wants: [{ token: tokenB, amount: '500' }],
    metadata: { createdAt: '2025-01-01T00:00:00.000Z' },
  });
}

function randomPriv(): Uint8Array {
  return schnorr.utils.randomSecretKey();
}

describe('signOffer / verifyOfferAuth', () => {
  test('round-trips: a signed offer verifies', async () => {
    const priv = randomPriv();
    const signed = await signOffer(sampleOffer(), priv);
    expect(signed.auth).toBeDefined();
    expect(signed.auth!.scheme).toBe('schnorr-bip340');
    expect(signed.auth!.signerPublicKey.length).toBe(64);
    expect(signed.auth!.signature.length).toBe(128);
    expect(await verifyOfferAuth(signed)).toBe(true);
  });

  test('returns false when auth is absent', async () => {
    expect(await verifyOfferAuth(sampleOffer())).toBe(false);
  });

  test('fails verification when gives is tampered', async () => {
    const priv = randomPriv();
    const signed = await signOffer(sampleOffer(), priv);
    const tampered: OfferPayload = {
      ...signed,
      gives: [{ token: tokenA, amount: '9999' }],
    };
    expect(await verifyOfferAuth(tampered)).toBe(false);
  });

  test('fails verification when metadata is tampered', async () => {
    const priv = randomPriv();
    const signed = await signOffer(sampleOffer(), priv);
    const tampered: OfferPayload = {
      ...signed,
      metadata: { ...signed.metadata, makerNote: 'injected' },
    };
    expect(await verifyOfferAuth(tampered)).toBe(false);
  });

  test('fails verification with wrong scheme', async () => {
    const priv = randomPriv();
    const signed = await signOffer(sampleOffer(), priv);
    const tampered: OfferPayload = {
      ...signed,
      auth: { ...signed.auth!, scheme: 'other' as 'schnorr-bip340' },
    };
    expect(await verifyOfferAuth(tampered)).toBe(false);
  });

  test('rejects non-32-byte private keys', async () => {
    await expect(signOffer(sampleOffer(), new Uint8Array(16))).rejects.toThrow();
  });
});

describe('createSigningPayload', () => {
  test('is deterministic and excludes the auth field', () => {
    const offer = sampleOffer();
    const a = createSigningPayload(offer);
    const b = createSigningPayload({ ...offer, auth: undefined } as OfferPayload);
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
    expect(new TextDecoder().decode(a)).not.toContain('auth');
  });
});
