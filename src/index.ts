/**
 * mip-zswap-offer — MIP-0005 + MIP-0006 reference library.
 *
 * Prefer importing from `mip-zswap-offer/mip5` or `mip-zswap-offer/mip6`
 * when you want a clear ownership boundary.
 */

export { OFFER_HRP, OfferFiles } from "./mip5/index.js";
export {
  P2pAtomicSwaps,
  UnknownTokenTagError,
  NotASwapError,
} from "./mip6/index.js";
export type {
  TokenKind,
  TokenLeg,
  OffchainOfferPayload,
  OfferStatus,
  OffchainOfferInput,
} from "./mip6/index.js";
