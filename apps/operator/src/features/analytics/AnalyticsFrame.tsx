/**
 * The frame both analytics tabs share: the page title with the date range
 * under it. The Courts | Cafe strip, the filters and the zone jump-nav live in
 * the sticky AnalyticsBar each tab renders right below, so the tabs stay in
 * reach however far down the page the owner has scrolled.
 */
import type { ReactNode } from 'react';
import { PageHeader } from '../../components/kit';
import { useLocale } from '../../lib/i18n';

export function AnalyticsFrame({ subtitle, children }: { subtitle?: ReactNode; children: ReactNode }) {
  const { tr } = useLocale();
  return (
    <div style={{ minInlineSize: '1024px', paddingInline: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-6)' }}>
      <PageHeader title={tr('analytics.title')} subtitle={subtitle} />
      {children}
    </div>
  );
}
