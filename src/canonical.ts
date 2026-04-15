/**
 * RFC 8785 canonical JSON — subset sufficient for OfferPayload.
 *
 * `OfferPayload` contains only JSON primitives (strings, numbers, booleans, null),
 * arrays, and plain objects, so a full RFC 8785 implementation (which must deal
 * with number normalisation edge cases) is not needed. This function:
 *
 *   - sorts object keys lexicographically by UTF-16 code units (the default for
 *     Array.prototype.sort on strings — matches RFC 8785 §3.2.3)
 *   - drops properties whose value is `undefined` (matches JSON.stringify)
 *   - serialises strings via JSON.stringify (RFC 8785 uses the same escape rules
 *     that JSON.stringify in modern runtimes produces, with the caveat that
 *     RFC 8785 requires the shortest form for non-ASCII — which JSON.stringify
 *     does not guarantee for lone surrogates. The OfferPayload schema contains
 *     only hex, ISO-8601 and bech32m strings, none of which exercise that edge).
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error('canonicalJson: undefined is not a JSON value');
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`,
  );
  return `{${pairs.join(',')}}`;
}
