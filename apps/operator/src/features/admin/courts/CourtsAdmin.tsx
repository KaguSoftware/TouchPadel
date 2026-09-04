/**
 * CourtAdminScreen (spec 06.47) — SOW L299-301: name, indoor/outdoor,
 * description, photograph, duration options per court. Writes via
 * app.upsert_court / app.reorder_courts (0062, audited). The list is a
 * DataTable; one court opens in an inline editor below it with paired EN/AR
 * fields. States: loading · ready · empty · error · busy · dirty.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Field } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, Panel, StatusBadge, asyncStatus, type Column } from '../../../components/kit';
import { BilingualFields, SortButtons } from '../../../components/inputs';
import { Switch } from '../../../components/Switch';
import { ImageField } from '../../../components/ImageField';
import { DURATION_CHOICES, durationsValid, toggleDuration } from './courtsLogic';

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
}

/** ALL rows incl. inactive — deliberately not QK.courts (active-only, other shape). */
const ALL_COURTS_KEY = ['courts', 'all'] as const;

async function fetchAllCourts(): Promise<CourtAdminRow[]> {
  const { data, error } = await supabase
    .from('courts')
    .select('id, name_en, name_ar, description_en, description_ar, indoor, photo_path, duration_options, sort_order, is_active')
    .order('sort_order');
  if (error) throw error;
  return data as CourtAdminRow[];
}

