/**
 * Where each suggestion opens (contracts §1). PURE: plain route objects, so
 * vitest can pin them. The Play tab reads `show` to pick its chip; the Coaches
 * tab preselects the guest's level from the play profile itself.
 */
import type { SuggestionKind } from './suggest';

export type SuggestionTarget =
  | { kind: 'tab'; href: { pathname: '/play'; params: { show: 'matches' | 'tournaments' } } | { pathname: '/coaches' } }
  | { kind: 'push'; href: { pathname: '/classes' } };

export function suggestionTarget(kind: SuggestionKind): SuggestionTarget {
  switch (kind) {
    case 'coaches':
      return { kind: 'tab', href: { pathname: '/coaches' } };
    case 'classes':
      return { kind: 'push', href: { pathname: '/classes' } };
    case 'matches':
      return { kind: 'tab', href: { pathname: '/play', params: { show: 'matches' } } };
    case 'americano':
    case 'mexicano':
      return { kind: 'tab', href: { pathname: '/play', params: { show: 'tournaments' } } };
  }
}
