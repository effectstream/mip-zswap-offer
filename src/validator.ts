/**
 * OfferPayload validation — structural, cryptographic, and auth levels.
 */

import { decodeOffer, OFFER_HRP } from './codec.js';
import { verifyOfferAuth } from './auth.js';
import type {
  OfferAuth,
  OfferPayload,
  TokenLeg,
  ValidationResult,
} from './types.js';

const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  // Require the string to be a round-trippable ISO 8601 representation.
  // Accept both `Z` and explicit offsets by checking parseability, not round-trip.
  // A light shape check keeps obvious garbage out.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s);
}

function isValidBigintString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!/^\d+$/.test(s)) return false;
  try {
    BigInt(s);
    return true;
  } catch {
    return false;
  }
}

function validateLeg(leg: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(leg)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof leg.token !== 'string' || !HEX32.test(leg.token)) {
    errors.push(`${path}.token must be 64 lowercase hex characters`);
  }
  if (!isValidBigintString(leg.amount)) {
    errors.push(`${path}.amount must be a non-negative integer string`);
  }
}

function validateAuth(auth: unknown, errors: string[]): void {
  if (!isPlainObject(auth)) {
    errors.push('auth must be an object');
    return;
  }
  if (auth.scheme !== 'schnorr-bip340') {
    errors.push(`auth.scheme must be "schnorr-bip340", got ${JSON.stringify(auth.scheme)}`);
  }
  if (typeof auth.signerPublicKey !== 'string' || !HEX32.test(auth.signerPublicKey)) {
    errors.push('auth.signerPublicKey must be 64 hex characters (32 bytes)');
  }
  if (typeof auth.signature !== 'string' || !HEX64.test(auth.signature)) {
    errors.push('auth.signature must be 128 hex characters (64 bytes)');
  }
}

function validateStructure(offer: OfferPayload, errors: string[]): void {
  if (offer.version !== 1) {
    errors.push(`version must be 1, got ${String((offer as { version: unknown }).version)}`);
  }
  if (typeof offer.transaction !== 'string' || !offer.transaction.startsWith(`${OFFER_HRP}1`)) {
    errors.push(`transaction must be a bech32m string with HRP "${OFFER_HRP}"`);
  } else {
    try {
      decodeOffer(offer.transaction);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`transaction failed bech32m decode: ${msg}`);
    }
  }

  if (!Array.isArray(offer.gives) || offer.gives.length === 0) {
    errors.push('gives must be a non-empty array');
  } else {
    offer.gives.forEach((leg, i) => validateLeg(leg, `gives[${i}]`, errors));
  }

  if (!Array.isArray(offer.wants) || offer.wants.length === 0) {
    errors.push('wants must be a non-empty array');
  } else {
    offer.wants.forEach((leg, i) => validateLeg(leg, `wants[${i}]`, errors));
  }

  if (offer.metadata !== undefined) {
    if (!isPlainObject(offer.metadata)) {
      errors.push('metadata must be an object');
    } else {
      const m = offer.metadata;
      if (m.createdAt !== undefined && !isValidIsoDate(m.createdAt)) {
        errors.push('metadata.createdAt must be an ISO 8601 timestamp');
      }
      if (m.expiresAt !== undefined && !isValidIsoDate(m.expiresAt)) {
        errors.push('metadata.expiresAt must be an ISO 8601 timestamp');
      }
      if (m.makerNote !== undefined && typeof m.makerNote !== 'string') {
        errors.push('metadata.makerNote must be a string');
      }
    }
  }

  if (offer.auth !== undefined) {
    validateAuth(offer.auth, errors);
  }
}

/**
 * Attempts to decode + deserialize the transaction and compute per-token
 * imbalances (output amount − input amount, per token). Requires the
 * `@midnight-ntwrk/ledger-v8` peer dep to be installed. If it is not,
 * returns `null` and the caller treats Level 2 as inconclusive.
 */
async function computeImbalances(
  transaction: string,
): Promise<Map<string, bigint> | null> {
  let ledger: unknown;
  try {
    // Dynamic import keeps the peer dep truly optional — if it's not installed,
    // Level 2 is skipped silently.
    ledger = await import(
      /* @vite-ignore */ '@midnight-ntwrk/ledger-v8' as string
    );
  } catch {
    return null;
  }
  const { Transaction } = ledger as {
    Transaction: {
      deserialize: (
        sig: string,
        proof: string,
        binding: string,
        bytes: Uint8Array,
      ) => unknown;
    };
  };
  const bytes = decodeOffer(transaction);
  const tx = Transaction.deserialize(
    'signature',
    'pre-proof',
    'pre-binding',
    bytes,
  ) as {
    guaranteedOffer?: {
      inputs?: Array<{ type?: string; value?: bigint | string }>;
      outputs?: Array<{ type?: string; value?: bigint | string }>;
    };
  };

  const deltas = new Map<string, bigint>();
  const bump = (token: string, amount: bigint) => {
    const t = token.toLowerCase();
    deltas.set(t, (deltas.get(t) ?? 0n) + amount);
  };
  const go = tx.guaranteedOffer;
  for (const input of go?.inputs ?? []) {
    if (input.type === undefined || input.value === undefined) continue;
    bump(String(input.type), -BigInt(input.value as bigint | string));
  }
  for (const output of go?.outputs ?? []) {
    if (output.type === undefined || output.value === undefined) continue;
    bump(String(output.type), BigInt(output.value as bigint | string));
  }
  return deltas;
}

