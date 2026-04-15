/**
 * Optional BIP-340 Schnorr signing / verification.
 *
 * Signing payload construction (per MIP-p2p-atomic-swaps):
 *   1. Strip the auth field from the offer
 *   2. Canonicalise to RFC 8785 JSON
 *   3. SHA-256 the UTF-8 bytes
 *   4. Sign the 32-byte hash with BIP-340 Schnorr
 */

import { schnorr } from '@noble/curves/secp256k1';
// Import from the `/sha256` subpath rather than `/sha2` — the former exists in
// every @noble/hashes release since 1.0, the latter only from 1.4+. This lets
// us widen the peer-dep range to `^1.0.0 || ^2.0.0`.
import { sha256 } from '@noble/hashes/sha256';

import { canonicalJson } from './canonical.js';
import { toWireOffer } from './serializer.js';
import type { OfferPayload } from './types.js';

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length string (${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: invalid hex "${hex.slice(i * 2, i * 2 + 2)}"`);
    }
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Constructs the 32-byte hash that gets signed for an offer.
 *
 * Exposed for debugging / independent verification; most callers use
 * signOffer() / verifyOfferAuth().
 */
export function createSigningPayload(offer: Omit<OfferPayload, 'auth'>): Uint8Array {
  // Normalise to wire form (drops `name` etc.), then strip auth, then canonicalise.
  const wire = toWireOffer(offer as OfferPayload);
  const { auth: _auth, ...rest } = wire;
  void _auth;
  const json = canonicalJson(rest);
  return new TextEncoder().encode(json);
}

function signingDigest(offer: Omit<OfferPayload, 'auth'>): Uint8Array {
  return sha256(createSigningPayload(offer));
}

/**
 * Signs an OfferPayload and attaches the auth envelope.
 *
 * @param offer       The unsigned OfferPayload (any existing auth field is ignored).
 * @param privateKey  32-byte private key.
 * @returns A new OfferPayload with the auth field populated.
 */
export async function signOffer(
  offer: OfferPayload,
  privateKey: Uint8Array,
): Promise<OfferPayload> {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new TypeError('signOffer: privateKey must be a 32-byte Uint8Array');
  }
  const { auth: _drop, ...unsigned } = offer;
  void _drop;
  const digest = signingDigest(unsigned as OfferPayload);
  const signature = schnorr.sign(digest, privateKey);
  const pubKey = schnorr.getPublicKey(privateKey);

  return {
    ...unsigned,
    auth: {
      signerPublicKey: bytesToHex(pubKey),
      signature: bytesToHex(signature),
      scheme: 'schnorr-bip340',
    },
  } as OfferPayload;
}

/**
 * Verifies the BIP-340 Schnorr signature on an offer.
 *
 * Returns `false` (does not throw) if the offer has no auth field or if the
 * signature does not verify.
 */
export async function verifyOfferAuth(offer: OfferPayload): Promise<boolean> {
  if (!offer.auth) return false;
  const { signerPublicKey, signature, scheme } = offer.auth;
  if (scheme !== 'schnorr-bip340') return false;
  let pub: Uint8Array;
  let sig: Uint8Array;
  try {
    pub = hexToBytes(signerPublicKey);
    sig = hexToBytes(signature);
  } catch {
    return false;
  }
  if (pub.length !== 32 || sig.length !== 64) return false;

  const { auth: _drop, ...unsigned } = offer;
  void _drop;
  const digest = signingDigest(unsigned as OfferPayload);

  try {
    return schnorr.verify(sig, digest, pub);
  } catch {
    return false;
  }
}