export function CourtsAdmin() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<CourtAdminRow | 'new' | null>(null);

  const courtsQ = useQuery({ queryKey: ALL_COURTS_KEY, queryFn: fetchAllCourts });
  const rows = courtsQ.data ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['courts'] });
  }

  const reorder = useMutation({
    mutationFn: (ids: string[]) => appRpc('reorder_courts', { p_ids: ids }),
    onSettled: refresh,
    onError: (e) => toast.err(e),
  });

  function move(id: string, delta: -1 | 1) {
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    reorder.mutate(ids);
  }

  const durationsText = (c: CourtAdminRow) => c.duration_options.map((d) => tr('op.common.minutesShort', { minutes: d })).join(' / ');

  const columns: Column<CourtAdminRow>[] = [
    {
      key: 'order',
      header: tr('ws.owner.courts.columns.order'),
      width: '5.5rem',
      render: (c) => {
        const i = rows.indexOf(c);
        return <SortButtons onUp={() => move(c.id, -1)} onDown={() => move(c.id, 1)} disabledUp={i === 0 || reorder.isPending} disabledDown={i === rows.length - 1 || reorder.isPending} />;
      },
    },
    {
      key: 'name',
      header: tr('ws.owner.courts.columns.name'),
      render: (c) => (
        <span style={{ display: 'grid', gap: '0.1rem' }}>
          <bdi style={{ fontWeight: 600 }}>{pickName(locale, c)}</bdi>
          {(c.description_en || c.description_ar) && (
            <bdi style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{locale === 'ar' ? c.description_ar || c.description_en : c.description_en || c.description_ar}</bdi>
          )}
        </span>
      ),
    },
    { key: 'type', header: tr('ws.owner.courts.columns.type'), render: (c) => tr(c.indoor ? 'op.courts.indoor' : 'op.courts.outdoor') },
    { key: 'durations', header: tr('ws.owner.courts.columns.durations'), render: (c) => <span dir="ltr">{durationsText(c)}</span> },
    {
      key: 'status',
      header: tr('ws.owner.courts.columns.status'),
      width: '7rem',
      render: (c) => (c.is_active ? <StatusBadge tone="success" size="sm" label={tr('op.courts.active')} /> : <StatusBadge tone="neutral" size="sm" label={tr('op.courts.inactive')} />),
    },
    {
      key: 'actions',
      header: tr('ws.owner.courts.columns.actions'),
      align: 'end',
      render: (c) => (
        <Button size="sm" icon="note" onClick={() => setEditing(c)}>
          {tr('op.common.edit')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader
        title={tr('op.courts.title')}
        subtitle={tr('ws.owner.courts.lead')}
        actions={
          <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
            {tr('op.common.add')}
          </Button>
        }
      />
      <AsyncStateWrapper
        status={asyncStatus(courtsQ, (d) => d.length === 0)}
        error={courtsQ.error}
        onRetry={() => void courtsQ.refetch()}
        emptyContent={
          <EmptyState icon="court" title={tr('ws.owner.courts.emptyTitle')} body={tr('ws.owner.courts.emptyBody')} action={<Button kind="primary" onClick={() => setEditing('new')}>{tr('op.common.add')}</Button>} />
        }
      >
        <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} selectedKey={editing && editing !== 'new' ? editing.id : null} aria-label={tr('op.courts.title')} />
      </AsyncStateWrapper>

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
  );
}

function CourtForm({ court, onDone, onCancel }: { court: CourtAdminRow | null; onDone: () => void; onCancel: () => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const [nameEn, setNameEn] = useState(court?.name_en ?? '');
  const [nameAr, setNameAr] = useState(court?.name_ar ?? '');
  const [descEn, setDescEn] = useState(court?.description_en ?? '');
  const [descAr, setDescAr] = useState(court?.description_ar ?? '');
  const [indoor, setIndoor] = useState(court?.indoor ?? true);
  const [active, setActive] = useState(court?.is_active ?? true);
  const [photo, setPhoto] = useState<string | null>(court?.photo_path ?? null);
  const [durations, setDurations] = useState<number[]>(court?.duration_options ?? [60, 90, 120]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const dirty =
    nameEn !== (court?.name_en ?? '') ||
    nameAr !== (court?.name_ar ?? '') ||
    descEn !== (court?.description_en ?? '') ||
    descAr !== (court?.description_ar ?? '') ||
    indoor !== (court?.indoor ?? true) ||
    active !== (court?.is_active ?? true) ||
    photo !== (court?.photo_path ?? null) ||
    durations.join(',') !== (court?.duration_options ?? [60, 90, 120]).join(',');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_court', {
        p_id: court?.id ?? null,
        p_name_en: nameEn,
        p_name_ar: nameAr,
        p_indoor: indoor,
        p_description_en: descEn || null,
        p_description_ar: descAr || null,
        p_photo_path: photo,
        p_duration_options: durations,
        p_is_active: active,
      });
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
          {court ? tr('op.courts.editTitle') : tr('op.courts.newTitle')}
          {dirty && <StatusBadge tone="warn" size="sm" label={tr('ws.owner.courts.unsaved')} />}
        </span>
      }
      style={{ marginBlockStart: '1rem' }}
      data-testid="court-editor"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 13rem', gap: '1.25rem', alignItems: 'start' }}>
        <div>
          {/* Labels stay "Name (English)" / "Name (Arabic)": the e2e suite and the
              desk staff both know them by those names. */}
          <BilingualFields labelEn={tr('op.courts.nameEn')} labelAr={tr('op.courts.nameAr')} en={nameEn} ar={nameAr} onEn={setNameEn} onAr={setNameAr} disabled={busy} maxLength={60} />
          <BilingualFields labelEn={tr('op.courts.descEn')} labelAr={tr('op.courts.descAr')} en={descEn} ar={descAr} onEn={setDescEn} onAr={setDescAr} disabled={busy} multiline maxLength={300} />

          <div style={{ display: 'flex', gap: '1.4rem', marginBlock: '0.5rem 0.85rem', flexWrap: 'wrap' }}>
            <Switch checked={indoor} onChange={setIndoor} label={tr('op.courts.indoor')} disabled={busy} />
            <Switch checked={active} onChange={setActive} label={tr('op.courts.active')} disabled={busy} />
          </div>

          <Field label={tr('op.courts.durations')} error={durationsValid(durations) ? undefined : tr('ws.kit.common.required')}>
            <div role="group" aria-label={tr('op.courts.durations')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {DURATION_CHOICES.map((d) => (
                <Button key={d} size="sm" kind={durations.includes(d) ? 'primary' : 'default'} aria-pressed={durations.includes(d)} disabled={busy} onClick={() => setDurations((prev) => toggleDuration(prev, d))}>
                  {tr('op.common.minutesShort', { minutes: d })}
                </Button>
              ))}
            </div>
          </Field>
        </div>
        <ImageField label={tr('op.courts.photo')} value={photo} onChange={setPhoto} folder="courts" ownerId={court?.id ?? 'new'} aspect="16:9" disabled={busy} />
      </div>

      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} disabled={busy}>
          {dirty ? tr('ws.owner.courts.discard') : tr('common.back')}
        </Button>
        <Button kind="primary" icon="check" busy={busy} disabled={!nameEn.trim() || !nameAr.trim() || !durationsValid(durations)} onClick={() => void save()}>
          {tr('op.common.apply')}
        </Button>
      </div>
    </Panel>
  );
}