function legsToMap(legs: TokenLeg[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const l of legs) {
    m.set(l.token.toLowerCase(), (m.get(l.token.toLowerCase()) ?? 0n) + BigInt(l.amount));
  }
  return m;
}

function checkImbalances(offer: OfferPayload, deltas: Map<string, bigint>, errors: string[]): void {
  // Gives = tokens leaving the maker = negative deltas on that token.
  // Wants = tokens arriving at the maker = positive deltas on that token.
  const wants = legsToMap(offer.wants);
  const gives = legsToMap(offer.gives);

  for (const [token, amount] of gives) {
    const d = deltas.get(token) ?? 0n;
    if (-d !== amount) {
      errors.push(
        `gives/imbalance mismatch for token ${token}: declared ${amount}, tx delta ${d}`,
      );
    }
  }
  for (const [token, amount] of wants) {
    const d = deltas.get(token) ?? 0n;
    if (d !== amount) {
      errors.push(
        `wants/imbalance mismatch for token ${token}: declared ${amount}, tx delta ${d}`,
      );
    }
  }
}

/**
 * Validates an OfferPayload at all levels (structural, cryptographic, auth).
 *
 * Note: the imbalance (Level 2) and auth (Level 3) checks are asynchronous when
 * not skipped. This function is sync and therefore only performs the structural
 * checks plus the transaction bech32m decode. For the full cryptographic check,
 * call `validateOfferAsync()`.
 */
export function validateOffer(
  offer: OfferPayload,
  options?: { skipImbalanceCheck?: boolean; skipAuthCheck?: boolean },
): ValidationResult {
  const errors: string[] = [];
  validateStructure(offer, errors);
  // Synchronous surface can only do Level 1. Level 2 / 3 need await.
  // We still honour the skip flags for API symmetry.
  void options;
  return { valid: errors.length === 0, errors };
}

/**
 * Async variant that performs Level 1 + 2 + 3 checks.
 *
 * @param offer    Parsed OfferPayload to validate.
 * @param options  Optional flags to skip Level 2 or Level 3 checks.
 */
export async function validateOfferAsync(
  offer: OfferPayload,
  options?: { skipImbalanceCheck?: boolean; skipAuthCheck?: boolean },
): Promise<ValidationResult> {
  const errors: string[] = [];
  validateStructure(offer, errors);

  const structurallyOk = errors.length === 0;

  if (structurallyOk && !options?.skipImbalanceCheck) {
    try {
      const deltas = await computeImbalances(offer.transaction);
      if (deltas !== null) {
        checkImbalances(offer, deltas, errors);
      }
      // If the ledger package is unavailable, Level 2 is silently skipped.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`imbalance check failed: ${msg}`);
    }
  }

  if (structurallyOk && offer.auth && !options?.skipAuthCheck) {
    try {
      const ok = await verifyOfferAuth(offer);
      if (!ok) errors.push('auth signature verification failed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`auth verification errored: ${msg}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Quick structural-only guard — does not decode the transaction.
 * Useful for fast rejection of malformed payloads in hot paths.
 */
export function isWellFormedOffer(value: unknown): value is OfferPayload {
  if (!isPlainObject(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.transaction !== 'string') return false;
  if (!value.transaction.startsWith(`${OFFER_HRP}1`)) return false;
  if (!Array.isArray(value.gives) || value.gives.length === 0) return false;
  if (!Array.isArray(value.wants) || value.wants.length === 0) return false;
  for (const leg of [...value.gives, ...value.wants]) {
    if (!isPlainObject(leg)) return false;
    if (typeof leg.token !== 'string' || !HEX32.test(leg.token)) return false;
    if (!isValidBigintString(leg.amount)) return false;
  }
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) return false;
  if (value.auth !== undefined) {
    const authErrs: string[] = [];
    validateAuth(value.auth as OfferAuth, authErrs);
    if (authErrs.length > 0) return false;
  }
  return true;
}
