/**
 * Read-only staff roster (operator-slice.md §3h). Invites and role changes
 * stay in the Supabase dashboard for this slice (service role required).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { ErrorText, Skeleton, card } from '../../../components/ui';

interface StaffRow {
  id: string;
  display_name: string;
  role: StaffRole;
  is_active: boolean;
}

export function StaffList() {
  const { tr } = useLocale();
  const staffQ = useQuery({
    queryKey: ['staffList'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, display_name, role, is_active')
        .order('is_active', { ascending: false })
        .order('display_name');
      if (error) throw error;
      return (data ?? []) as StaffRow[];
    },
  });

  const cell: React.CSSProperties = {
    paddingBlock: '0.45rem',
    paddingInline: '0.5rem',
    borderBlockEnd: '1px solid var(--tp-border)',
    textAlign: 'start',
  };

  return (
    <div style={{ maxInlineSize: '36rem' }}>
      <h2 style={{ marginBlockStart: 0 }}>{tr('op.staff.title')}</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>{tr('op.staff.hint')}</p>
      <ErrorText error={staffQ.error} />
      {staffQ.isLoading && <Skeleton lines={4} />}
      {staffQ.isSuccess && staffQ.data.length === 0 && <p>{tr('op.staff.empty')}</p>}
      {staffQ.isSuccess && staffQ.data.length > 0 && (
        <div style={{ ...card, paddingBlock: 0, paddingInline: 0, overflowX: 'auto' }}>
          <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '0.75rem', color: 'var(--tp-muted-fg)' }}>
                <th style={cell}>{tr('op.staff.name')}</th>
                <th style={cell}>{tr('op.staff.role')}</th>
                <th style={cell}>{tr('op.staff.active')}</th>
              </tr>
            </thead>
            <tbody>
              {staffQ.data.map((s) => (
                <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                  <td style={cell}>{s.display_name}</td>
                  <td style={cell}>{tr(`op.roles.${s.role}`)}</td>
                  <td style={cell}>{s.is_active ? tr('op.staff.active') : tr('op.staff.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
