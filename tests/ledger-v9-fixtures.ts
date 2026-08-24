import {
  Transaction,
  ZswapOffer,
  ZswapOutput,
  createShieldedCoinInfo,
  sampleCoinPublicKey,
  sampleEncryptionPublicKey,
} from "@midnightntwrk/ledger-v9";

export const LEDGER_V9_NETWORK_ID = "undeployed";

export function makeUnprovenShieldedOutputOffer(
  value: bigint,
  tokenType = "11".repeat(32),
) {
  const coin = createShieldedCoinInfo(tokenType, value);
  const output = ZswapOutput.new(
    coin,
    undefined,
    sampleCoinPublicKey(),
    sampleEncryptionPublicKey(),
  );
  return Transaction.fromParts(
    LEDGER_V9_NETWORK_ID,
    ZswapOffer.fromOutput(output),
  );
}

export function makeFinalizedShieldedOutputOffer(
  value: bigint,
  tokenType = "11".repeat(32),
) {
  return makeUnprovenShieldedOutputOffer(value, tokenType).mockProve();
}
