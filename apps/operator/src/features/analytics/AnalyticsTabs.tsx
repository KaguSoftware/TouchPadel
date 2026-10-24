/**
 * The Courts | Cafe | People switcher: a `role="tablist"` drawn as the shared segmented
 * control (.tp-seg in GlobalStyles; the chosen tab is the green segment).
 * The page is owner-only, so there is no role filtering, and navigation keeps
 * the search params, so the period, compare basis and court filter survive a
 * tab switch.
 */
import type { KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLocale } from '../../lib/i18n';
import { Icon, type IconName } from '../../components/icons';
import { validateSearch } from './search';

export type AnalyticsTab = 'courts' | 'cafe' | 'people';

export const ANALYTICS_TABS: readonly { id: AnalyticsTab; path: '/analytics/courts' | '/analytics/cafe' | '/analytics/people'; icon: IconName }[] = [
  { id: 'courts', path: '/analytics/courts', icon: 'court' },
  { id: 'cafe', path: '/analytics/cafe', icon: 'cake' },
  // 0369: who the customers are (Majed 2026-10-24).
  { id: 'people', path: '/analytics/people', icon: 'users' },
];

export function AnalyticsTabs({ value }: { value: AnalyticsTab }) {
  const { tr, dir } = useLocale();
  const navigate = useNavigate();

  const open = (id: AnalyticsTab) => {
    const target = ANALYTICS_TABS.find((t) => t.id === id);
    // Re-validating the current params (rather than spreading them) keeps the
    // typed search shape and drops anything another route left in the URL.
    if (target && id !== value) void navigate({ to: target.path, search: (prev) => validateSearch(prev as Record<string, unknown>) });
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = ANALYTICS_TABS.findIndex((t) => t.id === value);
    if (index === -1) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (e.key === forward) next = (index + 1) % ANALYTICS_TABS.length;
    else if (e.key === backward) next = (index - 1 + ANALYTICS_TABS.length) % ANALYTICS_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ANALYTICS_TABS.length - 1;
    else return;
    e.preventDefault();
    open(ANALYTICS_TABS[next]!.id);
  }

  return (
    <div role="tablist" aria-label={tr('analytics.title')} onKeyDown={onKeyDown} className="tp-seg">
      {ANALYTICS_TABS.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tp-seg-btn"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => open(tab.id)}
          >
            <Icon name={tab.icon} size={16} />
            {tr(`ws.analytics.tabs.${tab.id}`)}
          </button>
        );
      })}
    </div>
  );
}
