/**
 * `/admin/staff` — StaffAdminScreen (spec 06.45), owner only.
 *
 * SOW L234: "Staff accounts created and managed by the owner role", and L997
 * ("every role sees only what its permission set allows") makes it a PHASE
 * acceptance condition. Row changes go through the owner-gated RPCs in
 * migration 0051; creating an account and resetting a password need the GoTrue
 * admin API, so those go through the `staff-admin` edge function, which checks
 * the caller against the `staff` table before touching anything.
 *
 * The list is a DataTable; one row opens in the StaffAccountEditor panel
 * beside it (06.46). The row keeps its own role select and remove/reactivate
 * so the common change is one click.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { callEdge } from '../../../lib/edge';
import { useAuth, usePermissions, requiredRoleFor, type StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, MessagePresenter, PageHeader, PermissionRefusedNotice, StatusBadge, asyncStatus, type Column } from '../../../components/kit';
import { StaffAccountEditor } from './StaffAccountEditor';
import { MIN_PASSWORD, ROLES, STAFF_QUERY_KEY, type StaffRow } from './staffModel';

export { STAFF_QUERY_KEY } from './staffModel';

export function StaffList() {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { staff: me } = useAuth();
  const can = usePermissions();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<StaffRow | null>(null);
  const [pinFor, setPinFor] = useState<StaffRow | null>(null);

  const staffQ = useQuery({
    queryKey: STAFF_QUERY_KEY,
    // app.list_staff, not a table select: pin_hash is deliberately outside the
    // client column grant (0004:170), and a bcrypt hash of a 4-6 digit PIN is
    // brute-forceable offline in seconds. The server returns the boolean.
    queryFn: () => appRpc<StaffRow[]>('list_staff'),
  });
  const rows = useMemo(() => [...(staffQ.data ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name)), [staffQ.data]);
  const editing = editingId ? rows.find((r) => r.id === editingId) ?? null : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });

  const setRole = useMutation({
    mutationFn: (v: { id: string; role: StaffRole }) => appRpc('set_staff_role', { p_staff_id: v.id, p_role: v.role }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void refresh();
    },
    onError: (e) => toast.err(e),
  });

  const setActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => appRpc('set_staff_active', { p_staff_id: v.id, p_active: v.active }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void refresh();
    },
    onError: (e) => toast.err(e),
  });

  const clearPin = useMutation({
    mutationFn: (id: string) => appRpc('clear_staff_pin', { p_staff_id: id }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void refresh();
    },
    onError: (e) => toast.err(e),
  });

  const owners = useMemo(() => rows.filter((s) => s.role === 'owner' && s.is_active).length, [rows]);

  async function toggleActive(row: StaffRow) {
    const ok = await confirm({
      title: row.is_active ? tr('op.staff.confirmDeactivate') : tr('op.staff.confirmActivate'),
      body: row.is_active ? tr('op.staff.confirmDeactivateBody', { name: row.display_name }) : '',
      kind: row.is_active ? 'danger' : undefined,
      confirmLabel: row.is_active ? tr('op.staff.deactivate') : tr('op.staff.activate'),
    });
    if (!ok) return;
    setActive.mutate({ id: row.id, active: !row.is_active });
  }

  const busyRow = setRole.isPending || setActive.isPending || clearPin.isPending;

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      header: tr('ws.owner.staff.columns.name'),
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'baseline', opacity: s.is_active ? 1 : 0.6 }}>
          <bdi style={{ fontWeight: 600 }}>{s.display_name}</bdi>
          {s.id === me?.id && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('op.staff.you')}</span>}
        </span>
      ),
    },
    {
      key: 'role',
      header: tr('ws.owner.staff.columns.role'),
      width: '11rem',
      render: (s) => (
        // The server refuses self-edits (CANNOT_EDIT_SELF) so a single owner can
        // never lock the venue out; show that rather than let the owner discover
        // it by being refused.
        <Select<StaffRole>
          value={s.role}
          aria-label={tr('ws.owner.staff.columns.role')}
          disabled={!can.manageStaff || s.id === me?.id || busyRow}
          onChange={(role) => setRole.mutate({ id: s.id, role })}
          options={ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))}
          style={{ minBlockSize: '1.9rem', paddingBlock: '0.2rem' }}
        />
      ),
    },
    {
      key: 'pin',
      header: tr('ws.owner.staff.columns.pin'),
      render: (s) =>
        s.role === 'manager' || s.role === 'owner' ? (
          <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge tone={s.has_pin ? 'success' : 'neutral'} size="sm" label={s.has_pin ? tr('op.staff.pinSet') : tr('op.staff.pinNone')} />
            <Button kind="ghost" size="sm" disabled={!can.manageStaff || busyRow} onClick={() => setPinFor(s)}>
              {s.has_pin ? tr('op.staff.pinChange') : tr('op.staff.pinSetAction')}
            </Button>
            {s.has_pin && (
              <Button kind="ghost" size="sm" disabled={!can.manageStaff || busyRow} onClick={() => clearPin.mutate(s.id)}>
                {tr('op.staff.pinClear')}
              </Button>
            )}
          </span>
        ) : (
          // A PIN authorises discounts and voids; only manager and owner have anything to authorise (0026).
          <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
        ),
    },
    {
      key: 'status',
      header: tr('ws.owner.staff.columns.status'),
      width: '7rem',
      render: (s) => (s.is_active ? <StatusBadge tone="success" size="sm" label={tr('ws.owner.staff.status.active')} /> : <StatusBadge tone="neutral" size="sm" label={tr('ws.owner.staff.status.inactive')} />),
    },
    {
      key: 'actions',
      header: tr('ws.owner.staff.columns.actions'),
      align: 'end',
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button kind="ghost" size="sm" icon="note" onClick={() => setEditingId(s.id)}>
            {tr('op.common.edit')}
          </Button>
          <Button kind="ghost" size="sm" disabled={!can.manageStaff || busyRow} onClick={() => setPasswordFor(s)}>
            {tr('op.staff.resetPassword')}
          </Button>
          <Button
            size="sm"
            kind={s.is_active ? 'danger' : 'default'}
            disabled={!can.manageStaff || s.id === me?.id || busyRow}
            onClick={() => void toggleActive(s)}
          >
            {s.is_active ? tr('op.staff.deactivate') : tr('op.staff.activate')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('op.staff.title')}
        subtitle={tr('ws.owner.staff.lead')}
        actions={
          <Button kind="primary" icon="userPlus" disabled={!can.manageStaff} onClick={() => setAdding(true)}>
            {tr('op.staff.add')}
          </Button>
        }
      />
      {!can.manageStaff && <PermissionRefusedNotice action={tr('ws.owner.staff.refusedAction')} requiredRole={requiredRoleFor('manageStaff')} style={{ marginBlockEnd: '0.9rem' }} />}

      <div style={{ display: 'grid', gridTemplateColumns: editing ? 'minmax(0, 1fr) minmax(20rem, 26rem)' : 'minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div style={{ minInlineSize: 0 }}>
          <AsyncStateWrapper
            status={asyncStatus(staffQ, (d) => d.length === 0)}
            error={staffQ.error}
            onRetry={() => void staffQ.refetch()}
            emptyContent={
              <EmptyState
                icon="users"
                title={tr('ws.owner.staff.emptyTitle')}
                body={tr('ws.owner.staff.emptyBody')}
                action={<Button kind="primary" disabled={!can.manageStaff} onClick={() => setAdding(true)}>{tr('op.staff.add')}</Button>}
              />
            }
          >
            <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} selectedKey={editingId} aria-label={tr('op.staff.title')} />
          </AsyncStateWrapper>
          {owners === 1 && <MessagePresenter tone="info" message={tr('op.staff.oneOwner')} style={{ marginBlockStart: '0.75rem' }} />}
        </div>
        {editing && (
          <StaffAccountEditor
            key={editing.id}
            staff={editing}
            isSelf={editing.id === me?.id}
            canManage={can.manageStaff}
            onClose={() => setEditingId(null)}
            onResetPassword={() => setPasswordFor(editing)}
            onSetPin={() => setPinFor(editing)}
          />
        )}
      </div>

      {adding && (
        <AddStaffDialog
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void refresh();
          }}
        />
      )}
      {passwordFor && <PasswordDialog staff={passwordFor} onClose={() => setPasswordFor(null)} />}
      {pinFor && (
        <PinDialog
          staff={pinFor}
          onClose={() => setPinFor(null)}
          onSaved={() => {
            setPinFor(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function AddStaffDialog({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('cashier');
  const [password, setPassword] = useState('');

  const create = useMutation({
    mutationFn: () =>
      callEdge<unknown, { result: string }>(
        'staff-admin',
        { action: 'create', email, password, display_name: name, role },
        // Never cache a mutation: a second create must reach the server.
        { ttlMs: 0 },
      ),
    onSuccess: () => {
      toast.ok(tr('op.staff.created'));
      onCreated();
    },
  });

  const ready = email.includes('@') && name.trim() !== '' && password.length >= MIN_PASSWORD;

  return (
    <Modal
      title={tr('op.staff.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="userPlus" disabled={!ready} busy={create.isPending} onClick={() => create.mutate()}>
            {tr('op.staff.add')}
          </Button>
        </>
      }
    >
      <Field label={tr('auth.emailLabel')} required>
        <input style={inputStyle} dir="ltr" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={tr('op.staff.name')} required>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('op.staff.role')} hint={tr('ws.owner.staff.editor.roleNote')}>
        <Select<StaffRole> value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))} />
      </Field>
      {/* Shown, not masked: the owner reads this out during training and the
          staff member changes it afterwards. Masking a value you must dictate
          aloud only produces typos. */}
      <Field label={tr('op.staff.openingPassword')} required hint={tr('op.staff.passwordHint', { min: MIN_PASSWORD })}>
        <input style={inputStyle} dir="ltr" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorText error={create.error} />
    </Modal>
  );
}

