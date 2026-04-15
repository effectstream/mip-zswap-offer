/**
 * MIP-p2p-atomic-swaps — OfferPayload construction.
 */

import { encodeOffer } from './codec.js';
import type { BuildOfferInput, OfferPayload, TokenLeg } from './types.js';

/**
 * Normalises a token string:
 *   - strips a `0x` / `0X` prefix
 *   - lower-cases
 *   - left-pads with zeros to 64 hex chars (32 bytes)
 *
 * @throws if the input is not pure hex or longer than 64 hex chars.
 */
export function normalizeToken(token: string): string {
  if (typeof token !== 'string') {
    throw new TypeError('normalizeToken: token must be a string');
  }
  let t = token.trim();
  if (t.startsWith('0x') || t.startsWith('0X')) t = t.slice(2);
  t = t.toLowerCase();
  if (!/^[0-9a-f]*$/.test(t)) {
    throw new Error(`normalizeToken: "${token}" is not valid hex`);
  }
  if (t.length > 64) {
    throw new Error(
      `normalizeToken: token is ${t.length} hex chars, max is 64 (32 bytes)`,
    );
  }
  return t.padStart(64, '0');
}

/**
 * Coerces an amount to a stringified bigint. Accepts bigint / number / string.
 */
function normalizeAmount(amount: string | number | bigint): string {
  if (typeof amount === 'bigint') return amount.toString();
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
      throw new Error(
        `normalizeAmount: number must be a non-negative integer, got ${amount}`,
      );
    }
    return amount.toString();
  }
  if (typeof amount === 'string') {
    const s = amount.trim();
    if (!/^\d+$/.test(s)) {
      throw new Error(
        `normalizeAmount: "${amount}" is not a valid non-negative integer string`,
      );
    }
    // Round-trip through BigInt to canonicalise (e.g. strip leading zeros).
    return BigInt(s).toString();
  }
  throw new TypeError('normalizeAmount: amount must be string | number | bigint');
}

function normalizeLeg(leg: TokenLeg): TokenLeg {
  const out: TokenLeg = {
    token: normalizeToken(leg.token),
    amount: normalizeAmount(leg.amount as string | number | bigint),
  };
  if (leg.name !== undefined) out.name = leg.name;
  return out;
}

/**
 * Constructs a well-formed OfferPayload from a proven transaction and metadata.
 *
 * Steps performed:
 *   1. bech32m-encodes transactionBytes → `transaction` field
 *   2. Normalises token strings (lowercase, strips 0x, zero-pads to 64 hex chars)
 *   3. Coerces amounts to stringified bigints
 *   4. Stamps metadata.createdAt with current ISO 8601 timestamp if omitted
 *   5. Returns the assembled OfferPayload (unsigned, auth = undefined)
 *
 * Authentication (signing) is a separate step: pass the result to signOffer().
 */
export function buildOffer(input: BuildOfferInput): OfferPayload {
  if (!input || typeof input !== 'object') {
    throw new TypeError('buildOffer: input must be an object');
  }
  if (!(input.transactionBytes instanceof Uint8Array)) {
    throw new TypeError('buildOffer: transactionBytes must be a Uint8Array');
  }
  if (!Array.isArray(input.gives) || input.gives.length === 0) {
    throw new Error('buildOffer: gives must be a non-empty array');
  }
  if (!Array.isArray(input.wants) || input.wants.length === 0) {
    throw new Error('buildOffer: wants must be a non-empty array');
  }

  const transaction = encodeOffer(input.transactionBytes);
  const gives = input.gives.map(normalizeLeg);
  const wants = input.wants.map(normalizeLeg);

  const metadata = {
    createdAt: input.metadata?.createdAt ?? new Date().toISOString(),
    ...(input.metadata?.expiresAt !== undefined
      ? { expiresAt: input.metadata.expiresAt }
      : {}),
    ...(input.metadata?.makerNote !== undefined
      ? { makerNote: input.metadata.makerNote }
      : {}),
  };

  return {
    version: 1,
    transaction,
    gives,
    wants,
    metadata,
  };
}

/**
 * Derives metadata.expiresAt from a TTL duration.
 *
 * @param ttlMs Milliseconds from now until expiry.
 */
export function expiresAtFromTtl(ttlMs: number): string {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error(`expiresAtFromTtl: ttlMs must be a non-negative finite number, got ${ttlMs}`);
  }
  return new Date(Date.now() + ttlMs).toISOString();
}
