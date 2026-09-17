/**
 * CourtAdminScreen (spec 06.47) — SOW L299-301: name, indoor/outdoor,
 * description, photograph, duration options per court. Writes via
 * app.upsert_court / app.reorder_courts (0062, audited) and app.delete_court
 * (0074). States: loading · ready · empty · error · busy · dirty · refused.
 *
 * WHAT CHANGED, AND WHY
 *
 *  - **The editor opens beside the list, not under it.** It used to render
 *    below the table, so on any real list "Edit" appeared to do nothing — the
 *    form was a full scroll away. It is now a sticky panel to the side, the
 *    way the rate card works, and the table drops to the columns that still
 *    fit while it is open.
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
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Skeleton } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { BilingualFields, SortButtons } from '../../../components/inputs';
import { Switch } from '../../../components/Switch';
import { ImageField } from '../../../components/ImageField';
import { DURATION_CHOICES, courtUsageFromError, durationsValid, moveAmongShown, toggleDuration, type CourtUsage } from './courtsLogic';

interface CourtAdminRow {
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
async function fetchUpcomingBookings(courtId: string): Promise<number> {
  const { count, error } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .in('status', ['pending', 'confirmed', 'arrived'])
    .gt('end_at', new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

export function CourtsAdmin() {
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
  const open = editing !== null;

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
      <PageHeader
        title={tr('op.courts.title')}
        subtitle={tr('ws.owner.courts.lead')}
        actions={
          <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
            {tr('ws.owner.courts.add')}
          </Button>
        }
      />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: open ? 'minmax(0, 1fr) minmax(22rem, 28rem)' : 'minmax(0, 1fr)', alignItems: 'start' }}>
        <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
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
        </div>

        {editing && (
          <CourtForm
            key={editing === 'new' ? 'new' : editing.id}
            court={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

function CourtForm({ court, onDone, onCancel }: { court: CourtAdminRow | null; onDone: () => void; onCancel: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [nameEn, setNameEn] = useState(court?.name_en ?? '');
  const [nameAr, setNameAr] = useState(court?.name_ar ?? '');
  const [descEn, setDescEn] = useState(court?.description_en ?? '');
  const [descAr, setDescAr] = useState(court?.description_ar ?? '');
  const [indoor, setIndoor] = useState(court?.indoor ?? true);
  const [active, setActive] = useState(court?.is_active ?? true);
  const [photo, setPhoto] = useState<string | null>(court?.photo_path ?? null);
  const [durations, setDurations] = useState<number[]>(court?.duration_options ?? [60, 90, 120]);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** COURT_IN_USE: a refusal, so the control stays and the counts are shown. */
  const [inUse, setInUse] = useState<CourtUsage | null>(null);

  // Only asked when an open court is being switched off — that is the one
  // change the server refuses while bookings are ahead.
  const switchingOff = court !== null && court.is_active && !active;
  const upcomingQ = useQuery({
    queryKey: ['courts', 'upcoming', court?.id],
    queryFn: () => fetchUpcomingBookings(court!.id),
    enabled: switchingOff,
    staleTime: 0,
  });
  const upcoming = switchingOff ? (upcomingQ.data ?? null) : null;
  const blockedByBookings = upcoming !== null && upcoming > 0;

  const dirty =
    nameEn !== (court?.name_en ?? '') ||
    nameAr !== (court?.name_ar ?? '') ||
    descEn !== (court?.description_en ?? '') ||
    descAr !== (court?.description_ar ?? '') ||
    indoor !== (court?.indoor ?? true) ||
    active !== (court?.is_active ?? true) ||
    photo !== (court?.photo_path ?? null) ||
    durations.join(',') !== (court?.duration_options ?? [60, 90, 120]).join(',');

  const courtName = court ? pickName(locale, court) : '';

  async function write(isActive: boolean) {
    await appRpc('upsert_court', {
      p_id: court?.id ?? null,
      p_name_en: nameEn,
      p_name_ar: nameAr,
      p_indoor: indoor,
      p_description_en: descEn || null,
      p_description_ar: descAr || null,
      p_photo_path: photo,
      p_duration_options: durations,
      p_is_active: isActive,
      // 0097: the window is passed back unchanged; the server stamps active_to
      // on deactivation and clears it when the court comes back.
      p_active_from: court?.active_from ?? null,
      p_active_to: court?.active_to ?? null,
    });
  }

  async function save() {
    if (switchingOff) {
      const ok = await confirm({
        title: tr('ws.owner.courts.offConfirm', { court: courtName }),
        body: tr('ws.owner.courts.offConfirmBody'),
        kind: 'danger',
        confirmLabel: tr('ws.owner.courts.offConfirmAction'),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      await write(active);
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!court) return;
    const ok = await confirm({
      title: tr('ws.owner.courts.deleteConfirm', { court: courtName }),
      body: tr('ws.owner.courts.deleteConfirmBody'),
      kind: 'danger',
      confirmLabel: tr('ws.owner.courts.delete'),
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    setInUse(null);
    try {
      await appRpc('delete_court', { p_id: court.id });
      toast.ok(tr('ws.owner.courts.deleted'));
      onDone();
    } catch (e) {
      // A refusal is not a failure: the court has history and must be
      // switched off instead, which the notice below offers directly.
      const usage = courtUsageFromError(e);
      if (usage) setInUse(usage);
      else setError(e);
    } finally {
      setDeleting(false);
    }
  }

  /** The way out of COURT_IN_USE, without making the operator hunt for it. */
  async function switchOffInstead() {
    if (!court) return;
    setDeleting(true);
    setError(null);
    try {
      await write(false);
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setDeleting(false);
    }
  }

  const namesMissing = !nameEn.trim() || !nameAr.trim();
  const saveBlocked = deleting || namesMissing || !durationsValid(durations) || blockedByBookings || (switchingOff && upcomingQ.isPending);

  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {court ? <bdi>{courtName}</bdi> : tr('op.courts.newTitle')}
          {dirty && <StatusBadge tone="warn" size="sm" label={tr('ws.owner.courts.unsaved')} />}
        </span>
      }
      actions={<Button kind="ghost" size="sm" icon="x" aria-label={tr('ws.owner.courts.close')} disabled={busy || deleting} onClick={onCancel} />}
      style={{ position: 'sticky', insetBlockStart: 'var(--tp-sp-2)' }}
      data-testid="court-editor"
    >
      {/* Labels stay "Name (English)" / "Name (Arabic)": the e2e suite and the
          desk staff both know them by those names. */}
      <BilingualFields labelEn={tr('op.courts.nameEn')} labelAr={tr('op.courts.nameAr')} en={nameEn} ar={nameAr} onEn={setNameEn} onAr={setNameAr} disabled={busy} maxLength={60} />
      <BilingualFields labelEn={tr('op.courts.descEn')} labelAr={tr('op.courts.descAr')} en={descEn} ar={descAr} onEn={setDescEn} onAr={setDescAr} disabled={busy} multiline maxLength={300} />
      <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlock: 'calc(-1 * var(--tp-sp-1)) var(--tp-sp-3)' }}>{tr('ws.owner.courts.descriptionHint')}</p>

      <Field label={tr('ws.owner.courts.typeLabel')} group>
        <SegmentedControl<'indoor' | 'outdoor'>
          value={indoor ? 'indoor' : 'outdoor'}
          onChange={(v) => setIndoor(v === 'indoor')}
          aria-label={tr('ws.owner.courts.typeLabel')}
          options={[
            { value: 'indoor', label: tr('op.courts.indoor'), disabled: busy },
            { value: 'outdoor', label: tr('op.courts.outdoor'), disabled: busy },
          ]}
        />
      </Field>

      <Field
        label={tr('ws.owner.courts.lengthsLabel')}
        group
        hint={tr('ws.owner.courts.lengthsHint')}
        error={durationsValid(durations) ? undefined : tr('ws.owner.courts.lengthsRequired')}
      >
        <div role="group" aria-label={tr('ws.owner.courts.lengthsLabel')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
          {DURATION_CHOICES.map((d) => (
            <Button key={d} size="sm" kind={durations.includes(d) ? 'primary' : 'default'} aria-pressed={durations.includes(d)} disabled={busy} onClick={() => setDurations((prev) => toggleDuration(prev, d))}>
              {tr('op.common.minutesShort', { minutes: d })}
            </Button>
          ))}
        </div>
      </Field>

      <ImageField label={tr('op.courts.photo')} value={photo} onChange={setPhoto} folder="courts" ownerId={court?.id ?? 'new'} aspect="16:9" disabled={busy} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Switch checked={active} onChange={setActive} label={tr('ws.owner.courts.openLabel')} disabled={busy} />
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{active ? tr('ws.owner.courts.openOnHint') : tr('ws.owner.courts.openOffHint')}</p>
        {switchingOff && upcomingQ.isPending && <Skeleton lines={1} blockSize="1.6rem" />}
        {switchingOff && upcomingQ.isError && <ErrorText error={upcomingQ.error} />}
        {blockedByBookings && (
          <MessagePresenter
            tone="refused"
            style={{ flexWrap: 'wrap' }}
            message={
              <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
                <span>{tr('ws.owner.courts.hasBookings', { count: formatNumber(upcoming, locale) })}</span>
                <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/desk' })}>
                  {tr('ws.owner.courts.openDesk')}
                </Button>
              </span>
            }
          />
        )}
      </div>

      <ErrorText error={error} />
      {inUse && (
        <MessagePresenter
          tone="refused"
          rise
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
          message={
            <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
              <span>
                {tr('ws.owner.courts.deleteInUse', {
                  court: courtName,
                  bookings: formatNumber(inUse.reservations, locale),
                  series: formatNumber(inUse.series, locale),
                  rules: formatNumber(inUse.rate_rules, locale),
                })}
              </span>
              <span>{tr('ws.owner.courts.deleteInUseFix')}</span>
              {court?.is_active && (
                <Button size="sm" icon="ban" busy={deleting} disabled={busy} onClick={() => void switchOffInstead()}>
                  {tr('ws.owner.courts.deactivate')}
                </Button>
              )}
            </span>
          }
        />
      )}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Destructive, so it sits apart from the pair that saves — inline-start
            edge, and only on a court that already exists. */}
        {court && (
          <Button kind="ghost" icon="trash" busy={deleting} disabled={busy} style={{ marginInlineEnd: 'auto', color: 'var(--tp-danger-fg)' }} onClick={() => void remove()}>
            {tr('ws.owner.courts.delete')}
          </Button>
        )}
        <Button onClick={onCancel} disabled={busy || deleting}>
          {dirty ? tr('ws.owner.courts.discard') : tr('ws.owner.courts.close')}
        </Button>
        <Button
          kind="primary"
          icon="check"
          busy={busy}
          disabled={saveBlocked}
          // Rulebook 4.3. The button was dead with nothing said about it, on a
          // form where the blocking field can be scrolled off the screen.
          disabledReason={
            namesMissing
              ? tr('ws.manager.disabled.namesRequired')
              : !durationsValid(durations)
                ? tr('ws.manager.disabled.durationsRequired')
                : blockedByBookings
                  ? tr('ws.owner.courts.saveBlockedBookings')
                  : undefined
          }
          onClick={() => void save()}
        >
          {court ? tr('common.save') : tr('ws.owner.courts.create')}
        </Button>
      </div>
    </Panel>
  );
}
