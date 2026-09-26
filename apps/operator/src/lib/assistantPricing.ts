/**
 * The owner assistant's price calculator (plan §5.6, contracts §Lane D).
 *
 * The app never invents a rate: `pricing` is `venue_settings.llm_pricing` as
 * `app.assistant_usage()` returns it — one entry per model, four rates in USD
 * micros per million tokens — and `fallbackMicrosPerMtok` is the venue's
 * blended `llm_cost_micros_per_mtok`, used only for a model the map does not
 * price. `UsageMeter` and `JobEstimateCard` call `priceFor`; nothing else
 * multiplies tokens by money.
 */

export interface TokenKinds {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
}

export const TOKEN_KINDS = ['input', 'cache_write', 'cache_read', 'output'] as const satisfies readonly (keyof TokenKinds)[];

/** USD micros per million tokens, one rate per kind. */
export type PricingRates = TokenKinds;

/** `venue_settings.llm_pricing`: model → rates. Partial entries are ignored. */
export type PricingMap = Record<string, Partial<PricingRates> | null | undefined>;

const MTOK = 1_000_000;

function fullRates(pricing: PricingMap | null | undefined, model: string): PricingRates | null {
  const entry = pricing?.[model];
  if (!entry) return null;
  for (const kind of TOKEN_KINDS) {
    if (typeof entry[kind] !== 'number' || !Number.isFinite(entry[kind])) return null;
  }
  return entry as PricingRates;
}

/** True when `model` is priced by the blended fallback rather than its own rates. */
export function isBlendedFallback(model: string, pricing: PricingMap | null | undefined): boolean {
  return fullRates(pricing, model) === null;
}

/**
 * Cost in USD micros for one usage record. Rates apply per kind; a model with
 * no full entry costs every token at the blended fallback. Rounded to whole
 * micros so sums across calls agree with the database's bigint arithmetic.
 */
export function priceFor(
  usage: { model: string } & Partial<TokenKinds>,
  pricing: PricingMap | null | undefined,
  fallbackMicrosPerMtok: number,
): number {
  const rates = fullRates(pricing, usage.model);
  let micros = 0;
  for (const kind of TOKEN_KINDS) {
    const tokens = usage[kind] ?? 0;
    const rate = rates ? rates[kind] : fallbackMicrosPerMtok;
    micros += (tokens * rate) / MTOK;
  }
  return Math.round(micros);
}

/** Sum four-kind usages; models are the caller's business. */
export function sumTokens(parts: readonly Partial<TokenKinds>[]): TokenKinds {
  const out: TokenKinds = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  for (const p of parts) for (const kind of TOKEN_KINDS) out[kind] += p[kind] ?? 0;
  return out;
}

export function totalTokens(t: Partial<TokenKinds>): number {
  return TOKEN_KINDS.reduce((n, kind) => n + (t[kind] ?? 0), 0);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * `$0.21`. Always Latin digits and the dollar sign in front: the figure is a
 * vendor invoice line, not venue money, and it is read the same in both
 * languages. Callers isolate it inside Arabic prose. A cost that rounds to
 * nothing but is not nothing shows as `<$0.01` so a run is never called free.
 */
export function formatUsd(micros: number): string {
  const dollars = micros / MTOK;
  if (dollars > 0 && dollars < 0.005) return '<$0.01';
  return usd.format(dollars);
}

/** `1.2k`, `340`, `2.5M` — token counts short enough for a checkbox label. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${trimZero((n / 1_000).toFixed(1))}k`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}
