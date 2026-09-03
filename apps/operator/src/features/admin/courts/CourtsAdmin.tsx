/**
 * Court records admin — SOW L299-301: name, indoor/outdoor, description,
 * photograph, duration options per court. Writes via app.upsert_court /
 * app.reorder_courts (0062, audited); courts were read-only in every screen
 * until this page existed.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Field, card, inputStyle } from '../../../components/ui';
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
    .select(
      'id, name_en, name_ar, description_en, description_ar, indoor, photo_path, duration_options, sort_order, is_active',
    )
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

  return (
    <div style={{ maxInlineSize: '46rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.courts.title')}</h2>
        <Button kind="primary" onClick={() => setEditing('new')}>
          {tr('op.common.add')}
        </Button>
      </div>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>
        {tr('op.courts.hint')}
      </p>

      {rows.map((c, i) => (
        <div
          key={c.id}
          style={{ ...card, marginBlockEnd: '0.5rem', display: 'flex', gap: '0.7rem', alignItems: 'center' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Button kind="ghost" disabled={i === 0} aria-label="↑" onClick={() => move(c.id, -1)}>
              ↑
            </Button>
            <Button
              kind="ghost"
              disabled={i === rows.length - 1}
              aria-label="↓"
              onClick={() => move(c.id, 1)}
            >
              ↓
            </Button>
          </div>
          <div style={{ flex: 1, minInlineSize: 0 }}>
            <strong>{pickName(locale, c)}</strong>
            {!c.is_active && (
              <span style={{ color: 'var(--tp-muted-fg)' }}> · {tr('op.courts.inactive')}</span>
            )}
            <div style={{ color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
              {tr(c.indoor ? 'op.courts.indoor' : 'op.courts.outdoor')} ·{' '}
              {c.duration_options.map((d) => tr('op.common.minutesShort', { minutes: d })).join(' / ')}
            </div>
          </div>
          <Button onClick={() => setEditing(c)}>{tr('op.common.edit')}</Button>
        </div>
      ))}
      {courtsQ.isSuccess && rows.length === 0 && <p style={card}>{tr('op.courts.empty')}</p>}

      {editing && (
        <CourtForm
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

function CourtForm({
  court,
  onDone,
  onCancel,
}: {
  court: CourtAdminRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
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
    <div style={{ ...card, marginBlockStart: '0.8rem' }}>
      <h3 style={{ marginBlockStart: 0 }}>
        {court ? tr('op.courts.editTitle') : tr('op.courts.newTitle')}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        <Field label={tr('op.courts.nameEn')}>
          <input style={inputStyle} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={tr('op.courts.nameAr')}>
          <input style={inputStyle} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={tr('op.courts.descEn')}>
          <input style={inputStyle} value={descEn} onChange={(e) => setDescEn(e.target.value)} />
        </Field>
        <Field label={tr('op.courts.descAr')}>
          <input style={inputStyle} dir="rtl" value={descAr} onChange={(e) => setDescAr(e.target.value)} />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: '1.4rem', marginBlock: '0.5rem', flexWrap: 'wrap' }}>
        <Switch checked={indoor} onChange={setIndoor} label={tr('op.courts.indoor')} />
        <Switch checked={active} onChange={setActive} label={tr('op.courts.active')} />
      </div>

      <Field label={tr('op.courts.durations')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {DURATION_CHOICES.map((d) => (
            <Button
              key={d}
              kind={durations.includes(d) ? 'primary' : 'default'}
              aria-pressed={durations.includes(d)}
              onClick={() => setDurations((prev) => toggleDuration(prev, d))}
            >
              {tr('op.common.minutesShort', { minutes: d })}
            </Button>
          ))}
        </div>
      </Field>

      <div style={{ inlineSize: '13rem' }}>
        <ImageField
          label={tr('op.courts.photo')}
          value={photo}
          onChange={setPhoto}
          folder="courts"
          ownerId={court?.id ?? 'new'}
          aspect="16:9"
        />
      </div>

      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>{tr('common.back')}</Button>
        <Button
          kind="primary"
          disabled={busy || !nameEn.trim() || !nameAr.trim() || !durationsValid(durations)}
          onClick={() => void save()}
        >
          {tr('op.common.apply')}
        </Button>
      </div>
    </div>
  );
}
