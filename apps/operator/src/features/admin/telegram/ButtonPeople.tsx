/**
 * Who may use the buttons under Telegram messages (Seen / Served / Void on an
 * order, Acknowledge / Done on a waiter call).
 *
 * Migration 0039 made every tap fail closed unless the tapper is an active
 * `telegram_staff` row, and `app.set_telegram_staff` has been the only way to
 * add one since — with no screen. An owner who ran Find the problem and read
 * "Nobody is allowed to use the buttons yet" had nothing in the app to do about
 * it, and the fix needed a Telegram user id nobody knows by heart.
 *
 * The ids are already on record: `telegram_actions` logs every tap, refused ones
 * included, with the tapper's id and Telegram name. So the screen lists the
 * people who TRIED and were refused, and allowing one is picking which staff
 * member they are. Typing an id stays possible, folded away, for someone who
 * has not tapped yet.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatTime, isolate } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, Field, Select, inputStyle } from '../../../components/ui';
import { EmptyState, Panel, StatusBadge } from '../../../components/kit';
import { CardTitle } from '../../ops/OpsVisuals';
import { refusedTappers, type TapRow } from './buttonPeopleLogic';

export const BUTTON_PEOPLE_KEY = ['telegramButtonPeople'] as const;

interface AllowRow {
  tg_user_id: number;
  staff_id: string;
  label: string | null;
  can_void: boolean;
  is_active: boolean;
}

interface StaffRow {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

async function fetchButtonPeople() {
  const [allow, staff, taps] = await Promise.all([
    supabase.from('telegram_staff').select('tg_user_id, staff_id, label, can_void, is_active').order('created_at'),
    supabase.from('staff').select('id, display_name, role, is_active').order('display_name'),
    // Enough history to find everyone who has tried recently; the ledger keeps every tap.
    supabase.from('telegram_actions').select('at, tg_user_id, tg_first_name, tg_username, result, detail').order('at', { ascending: false }).limit(500),
  ]);
  for (const r of [allow, staff, taps]) if (r.error) throw r.error;
  return {
    allow: (allow.data ?? []) as AllowRow[],
    staff: (staff.data ?? []) as StaffRow[],
    taps: (taps.data ?? []) as TapRow[],
  };
}

export function ButtonPeople() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: BUTTON_PEOPLE_KEY, queryFn: fetchButtonPeople, refetchInterval: 60_000 });

  const save = useMutation({
    mutationFn: (args: { tgUserId: number; staffId: string; label: string | null; canVoid: boolean; isActive: boolean }) =>
      appRpc('set_telegram_staff', {
        p_tg_user_id: args.tgUserId,
        p_staff_id: args.staffId,
        p_label: args.label,
        p_can_void: args.canVoid,
        p_is_active: args.isActive,
      }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void qc.invalidateQueries({ queryKey: BUTTON_PEOPLE_KEY });
    },
    onError: (e) => toast.err(e),
  });

  const data = q.data;
  const activeStaff = useMemo(() => (data?.staff ?? []).filter((s) => s.is_active), [data]);
  const staffName = (id: string) => data?.staff.find((s) => s.id === id)?.display_name ?? '—';
  const allowed = (data?.allow ?? []).filter((a) => a.is_active);
  const refused = data ? refusedTappers(data.taps, allowed.map((a) => a.tg_user_id)) : [];
  const at = (iso: string) => {
    const d = new Date(iso);
    return `${formatDate(d, locale)} ${formatTime(d, locale)}`;
  };
  const telegramName = (first: string | null, username: string | null) =>
    [first, username ? `@${username}` : null].filter(Boolean).join(' ') || '—';

  return (
    <Panel title={<CardTitle icon="users">{tr('ws.manager.settings.telegram.people.title')}</CardTitle>}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.manager.settings.telegram.people.lead')}</p>

        {q.isError && <StatusBadge tone="danger" icon="alert" label={tr('ws.manager.settings.telegram.people.loadFailed')} />}

        {data && (
          <>
            {/* Refused first: that list is the one waiting on the owner. */}
            {refused.length > 0 && (
              <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                <h3 style={{ fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{tr('ws.manager.settings.telegram.people.refusedTitle')}</h3>
                <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.manager.settings.telegram.people.refusedLead')}</p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  {refused.map((p) => (
                    <AllowForm
                      key={p.tgUserId}
                      name={telegramName(p.firstName, p.username)}
                      meta={tr('ws.manager.settings.telegram.people.lastTried', { when: at(p.lastAt) })}
                      staff={activeStaff}
                      busy={save.isPending}
                      onAllow={(staffId, canVoid) => save.mutate({ tgUserId: p.tgUserId, staffId, label: telegramName(p.firstName, p.username), canVoid, isActive: true })}
                    />
                  ))}
                </ul>
              </section>
            )}

            <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
              <h3 style={{ fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{tr('ws.manager.settings.telegram.people.allowedTitle')}</h3>
              {allowed.length === 0 ? (
                <EmptyState
                  compact
                  titleAs="h4"
                  icon="users"
                  title={tr('ws.manager.settings.telegram.people.noneAllowed')}
                  body={refused.length > 0 ? undefined : tr('ws.manager.settings.telegram.people.noneAllowedBody')}
                />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
                  {allowed.map((a) => {
                    const staffRow = data.staff.find((s) => s.id === a.staff_id);
                    return (
                      <li
                        key={a.tg_user_id}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-2)', borderBlockEnd: '1px solid var(--tp-border)' }}
                      >
                        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 14rem', minInlineSize: 0 }}>
                          <strong>
                            <bdi>{staffName(a.staff_id)}</bdi>
                          </strong>
                          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                            {tr('ws.manager.settings.telegram.people.onTelegram', { name: isolate(a.label ?? String(a.tg_user_id)) })}
                          </span>
                        </span>
                        {staffRow && !staffRow.is_active && (
                          <StatusBadge size="sm" tone="warn" icon="alert" label={tr('ws.manager.settings.telegram.people.staffInactive')} />
                        )}
                        <Switch
                          checked={a.can_void}
                          disabled={save.isPending}
                          label={tr('ws.manager.settings.telegram.people.canVoid')}
                          onChange={(next) => save.mutate({ tgUserId: a.tg_user_id, staffId: a.staff_id, label: a.label, canVoid: next, isActive: true })}
                        />
                        <Button
                          size="sm"
                          kind="ghost"
                          icon="x"
                          disabled={save.isPending}
                          onClick={() => save.mutate({ tgUserId: a.tg_user_id, staffId: a.staff_id, label: a.label, canVoid: a.can_void, isActive: false })}
                        >
                          {tr('ws.manager.settings.telegram.people.remove')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.manager.settings.telegram.people.canVoidHint')}</p>
            </section>

            <details style={{ fontSize: 'var(--tp-fs-sm)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--tp-accent)', minBlockSize: 'var(--tp-row-h-dense)', display: 'list-item' }}>
                {tr('ws.manager.settings.telegram.people.byId')}
              </summary>
              <ById staff={activeStaff} busy={save.isPending} onAllow={(tgUserId, staffId, canVoid) => save.mutate({ tgUserId, staffId, label: null, canVoid, isActive: true })} />
            </details>
          </>
        )}
      </div>
    </Panel>
  );
}

/** One refused tapper: which staff member they are, whether they may void, Allow. */
function AllowForm({
  name,
  meta,
  staff,
  busy,
  onAllow,
}: {
  name: string;
  meta: string;
  staff: readonly StaffRow[];
  busy: boolean;
  onAllow: (staffId: string, canVoid: boolean) => void;
}) {
  const { tr } = useLocale();
  const [staffId, setStaffId] = useState('');
  const [canVoid, setCanVoid] = useState(false);
  return (
    <li style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', padding: 'var(--tp-sp-2)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 12rem', minInlineSize: 0, alignSelf: 'center' }}>
        <strong>
          <bdi>{name}</bdi>
        </strong>
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{meta}</span>
      </span>
      <StaffPicker staff={staff} value={staffId} onChange={setStaffId} />
      <Switch checked={canVoid} onChange={setCanVoid} label={tr('ws.manager.settings.telegram.people.canVoid')} />
      <Button
        kind="primary"
        size="sm"
        icon="check"
        busy={busy}
        disabled={!staffId || busy}
        disabledReason={!staffId ? tr('ws.manager.settings.telegram.people.pickStaffFirst') : undefined}
        onClick={() => onAllow(staffId, canVoid)}
      >
        {tr('ws.manager.settings.telegram.people.allow')}
      </Button>
    </li>
  );
}

function StaffPicker({ staff, value, onChange }: { staff: readonly StaffRow[]; value: string; onChange: (id: string) => void }) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.manager.settings.telegram.people.whichStaff')} style={{ marginBlockEnd: 0, minInlineSize: '12rem' }}>
      <Select
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: tr('ws.manager.settings.telegram.people.choose') },
          ...staff.map((s) => ({ value: s.id, label: `${s.display_name} · ${tr(`op.roles.${s.role as 'cashier'}`)}` })),
        ]}
      />
    </Field>
  );
}

