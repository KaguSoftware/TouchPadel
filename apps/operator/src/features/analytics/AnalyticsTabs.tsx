/**
 * The Courts | Cafe switcher. Same bordered-button look and the same
 * `role="tablist"` contract as the report switcher (.tp-report-tab in
 * GlobalStyles), with three deliberate differences: no role or section
 * filtering (the page is owner-only), no "fewer than two" early return, and
 * navigation keeps the search params, so the period, compare basis and court
 * filter survive a tab switch.
 */
import type { KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLocale } from '../../lib/i18n';
import { Icon, type IconName } from '../../components/icons';

export type AnalyticsTab = 'courts' | 'cafe';

export const ANALYTICS_TABS: readonly { id: AnalyticsTab; path: '/analytics/courts' | '/analytics/cafe'; icon: IconName }[] = [
  { id: 'courts', path: '/analytics/courts', icon: 'court' },
  { id: 'cafe', path: '/analytics/cafe', icon: 'cake' },
];

export function AnalyticsTabs({ value }: { value: AnalyticsTab }) {
  const { tr, dir } = useLocale();
  const navigate = useNavigate();

  const open = (id: AnalyticsTab) => {
    const target = ANALYTICS_TABS.find((t) => t.id === id);
    if (target && id !== value) void navigate({ to: target.path, search: (prev) => prev });
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
    <div
      role="tablist"
      aria-label={tr('analytics.title')}
      onKeyDown={onKeyDown}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(9.5rem, 13rem))', gap: 'var(--tp-sp-2)' }}
    >
      {ANALYTICS_TABS.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tp-report-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => open(tab.id)}
          >
            <span className="tp-report-tab-icon" aria-hidden="true">
              <Icon name={tab.icon} size={16} />
            </span>
            <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tr(`ws.analytics.tabs.${tab.id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
