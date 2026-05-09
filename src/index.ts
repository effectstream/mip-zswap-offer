/**
 * mip-zswap-offer — MIP-offer-files + MIP-p2p-atomic-swaps codec.
 *
 * Public API surface re-exported here. See SPEC.md for the full contract.
 */

export * from './types.js';
export { OFFER_HRP, encodeOffer, decodeOffer } from './codec.js';
export { buildOffer, expiresAtFromTtl, normalizeToken } from './builder.js';
export { serializeOffer, deserializeOffer, toWireOffer } from './serializer.js';
export {
  validateOffer,
  validateOfferAsync,
  isWellFormedOffer,
} from './validator.js';
export { signOffer, verifyOfferAuth, createSigningPayload } from './auth.js';
