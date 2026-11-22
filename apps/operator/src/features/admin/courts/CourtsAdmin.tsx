/**
 * CourtAdminScreen (spec 06.47) — SOW L299-301: name, indoor/outdoor,
 * description, photograph, duration options per court. Writes via
 * app.upsert_court / app.reorder_courts (0062, audited) and app.delete_court
 * (0074). States: loading · ready · empty · error · busy · dirty · refused.
 *
 * WHAT CHANGED, AND WHY
 *
 *  - **Adding and editing are the stepped wizard** (CourtWizard.tsx), the
 *    dialog every "add new" form uses. It used to be a side panel; selecting a
 *    court now opens the same wizard, filled from the saved court.
 *  - **Switching a court off is said, checked and confirmed.** The switch was
 *    labelled "Active" and saved silently; a court with upcoming bookings came
 *    back as a refusal only after Apply (0062 COURT_HAS_FUTURE_RESERVATIONS).
 *    The panel now counts the court's upcoming bookings the moment the switch
 *    goes off, names the number, sends the owner to the desk to move them, and
 *    asks before a court with none leaves the calendar.
 *  - **Switched-off courts fold away** behind one button, like switched-off
 *    rate rules, so the list is the courts guests can book.
 *  - Indoor/outdoor is a choice of two words, not a switch named "Indoor"
 *    whose off state meant "Outdoor".
 *
 * Delete stays in the EDITOR, not in the row. A destructive action on a row
 * you have not opened is a misclick waiting to happen next to the reorder
 * arrows, and the refusal it can come back with needs somewhere to be read: a
 * court that has ever been booked cannot be deleted (the reports still read its
 * name off the reservation), so COURT_IN_USE is rendered with its counts and
 * switching it off is offered in the same breath.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { CourtWizard } from './CourtWizard';
import { SortButtons } from '../../../components/inputs';
import { InfoTip } from '../../../components/InfoTip';
import { moveAmongShown } from './courtsLogic';

export interface CourtAdminRow {
  id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  indoor: boolean;
  photo_path: string | null;
  duration_options: number[];
  sort_order: number;
  is_active: boolean;
  /** 0097: the days the court counts as open for occupancy; NULL = unbounded. */
  active_from: string | null;
  active_to: string | null;
}

/** ALL rows incl. inactive — deliberately not QK.courts (active-only, other shape). */
const ALL_COURTS_KEY = ['courts', 'all'] as const;

async function fetchAllCourts(): Promise<CourtAdminRow[]> {
  const { data, error } = await supabase
    .from('courts')
    .select('id, name_en, name_ar, description_en, description_ar, indoor, photo_path, duration_options, sort_order, is_active, active_from, active_to')
    .order('sort_order');
  if (error) throw error;
  return data as CourtAdminRow[];
}

/**
 * The bookings that stop a court being switched off: the same statuses and
 * the same "has not ended yet" test app.upsert_court refuses on (0062), so the
 * number the panel shows is the number the server would name.
 */
