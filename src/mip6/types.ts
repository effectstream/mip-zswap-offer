/**
 * MIP-0006 payload and discovery types.
 */

import type { UnprovenTransaction } from "@midnight-ntwrk/ledger-v8";

export type TokenKind = "SHIELDED" | "UNSHIELDED";

/** One give or want leg; `amount` is a non-negative decimal string. */
export interface TokenLeg {
  token: string;
  amount: string;
  type: TokenKind;
}

// NOTE: the on-chain envelope (OnchainOfferPayload) was removed from
// MIP-0006: the DA blob IS the raw MIP-0005 Transaction bytes, nothing else.
// A wrapper would need its own canonical byte encoding for implementations
// to interoperate, its version duplicated the ledger's tagged serialization,
// and its only other field (unverifiedMessage) was removed as a phishing
// surface with no ledger-authenticated alternative short of a protocol
// update (see MIP-0006 Future Work).

export type OfferStatus = "live" | "consumed" | "expired";

/**
 * Indexer discovery payload. Everything under `computed` is derived/observed.
 */
export interface OffchainOfferPayload {
  version: 1;
  /**
   * Content address: lowercase hex SHA-256 of the raw offer bytes
   * (OfferFiles.offerId). Presence rules (MIP-0006): at least one of
   * offerId / offerBech32 MUST be present; lists SHOULD serve offerId and
   * MAY omit offerBech32 (16–25 KB per offer); single-offer responses MUST
   * include offerBech32.
   */
  offerId?: string;
  offerBech32?: string;
  computed: {
    gives: TokenLeg[];
    wants: TokenLeg[];
    expiresAt?: string;
    inputNullifiers: string[];
    firstSeenAt: string;
    status: OfferStatus;
  };
}

export interface OffchainOfferInput {
  offerBytes: Uint8Array;
  tx: UnprovenTransaction;
  inputNullifiers: string[];
  firstSeenAt: string;
  status: OfferStatus;
  expiresAt?: string;
  /** Default true. Set false for list contexts (offerId still included). */
  includeBech32?: boolean;
  /** Default true — reject give-only / want-only offers. */
  requireTwoSided?: boolean;
}