function PasswordDialog({ staff, onClose }: { staff: StaffRow; onClose(): void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () => callEdge<unknown, { result: string }>('staff-admin', { action: 'reset_password', staff_id: staff.id, password }, { ttlMs: 0 }),
    onSuccess: () => {
      toast.ok(tr('op.staff.passwordReset'));
      onClose();
    },
  });

  return (
    <Modal
      title={tr('op.staff.resetPasswordFor', { name: staff.display_name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={reset.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="lock" disabled={password.length < MIN_PASSWORD} busy={reset.isPending} onClick={() => reset.mutate()}>
            {tr('op.staff.resetPassword')}
          </Button>
        </>
      }
    >
      <Field label={tr('op.staff.openingPassword')} hint={tr('op.staff.passwordHint', { min: MIN_PASSWORD })}>
        <input style={inputStyle} dir="ltr" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorText error={reset.error} />
    </Modal>
  );
}

function PinDialog({ staff, onClose, onSaved }: { staff: StaffRow; onClose(): void; onSaved(): void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const [pin, setPin] = useState('');

  const save = useMutation({
    mutationFn: () => appRpc('set_staff_pin', { p_staff_id: staff.id, p_pin: pin }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      onSaved();
    },
  });

  // 4-6 digits, matching app.set_staff_pin's own check, so the refusal is
  // caught here rather than after a round trip.
  const valid = /^[0-9]{4,6}$/.test(pin);

  return (
    <Modal
      title={tr('op.staff.pinFor', { name: staff.display_name })}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="lock" disabled={!valid} busy={save.isPending} onClick={() => save.mutate()}>
            {tr('common.save')}
          </Button>
        </>
      }
    >
      <Field label={tr('op.common.pin')} hint={tr('op.staff.pinHint')}>
        <input
          style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </Field>
      <ErrorText error={save.error} />
    </Modal>
  );
}
