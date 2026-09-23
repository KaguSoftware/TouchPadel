/**
 * StaffAccountEditorScreen (spec 06.46) — one account, managed in a panel
 * beside the list. Name → `rename_staff`, role → `set_staff_role`, access →
 * `set_staff_active`, PIN → `set_staff_pin` / `clear_staff_pin`. Each is the
 * owner-gated RPC from migration 0051/0026/0081.
 *
 * The panel is four short sections, each with its own button, instead of one
 * form with a single Save that could carry a rename, a promotion and a
 * lock-out at once. Each section says what its change does BEFORE it happens,
 * and every change that gives power or takes access away asks first:
 *
 *  - a role change names the new role and what it can open;
 *  - removing access says what the server actually does (0081: signed out on
 *    every device within the hour, PIN cleared) and that the records keep the
 *    name — "Remove" alone read as "delete this person";
 *  - removing a PIN says the person can no longer approve at the till.
 *
 * The old "Email" field is gone: it was a disabled input that always read "—"
 * (the address lives in the auth system and list_staff does not return it).
 * Its one useful sentence — create a new account to change the email — moved
 * to the name section's hint.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { supabase } from '../../../lib/supabase';
import type { StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, Field, inputStyle } from '../../../components/ui';
import { MessagePresenter, Panel, StatusBadge } from '../../../components/kit';
import { RoleField, StaffErrorText } from './staffParts';
import { STAFF_QUERY_KEY, approvesWithPin, type StaffRow } from './staffModel';

export function StaffAccountEditor({
  staff,
  isSelf,
  canManage,
  onClose,
  onResetPassword,
  onSetPin,
}: {
  staff: StaffRow;
  isSelf: boolean;
  canManage: boolean;
  onClose: () => void;
  onResetPassword: () => void;
  onSetPin: () => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [name, setName] = useState(staff.display_name);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [error, setError] = useState<unknown>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });
  const mutation = <V,>(fn: (v: V) => Promise<unknown>, done: string) =>
    ({
      mutationFn: fn,
      onSuccess: () => {
        toast.ok(done);
        setError(null);
        void refresh();
      },
      onError: (e: unknown) => setError(e),
    }) as const;

  const rename = useMutation(mutation((v: string) => appRpc('rename_staff', { p_staff_id: staff.id, p_display_name: v }), tr('op.toast.saved')));
  const setRoleM = useMutation(mutation((v: StaffRole) => appRpc('set_staff_role', { p_staff_id: staff.id, p_role: v }), tr('ws.owner.staff.editor.roleSaved')));
  const setActive = useMutation(
    mutation(
      (v: boolean) => appRpc('set_staff_active', { p_staff_id: staff.id, p_active: v }),
      staff.is_active ? tr('ws.owner.staff.editor.accessRemoved') : tr('ws.owner.staff.editor.accessRestored'),
    ),
  );
  const clearPin = useMutation(mutation(() => appRpc('clear_staff_pin', { p_staff_id: staff.id }), tr('ws.owner.staff.pin.removed')));

  const busy = rename.isPending || setRoleM.isPending || setActive.isPending || clearPin.isPending;
  // The server refuses every self-edit but a rename (CANNOT_EDIT_SELF), so one
  // owner can never lock the venue out; say so rather than let them find out.
  const locked = !canManage || isSelf;
  const trimmed = name.trim();
  const nameDirty = trimmed !== '' && trimmed !== staff.display_name;
  const roleDirty = role !== staff.role;
  const roleName = (r: StaffRole) => tr(`op.roles.${r}`);

  async function saveRole() {
    const ok = await confirm({
      title: tr('ws.owner.staff.editor.roleConfirm', { name: staff.display_name, role: roleName(role) }),
      body: (
        <>
          <p>{tr(`ws.owner.staff.roleAccess.${role}`)}</p>
          <p style={{ marginBlockStart: 'var(--tp-sp-2)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.staff.editor.roleWhen')}</p>
        </>
      ),
      kind: role === 'owner' ? 'danger' : 'primary',
      confirmLabel: tr('ws.owner.staff.editor.roleConfirmAction', { role: roleName(role) }),
    });
    if (ok) setRoleM.mutate(role);
  }

  async function toggleAccess() {
    const removing = staff.is_active;
    const ok = await confirm({
      title: removing
        ? tr('ws.owner.staff.editor.removeConfirm', { name: staff.display_name })
        : tr('ws.owner.staff.editor.restoreConfirm', { name: staff.display_name }),
      body: removing ? tr('op.staff.confirmDeactivateBody', { name: staff.display_name }) : tr('ws.owner.staff.editor.restoreBody'),
      kind: removing ? 'danger' : 'primary',
      confirmLabel: removing ? tr('op.staff.deactivate') : tr('op.staff.activate'),
    });
    if (ok) setActive.mutate(!removing);
  }

  async function removePin() {
    const ok = await confirm({
      title: tr('ws.owner.staff.pin.removeConfirm', { name: staff.display_name }),
      body: tr('ws.owner.staff.pin.removeBody'),
      kind: 'danger',
      confirmLabel: tr('op.staff.pinClear'),
    });
    if (ok) clearPin.mutate(undefined);
  }

  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{staff.display_name}</bdi>
          {staff.is_active ? (
            <StatusBadge tone="success" size="sm" label={tr('ws.owner.staff.status.active')} />
          ) : (
            <StatusBadge tone="neutral" size="sm" label={tr('ws.owner.staff.status.inactive')} />
          )}
        </span>
      }
      actions={<Button kind="ghost" size="sm" icon="x" aria-label={tr('ws.owner.staff.editor.close')} onClick={onClose} disabled={busy} />}
      style={{ position: 'sticky', insetBlockStart: 'var(--tp-sp-2)' }}
      data-testid="staff-editor"
    >
      {isSelf && <MessagePresenter tone="info" message={tr('ws.owner.staff.editor.selfNote')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />}
      <StaffErrorText error={error} />

      <Section>
        <Field label={tr('ws.owner.staff.editor.name')} hint={tr('ws.owner.staff.editor.nameHint')} style={{ marginBlockEnd: 0 }}>
          <input style={inputStyle} value={name} disabled={!canManage || busy} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        {nameDirty && (
          <Actions>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => setName(staff.display_name)}>
              {tr('ws.kit.actions.discard')}
            </Button>
            <Button size="sm" kind="primary" icon="check" busy={rename.isPending} disabled={busy} onClick={() => rename.mutate(trimmed)}>
              {tr('ws.owner.staff.editor.saveName')}
            </Button>
          </Actions>
        )}
      </Section>

      <Section>
        <RoleField value={role} current={staff.role} onChange={setRole} disabled={locked || busy || !staff.is_active} />
        {!staff.is_active && <Note>{tr('ws.owner.staff.editor.roleInactive')}</Note>}
        {roleDirty && (
          <Actions>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => setRole(staff.role)}>
              {tr('ws.kit.actions.discard')}
            </Button>
            <Button size="sm" kind="primary" icon="check" busy={setRoleM.isPending} disabled={busy} onClick={() => void saveRole()}>
              {tr('ws.owner.staff.editor.saveRole')}
            </Button>
          </Actions>
        )}
      </Section>

      <Section title={tr('ws.owner.staff.pin.title')}>
        {/* Every role holds a PIN since 0105; the note says what THIS one does. */}
        <Note>
          {approvesWithPin(staff.role)
            ? staff.has_pin
              ? tr('ws.owner.staff.pin.hasPin')
              : tr('ws.owner.staff.pin.noPin')
            : staff.has_pin
              ? tr('ws.owner.staff.pin.hasPinBreakOnly')
              : tr('ws.owner.staff.pin.noPinBreakOnly')}
        </Note>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
          <Button size="sm" icon="lock" disabled={!canManage || busy || !staff.is_active} onClick={onSetPin}>
            {staff.has_pin ? tr('op.staff.pinChange') : tr('op.staff.pinSetAction')}
          </Button>
          {staff.has_pin && (
            <Button size="sm" kind="ghost" busy={clearPin.isPending} disabled={!canManage || busy} onClick={() => void removePin()}>
              {tr('op.staff.pinClear')}
            </Button>
          )}
        </div>
      </Section>

      <Section title={tr('ws.owner.staff.stations.title')}>
        {approvesWithPin(staff.role) ? (
          <Note>{tr('ws.owner.staff.stations.management')}</Note>
        ) : (
          <StationsField staff={staff} canManage={canManage && staff.is_active} onError={setError} />
        )}
      </Section>

      <Section title={tr('ws.owner.staff.password.title')}>
        <Note>{tr('ws.owner.staff.password.panelNote')}</Note>
        <div>
          <Button size="sm" icon="lock" disabled={!canManage || busy || !staff.is_active} onClick={onResetPassword}>
            {tr('op.staff.resetPassword')}
          </Button>
        </div>
      </Section>

      <Section title={tr('ws.owner.staff.editor.accessTitle')} last>
        <Note>{staff.is_active ? tr('ws.owner.staff.editor.enabledNote') : tr('ws.owner.staff.editor.disabledNote')}</Note>
        <div>
          <Button
            size="sm"
            kind={staff.is_active ? 'danger' : 'default'}
            icon={staff.is_active ? 'ban' : 'undo'}
            busy={setActive.isPending}
            disabled={locked || busy}
            disabledReason={isSelf ? tr('ws.manager.disabled.self') : undefined}
            onClick={() => void toggleAccess()}
          >
            {staff.is_active ? tr('op.staff.deactivate') : tr('op.staff.activate')}
          </Button>
        </div>
      </Section>
    </Panel>
  );
}

