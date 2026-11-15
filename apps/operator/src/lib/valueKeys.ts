/**
 * Idempotency keys bound to the values a write sends (F-13). One key per form
 * replayed the FIRST answer after a lost one (app.claim_replay compares no
 * payload), so a retry with a corrected amount recorded the old values while
 * the screen named the new ones. Wages, the safe, hand-in, shop products, plan
 * ideas, deductions and content all key their writes through this one helper.
 */
/**
 * The key for these values: an unchanged retry keeps its key (never writes
 * twice), a changed draft gets its own, and values already sent reuse theirs.
 * `keys` is the form's own map (a ref), `mint` makes a fresh key.
 */
export function keyForValues(keys: Map<string, string>, values: readonly unknown[], mint: () => string): string {
  const fingerprint = JSON.stringify(values);
  const known = keys.get(fingerprint);
  if (known !== undefined) return known;
  const key = mint();
  keys.set(fingerprint, key);
  return key;
}
