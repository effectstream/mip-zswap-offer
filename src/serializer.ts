/**
 * JSON serialization / deserialization for OfferPayload.
 */

import { canonicalJson } from './canonical.js';
import type { OfferPayload, TokenLeg } from './types.js';

/** Strips UI-only fields (currently just `name`) from a TokenLeg. */
function stripLeg(leg: TokenLeg): { token: string; amount: string } {
  return { token: leg.token, amount: leg.amount };
}

/**
 * Builds the wire-form OfferPayload: same shape but with `name` removed from
 * every TokenLeg, and `undefined` metadata/auth omitted.
 */
export function toWireOffer(offer: OfferPayload): OfferPayload {
  const wire: OfferPayload = {
    version: offer.version,
    transaction: offer.transaction,
    gives: offer.gives.map(stripLeg),
    wants: offer.wants.map(stripLeg),
  };
  if (offer.metadata !== undefined) wire.metadata = { ...offer.metadata };
  if (offer.auth !== undefined) wire.auth = { ...offer.auth };
  return wire;
}

/**
 * Serializes an OfferPayload to a canonical JSON string suitable for:
 *   - Embedding in a Celestia DA blob
 *   - Clipboard / QR code sharing
 *   - Transmission over HTTP
 *
 * Behaviour:
 *   - Strips `name` from TokenLeg entries (UI-only field, not part of the MIP schema)
 *   - Keys are sorted per RFC 8785 for signing consistency
 *   - Returns a plain JSON string (no base64 wrapping)
 */
export function serializeOffer(offer: OfferPayload): string {
  return canonicalJson(toWireOffer(offer));
}

/**
 * Parses a raw JSON string into an OfferPayload.
 *
 * Performs a light shape check (throws on obviously-wrong input) but does NOT
 * run the full validator — call validateOffer() after deserialization.
 *
 * @throws {Error} if the string is not valid JSON or does not match the schema.
 */
export function deserializeOffer(raw: string): OfferPayload {
  if (typeof raw !== 'string') {
    throw new TypeError('deserializeOffer: input must be a string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`deserializeOffer: invalid JSON — ${msg}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('deserializeOffer: top-level value must be a JSON object');
  }
  const p = parsed as Record<string, unknown>;
  if (p.version !== 1) {
    throw new Error(`deserializeOffer: unsupported version ${String(p.version)}`);
  }
  if (typeof p.transaction !== 'string') {
    throw new Error('deserializeOffer: transaction must be a string');
  }
  if (!Array.isArray(p.gives) || !Array.isArray(p.wants)) {
    throw new Error('deserializeOffer: gives and wants must be arrays');
  }
  return parsed as OfferPayload;
}
