/**
 * MIP-0006 — Peer-to-Peer Atomic Swaps.
 *
 * Payload builders, authoritative gives/wants derivation, two-sided rule.
 * Auth (BIP-340) was removed from the MIP — do not reintroduce wrapper signing.
 */

import type { TokenType, UnprovenTransaction } from "@midnight-ntwrk/ledger-v8";

import { OfferFiles } from "../mip5/OfferFiles.js";
import type {
  OffchainOfferInput,
  OffchainOfferPayload,
  OnchainOfferPayload,
  TokenKind,
  TokenLeg,
} from "./types.js";

export class UnknownTokenTagError extends Error {
  constructor(public readonly tag: string) {
    super(`Unknown token tag "${tag}"`);
    this.name = "UnknownTokenTagError";
  }
}

export class NotASwapError extends Error {
  constructor(
    public readonly gives: readonly TokenLeg[],
    public readonly wants: readonly TokenLeg[],
  ) {
    super(
      `expected ≥1 give and ≥1 want; got ${gives.length} give(s), ${wants.length} want(s)`,
    );
    this.name = "NotASwapError";
  }
}

function tagToKind(tag: string): TokenKind {
  if (tag === "shielded") return "SHIELDED";
  if (tag === "unshielded") return "UNSHIELDED";
  throw new UnknownTokenTagError(tag);
}

/**
 * MIP-0006 P2P swap helpers (static API).
 */
export class P2pAtomicSwaps {
  /** DA payload: raw MIP-0005 offer bytes + optional untrusted note. */
  static buildOnchain(
    offerBytes: Uint8Array,
    unverifiedMessage?: string,
  ): OnchainOfferPayload {
    if (!(offerBytes instanceof Uint8Array)) {
      throw new TypeError(
        "P2pAtomicSwaps.buildOnchain: offer must be a Uint8Array",
      );
    }
    const payload: OnchainOfferPayload = { version: 1, offer: offerBytes };
    if (unverifiedMessage !== undefined) {
      payload.unverifiedMessage = unverifiedMessage;
    }
    return payload;
  }

  /**
   * Net imbalances → gives/wants, tagged SHIELDED / UNSHIELDED.
   * Same color on different layers stays separate. Dust is ignored.
   */
  static deriveTokenLegs(tx: UnprovenTransaction): {
    gives: TokenLeg[];
    wants: TokenLeg[];
  } {
    const intentKeys = (tx as any).intents
      ? Array.from((tx as any).intents.keys() as Iterable<number>)
      : [];
    const fallibleKeys = tx.fallibleOffer
      ? Array.from(tx.fallibleOffer.keys() as Iterable<number>)
      : [];
    const segmentIds = Array.from(
      new Set<number>([0, ...intentKeys, ...fallibleKeys]),
    );

    const merged = new Map<
      string,
      { token: string; kind: TokenKind; delta: bigint }
    >();

    for (const segId of segmentIds) {
      for (const [tokenType, delta] of tx.imbalances(segId)) {
        const tt = tokenType as TokenType;
        if (tt.tag === "dust") continue;
        if (tt.tag !== "shielded" && tt.tag !== "unshielded") {
          throw new UnknownTokenTagError(String((tt as any).tag));
        }
        const kind = tagToKind(tt.tag);
        const token = tt.raw.toLowerCase();
        const key = `${kind}:${token}`;
        const prev = merged.get(key);
        if (prev) prev.delta += delta;
        else merged.set(key, { token, kind, delta });
      }
    }

    const gives: TokenLeg[] = [];
    const wants: TokenLeg[] = [];
    for (const { token, kind, delta } of merged.values()) {
      if (delta > 0n) {
        gives.push({ token, amount: delta.toString(), type: kind });
      } else if (delta < 0n) {
        wants.push({ token, amount: (-delta).toString(), type: kind });
      }
    }
    return { gives, wants };
  }

  /** ≥1 give and ≥1 want. */
  static isTwoSided(
    gives: readonly unknown[],
    wants: readonly unknown[],
  ): boolean {
    return gives.length > 0 && wants.length > 0;
  }

  /** Throws `NotASwapError` when not two-sided. */
  static assertTwoSided(
    gives: readonly TokenLeg[],
    wants: readonly TokenLeg[],
  ): void {
    if (!P2pAtomicSwaps.isTwoSided(gives, wants)) {
      throw new NotASwapError(gives, wants);
    }
  }

  /** Earliest intent TTL as ISO 8601, if any. */
  static earliestIntentTtl(tx: UnprovenTransaction): string | undefined {
    const intents = (tx as any).intents;
    if (!intents || typeof intents.values !== "function") return undefined;

    let earliestMs: number | undefined;
    for (const intent of intents.values() as Iterable<any>) {
      const ttl = intent?.ttl;
      if (ttl == null) continue;
      let ms: number;
      if (ttl instanceof Date) {
        ms = ttl.getTime();
      } else if (typeof ttl === "number" || typeof ttl === "bigint") {
        const n = Number(ttl);
        ms = n > 1e12 ? n : n * 1000;
      } else if (typeof ttl === "string") {
        ms = Date.parse(ttl);
      } else {
        continue;
      }
      if (!Number.isFinite(ms)) continue;
      if (earliestMs === undefined || ms < earliestMs) earliestMs = ms;
    }
    return earliestMs === undefined
      ? undefined
      : new Date(earliestMs).toISOString();
  }

  /**
   * Indexer discovery payload. Derives gives/wants from `tx` (never trusts maker).
   */
  static toOffchain(input: OffchainOfferInput): OffchainOfferPayload {
    const { gives, wants } = P2pAtomicSwaps.deriveTokenLegs(input.tx);
    if (input.requireTwoSided !== false) {
      P2pAtomicSwaps.assertTwoSided(gives, wants);
    }

    const expiresAt = input.expiresAt ?? P2pAtomicSwaps.earliestIntentTtl(input.tx);
    const computed: OffchainOfferPayload["computed"] = {
      gives,
      wants,
      inputNullifiers: input.inputNullifiers,
      firstSeenAt: input.firstSeenAt,
      status: input.status,
    };
    if (expiresAt !== undefined) computed.expiresAt = expiresAt;

    const payload: OffchainOfferPayload = {
      version: 1,
      offerBech32: OfferFiles.encode(input.offerBytes),
      computed,
    };
    if (input.unverifiedMessage !== undefined) {
      payload.unverifiedMessage = input.unverifiedMessage;
    }
    return payload;
  }
}