export async function fetchUpcomingBookings(courtId: string): Promise<number> {
  const { count, error } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .in('status', ['pending', 'confirmed', 'arrived'])
    .gt('end_at', new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** `embedded`: one card of the Courts page (the prices are the other), so the list sits in a banded Panel instead of under a page header. */
export function CourtsAdmin({ embedded }: { embedded?: boolean } = {}) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<CourtAdminRow | 'new' | null>(null);
  const [showOff, setShowOff] = useState(false);

  const courtsQ = useQuery({ queryKey: ALL_COURTS_KEY, queryFn: fetchAllCourts });
  const rows = courtsQ.data ?? [];
  const offCount = rows.filter((r) => !r.is_active).length;
  // The court being edited stays listed even when it is switched off and folded.
  const shown = showOff ? rows : rows.filter((r) => r.is_active || (editing !== null && editing !== 'new' && editing.id === r.id));
  // Adding and editing are both the wizard dialog, so the list never narrows for a side panel.
  const open = false;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['courts'] });
  }

  const reorder = useMutation({
    mutationFn: (ids: string[]) => appRpc('reorder_courts', { p_ids: ids }),
    onSettled: refresh,
    onError: (e) => toast.err(e),
  });

  function move(id: string, delta: -1 | 1) {
    const next = moveAmongShown(
      rows.map((r) => r.id),
      shown.map((r) => r.id),
      id,
      delta,
    );
    if (next) reorder.mutate(next);
  }

  const lengths = (c: CourtAdminRow) => c.duration_options.map((d) => tr('op.common.minutesShort', { minutes: formatNumber(d, locale) })).join(' · ');

  const columns: Column<CourtAdminRow>[] = [
    {
      key: 'order',
      header: tr('ws.owner.courts.columns.order'),
      width: '5.5rem',
      render: (c) => {
        const i = shown.indexOf(c);
        return (
          <SortButtons
            onUp={() => move(c.id, -1)}
            onDown={() => move(c.id, 1)}
            disabledUp={i === 0 || reorder.isPending}
            disabledDown={i === shown.length - 1 || reorder.isPending}
          />
        );
      },
    },
    {
      key: 'name',
      header: tr('ws.owner.courts.columns.name'),
      render: (c) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600, color: c.is_active ? undefined : 'var(--tp-muted-fg)' }}>{pickName(locale, c)}</bdi>
          {!open && (c.description_en || c.description_ar) && (
            <bdi style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{locale === 'ar' ? c.description_ar || c.description_en : c.description_en || c.description_ar}</bdi>
          )}
        </span>
      ),
    },
    ...(open
      ? []
      : ([
          { key: 'type', header: tr('ws.owner.courts.columns.type'), render: (c) => tr(c.indoor ? 'op.courts.indoor' : 'op.courts.outdoor') },
          { key: 'durations', header: tr('ws.owner.courts.columns.durations'), render: (c) => <bdi>{lengths(c)}</bdi> },
        ] satisfies Column<CourtAdminRow>[])),
    {
      key: 'status',
      header: tr('ws.owner.courts.columns.status'),
      width: '9rem',
      render: (c) =>
        c.is_active ? (
          <StatusBadge tone="success" size="sm" label={tr('ws.owner.courts.bookable')} />
        ) : (
          <StatusBadge tone="neutral" size="sm" label={tr('ws.owner.courts.switchedOff')} />
        ),
    },
    {
      key: 'actions',
      header: <span className="tp-sr-only">{tr('ws.owner.courts.columns.actions')}</span>,
      align: 'end',
      width: '6rem',
      render: (c) => (
        <Button size="sm" icon="note" onClick={() => setEditing(c)}>
          {tr('op.common.edit')}
        </Button>
      ),
    },
  ];
  // While the editor is open a row click moves it to another court, and the
  // Edit column only squeezed the status badge off the edge at 1100px.
  const tableColumns = open ? columns.filter((c) => c.key !== 'actions') : columns;

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={tr('op.courts.title')}
          subtitle={tr('ws.owner.courts.lead')}
          actions={
            <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
              {tr('ws.owner.courts.add')}
            </Button>
          }
        />
      )}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: open ? 'minmax(0, 1fr) minmax(22rem, 28rem)' : 'minmax(0, 1fr)', alignItems: 'start' }}>
        <CardOrBare
          embedded={embedded}
          title={tr('op.courts.title')}
          info={tr('ws.owner.courts.lead')}
          actions={
            <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
              {tr('ws.owner.courts.add')}
            </Button>
          }
        >
          <AsyncStateWrapper
            status={asyncStatus(courtsQ, (d) => d.length === 0)}
            error={courtsQ.error}
            onRetry={() => void courtsQ.refetch()}
            skeleton={<TableSkeleton columns={columns} />}
            emptyContent={
              <EmptyState
                icon="court"
                title={tr('ws.owner.courts.emptyTitle')}
                body={tr('ws.owner.courts.emptyBody')}
                action={
                  <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
                    {tr('ws.owner.courts.add')}
                  </Button>
                }
              />
            }
          >
            <DataTable
              columns={tableColumns}
              rows={shown}
              rowKey={(c) => c.id}
              selectedKey={editing && editing !== 'new' ? editing.id : null}
              onRowClick={(c) => setEditing(c)}
              aria-label={tr('op.courts.title')}
            />
            <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.courts.orderNote')}</p>
              {offCount > 0 && (
                <Button size="sm" kind="ghost" style={{ marginInlineStart: 'auto' }} onClick={() => setShowOff((v) => !v)}>
                  {showOff ? tr('ws.owner.courts.hideOff') : tr('ws.owner.courts.showOff', { count: formatNumber(offCount, locale) })}
                </Button>
              )}
            </div>
          </AsyncStateWrapper>
        </CardOrBare>

        {editing && (
          <CourtWizard
            key={editing === 'new' ? 'new' : editing.id}
            court={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

/** The list's wrapper: a blue-band card on the merged Courts page, the bare column on its own. */
function CardOrBare({ embedded, title, info, actions, children }: { embedded?: boolean; title: string; info: string; actions: ReactNode; children: ReactNode }) {
  if (!embedded) return <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>{children}</div>;
  return (
    <Panel title={title} titleEnd={<InfoTip content={info} />} actions={actions} style={{ minInlineSize: 0 }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>{children}</div>
    </Panel>
  );
}
