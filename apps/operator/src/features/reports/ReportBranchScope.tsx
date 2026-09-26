/**
 * The owner's branch scope for reports and analytics (multi-venue slice 4, MV8).
 *
 * Every screen shows the branch in the rail switcher. On the report and
 * analytics pages the owner may widen that to every branch: the requests then
 * carry x-venue-scope 'all' (lib/venueScope.ts) and the server's report scope
 * (app.report_venues, 0214/0226) covers every branch. Leaving the pages puts
 * the scope back, so a till or desk never sees two branches. Clock-and-hours
 * figures (occupancy, business days) use one branch's clock, which the note
 * names.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { useLocale, pickName } from '../../lib/i18n';
import { useVenue } from '../../lib/venue';
import { setReportAllBranches } from '../../lib/venueScope';
import { SegmentedControl } from '../../components/kit';

export function ReportBranchScope() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { venues, current } = useVenue();
  const queryClient = useQueryClient();
  const [all, setAll] = useState(false);
  const show = staff?.role === 'owner' && venues.length > 1 && current !== null;

  useEffect(() => {
    setReportAllBranches(show && all);
    // Every figure on these pages reloads under the new scope.
    void queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && /^(reports|analytics|panel)/.test(q.queryKey[0] as string),
    });
  }, [all, show, queryClient]);

  // Leaving reports and analytics: the rest of the app is one branch again.
  useEffect(() => () => setReportAllBranches(false), []);

  if (!show || !current) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-2)' }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.branches.reports.scope')}</span>
      <SegmentedControl<'one' | 'all'>
        value={all ? 'all' : 'one'}
        onChange={(v) => setAll(v === 'all')}
        options={[
          { value: 'one', label: pickName(locale, current) },
          { value: 'all', label: tr('ws.branches.reports.all') },
        ]}
        aria-label={tr('ws.branches.reports.scope')}
      />
      {all && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.branches.reports.clockNote', { name: pickName(locale, current) })}
        </span>
      )}
    </div>
  );
}
