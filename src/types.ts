/**
 * MIP-p2p-atomic-swaps / MIP-offer-files — shared types.
 */

/** A single token leg of a swap: what is being offered or wanted. */
export interface TokenLeg {
  /** Hex-encoded RawTokenType (32 bytes, 64 hex chars, no 0x prefix). */
  token: string;
  /** Amount as a stringified bigint (e.g. "1000000"). */
  amount: string;
  /**
   * Optional human-readable name for UI display only.
   * Not part of the MIP schema — stripped before signing and before writing to Celestia.
   */
  name?: string;
}

/** Optional application-layer metadata. */
export interface OfferMetadata {
  /** ISO 8601 creation timestamp. */
  createdAt?: string;
  /**
   * ISO 8601 expiry timestamp.
   * SHOULD match the on-chain transaction TTL.
   */
  expiresAt?: string;
  /** Free-form note from the maker. */
  makerNote?: string;
}

/** Optional BIP-340 Schnorr authentication envelope. */
export interface OfferAuth {
  /** 32-byte x-only public key (64 hex chars, no 0x prefix). */
  signerPublicKey: string;
  /** 64-byte BIP-340 Schnorr signature (128 hex chars, no 0x prefix). */
  signature: string;
  scheme: 'schnorr-bip340';
}

/**
 * The canonical offer payload as defined by MIP-p2p-atomic-swaps.
 *
 * `transaction` holds the bech32m-encoded proven partial transaction
 * as defined by MIP-offer-files.
 */
export interface OfferPayload {
  version: 1;
  transaction: string;
  wants: TokenLeg[];
  gives: TokenLeg[];
  metadata?: OfferMetadata;
  auth?: OfferAuth;
}

/** Input to buildOffer(). */
export interface BuildOfferInput {
  /**
   * The raw bytes of the proven Zswap partial transaction,
   * as produced by wallet.initSwap() → offerRecipe.transaction.serialize().toBytes().
   */
  transactionBytes: Uint8Array;
  wants: TokenLeg[];
  gives: TokenLeg[];
  metadata?: OfferMetadata;
}

/** Result of validateOffer(). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