/**
 * 0105: which stations offer this person as cover on their break screen.
 * The list of stations is whatever has reported a heartbeat, plus anything
 * this person is already assigned to (a station retired since still shows,
 * so the owner can untick it). Saved as a whole through app.set_station_staff.
 */
function StationsField({ staff, canManage, onError }: { staff: StaffRow; canManage: boolean; onError: (e: unknown) => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['stationStaff', staff.id] as const;
  const stationsQ = useQuery({
    queryKey: ['stations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('device_heartbeats').select('device_id');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.device_id);
    },
    staleTime: 60_000,
  });
  const assignedQ = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from('station_staff').select('station_id').eq('staff_id', staff.id);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.station_id);
    },
  });
  const assigned = useMemo(() => new Set(assignedQ.data ?? []), [assignedQ.data]);
  const known = useMemo(
    () => [...new Set([...(stationsQ.data ?? []), ...assigned])].sort(),
    [stationsQ.data, assigned],
  );
  const [draft, setDraft] = useState<Set<string> | null>(null);
  // A fresh answer from the server replaces an untouched draft.
  useEffect(() => setDraft(null), [assignedQ.data]);
  const chosen = draft ?? assigned;
  const dirty = draft !== null && (draft.size !== assigned.size || [...draft].some((s) => !assigned.has(s)));

  const save = useMutation({
    mutationFn: (ids: string[]) => appRpc('set_station_staff', { p_staff_id: staff.id, p_station_ids: ids }),
    onSuccess: () => {
      toast.ok(tr('ws.owner.staff.stations.saved'));
      onError(null);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e: unknown) => onError(e),
  });

  if (stationsQ.isLoading || assignedQ.isLoading) return <Note>…</Note>;
  if (known.length === 0) return <Note>{tr('ws.owner.staff.stations.none')}</Note>;

  return (
    <>
      <Note>{tr('ws.owner.staff.stations.lead')}</Note>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5) var(--tp-sp-3)', flexWrap: 'wrap' }}>
        {known.map((id) => (
          <label key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', minBlockSize: 'var(--tp-touch)', cursor: canManage ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={chosen.has(id)}
              disabled={!canManage || save.isPending}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(id);
                else next.delete(id);
                setDraft(next);
              }}
            />
            <span dir="ltr" style={{ fontWeight: 600 }}>{id}</span>
          </label>
        ))}
      </div>
      {dirty && (
        <Actions>
          <Button size="sm" kind="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
            {tr('ws.kit.actions.discard')}
          </Button>
          <Button size="sm" kind="primary" icon="check" busy={save.isPending} onClick={() => save.mutate([...chosen])}>
            {tr('ws.owner.staff.stations.save')}
          </Button>
        </Actions>
      )}
    </>
  );
}

function Section({ title, children, last }: { title?: string; children: ReactNode; last?: boolean }) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlockEnd: last ? 0 : 'var(--tp-sp-3)',
        marginBlockEnd: last ? 0 : 'var(--tp-sp-3)',
        borderBlockEnd: last ? undefined : '1px solid var(--tp-border)',
      }}
    >
      {/* The name and role fields carry their own labels; a heading repeating them said it twice. */}
      {title && <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</h3>}
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{children}</p>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end' }}>{children}</div>;
}
