/**
 * The parameter set of an analytics component (plan §5.4, migration 0115).
 *
 * The page and the server must agree on the identity of a card's content, so
 * the object built here is CANONICAL: exactly these keys, an optional key
 * absent rather than null or undefined. The server hashes the same object
 * (app.assistant_params_hash strips nulls and sorts keys) and TanStack Query
 * hashes it with sorted keys, so the client cache and the server cache name
 * the same thing. The client never computes the hash.
 */
import type { CompareBasis, DateRange } from '@touch/core';
import type { Locale } from '@touch/i18n';

export type ComponentCompare = 'previousPeriod' | 'sameLastYear';
export type ComponentScope = 'cafe' | 'courts';
export type ComponentLang = 'en' | 'ar';

export interface ComponentParams {
  from: string;
  to: string;
  lang: ComponentLang;
  compare?: ComponentCompare;
  scope?: ComponentScope;
  court?: string;
}

/**
 * The page's comparison basis in the tools' vocabulary. `4w` (four weeks
 * earlier) has no tool equivalent and falls back to the previous period; the
 * card's note says which basis it read.
 */
export function compareForBasis(basis: CompareBasis | null | undefined): ComponentCompare {
  return basis === '52w' ? 'sameLastYear' : 'previousPeriod';
}

export function componentParams(input: {
  range: DateRange;
  compareBasis?: CompareBasis | null;
  scope?: ComponentScope | null;
  courtId?: string | null;
  locale: Locale;
}): ComponentParams {
  const p: ComponentParams = {
    from: input.range.from,
    to: input.range.to,
    lang: input.locale === 'ar' ? 'ar' : 'en',
    compare: compareForBasis(input.compareBasis),
  };
  if (input.scope) p.scope = input.scope;
  if (input.courtId) p.court = input.courtId.toLowerCase();
  return p;
}

/** The query key: the analytics tree, then the component and its canonical parameters. */
export function componentQueryKey(key: string, params: ComponentParams) {
  return ['analytics', 'component', key, params] as const;
}

export const PINNED_COMPONENTS_KEY = ['analytics', 'components', 'pinned'] as const;
export const COMPONENT_PRICING_KEY = ['analytics', 'components', 'pricing'] as const;
