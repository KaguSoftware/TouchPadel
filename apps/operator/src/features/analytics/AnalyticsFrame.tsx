/**
 * The frame both analytics tabs share: the page title with the date range
 * under it, then the Courts | Cafe strip. Everything below (filters, zones)
 * belongs to the tab. The frame scrolls away; a tab's own filter bar is what
 * stays sticky.
 */
import type { ReactNode } from 'react';
import { PageHeader } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { AnalyticsTabs, type AnalyticsTab } from './AnalyticsTabs';

export function AnalyticsFrame({ tab, subtitle, children }: { tab: AnalyticsTab; subtitle?: ReactNode; children: ReactNode }) {
  const { tr } = useLocale();
  return (
    <div style={{ minInlineSize: '1024px', paddingInline: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-6)' }}>
      <PageHeader title={tr('analytics.title')} subtitle={subtitle}>
        <AnalyticsTabs value={tab} />
      </PageHeader>
      {children}
    </div>
  );
}