function ById({ staff, busy, onAllow }: { staff: readonly StaffRow[]; busy: boolean; onAllow: (tgUserId: number, staffId: string, canVoid: boolean) => void }) {
  const { tr } = useLocale();
  const [id, setId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [canVoid, setCanVoid] = useState(false);
  const valid = /^\d{5,15}$/.test(id.trim());
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-2)' }}>
      <Field
        label={tr('ws.manager.settings.telegram.people.tgId')}
        hint={tr('ws.manager.settings.telegram.people.tgIdHint')}
        error={id !== '' && !valid ? tr('ws.manager.settings.telegram.people.tgIdInvalid') : undefined}
        style={{ marginBlockEnd: 0 }}
      >
        <input style={{ ...inputStyle, maxInlineSize: '12rem' }} dir="ltr" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <StaffPicker staff={staff} value={staffId} onChange={setStaffId} />
      <Switch checked={canVoid} onChange={setCanVoid} label={tr('ws.manager.settings.telegram.people.canVoid')} />
      <Button
        kind="primary"
        size="sm"
        icon="check"
        busy={busy}
        disabled={!valid || !staffId || busy}
        disabledReason={!valid ? tr('ws.manager.settings.telegram.people.tgIdInvalid') : !staffId ? tr('ws.manager.settings.telegram.people.pickStaffFirst') : undefined}
        onClick={() => {
          onAllow(Number(id.trim()), staffId, canVoid);
          setId('');
          setStaffId('');
          setCanVoid(false);
        }}
      >
        {tr('ws.manager.settings.telegram.people.allow')}
      </Button>
    </div>
  );
}
