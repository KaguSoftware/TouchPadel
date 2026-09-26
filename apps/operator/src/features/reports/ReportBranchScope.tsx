/**
 * The owner's branch scope for reports and analytics (multi-venue slice 4, MV8).
 *
 * Every screen shows the branch in the rail switcher. On the report and
 * analytics pages the owner may widen that to every branch, or look back at a
 * branch that has closed (0228, A2): the report calls then carry
 * x-venue-scope 'all:<rail branch>' or the closed branch's id
 * (lib/venueScope.ts), and the server's report scope (app.report_venues)
 * follows. Only the report, analytics and panel calls carry it, so nothing else
 * on the page (badges, the court filter, the heartbeat) ever sees two
 * branches. Leaving the pages puts the scope back. Clock-and-hours figures
 * (occupancy, business days) under "All branches" use the rail branch's clock,
 * which the note names.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { useLocale, pickName } from '../../lib/i18n';
import { useVenue, type VenueRow } from '../../lib/venue';
import { supabase } from '../../lib/supabase';
import { setReportScope } from '../../lib/venueScope';
import { SegmentedControl } from '../../components/kit';

const REPORT_QUERY = /^(reports|analytics|panel)/;

export function ReportBranchScope() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { venues, current } = useVenue();
  const queryClient = useQueryClient();
  const isOwner = staff?.role === 'owner';
  const [scope, setScope] = useState<'one' | 'all' | string>('one');

  // Closed branches keep their history; the owner can still read it.
  const closedQ = useQuery({
    queryKey: ['venues', 'closed', staff?.id ?? null],
    enabled: isOwner,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Pick<VenueRow, 'id' | 'name_en' | 'name_ar'>[]> => {
      const { data, error } = await supabase
        .from('venues')
        .select('id, name_en, name_ar')
        .eq('status', 'closed')
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as Pick<VenueRow, 'id' | 'name_en' | 'name_ar'>[];
    },
  });
  const closed = closedQ.data ?? [];
  const show = isOwner && current !== null && (venues.length > 1 || closed.length > 0);

  // Every figure on these pages reloads under a NEW scope. The first run is not
  // a change: the pages' own queries are already in flight for the rail branch.
  const first = useRef(true);
  useEffect(() => {
    setReportScope(show && scope !== 'one' ? scope : null);
    if (first.current) {
      first.current = false;
      return;
    }
    void queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && REPORT_QUERY.test(q.queryKey[0] as string),
    });
  }, [scope, show, queryClient]);

  // Leaving reports and analytics: the rest of the app is one branch again.
  useEffect(() => () => setReportScope(null), []);

  if (!show || !current) return null;
  const options: { value: string; label: string }[] = [{ value: 'one', label: pickName(locale, current) }];
  if (venues.length > 1) options.push({ value: 'all', label: tr('ws.branches.reports.all') });
  for (const v of closed) {
    options.push({ value: v.id, label: tr('ws.branches.reports.closedBranch', { name: pickName(locale, v) }) });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-2)' }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.branches.reports.scope')}</span>
      <SegmentedControl<string>
        value={scope}
        onChange={(v) => setScope(v)}
        options={options}
        aria-label={tr('ws.branches.reports.scope')}
      />
      {scope === 'all' && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.branches.reports.clockNote', { name: pickName(locale, current) })}
        </span>
      )}
    </div>
  );
}
