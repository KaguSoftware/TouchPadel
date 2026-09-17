/**
 * The frame both analytics tabs share: the page title, and under it the
 * period AND the window every change is measured against ("19 Aug – 17 Sept,
 * compared with 20 Jul – 18 Aug"). The tiles used to repeat "vs 20 Jul – 18
 * Aug" under every figure; it is said once, here, the way the management
 * panel says it. The Courts | Cafe strip, the filters and the section jump-nav
 * live in the sticky AnalyticsBar each tab renders right below, so the tabs
 * stay in reach however far down the page the owner has scrolled.
 */
import type { ReactNode } from 'react';
import type { DateRange } from '@touch/core';
import { PageHeader } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import type { Formatters } from './format';

export function AnalyticsFrame({ subtitle, actions, children }: { subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { tr } = useLocale();
  return (
    <div style={{ minInlineSize: 0, paddingInline: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-6)' }}>
      <PageHeader title={tr('analytics.title')} subtitle={subtitle} actions={actions} />
      {children}
    </div>
  );
}

/** "19 Aug – 17 Sept, compared with 20 Jul – 18 Aug". */
export function usePeriodLine(f: Formatters, range: DateRange, compareRange: DateRange): string {
  const { tr } = useLocale();
  return tr('ws.analytics.period', { range: f.dateRange(range.from, range.to), compare: f.dateRange(compareRange.from, compareRange.to) });
}
