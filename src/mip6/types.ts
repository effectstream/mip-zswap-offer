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

/**
 * DA-layer payload. `offer` is MIP-0005 raw Transaction bytes — not bech32m.
 */
export interface OnchainOfferPayload {
  version: 1;
  offer: Uint8Array;
  /** Free-form note. UNTRUSTED — not authenticated. */
  unverifiedMessage?: string;
}

export type OfferStatus = "live" | "consumed" | "expired";

/**
 * Indexer discovery payload. Everything under `computed` is derived/observed.
 */
export interface OffchainOfferPayload {
  version: 1;
  offerBech32: string;
  unverifiedMessage?: string;
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
  unverifiedMessage?: string;
  expiresAt?: string;
  /** Default true — reject give-only / want-only offers. */
  requireTwoSided?: boolean;
}
