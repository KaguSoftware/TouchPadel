/**
 * `/admin/staff` — staff administration by the owner.
 *
 * SOW L234: "Staff accounts created and managed by the owner role", and L997
 * ("every role sees only what its permission set allows") makes it a PHASE
 * acceptance condition. Migration `0004:175-176` said the RPCs would "land with
 * the admin drop"; they never did, and this screen was a read-only table whose
 * own header said invites stay in the Supabase dashboard — the opposite of what
 * was signed, and impossible to demonstrate at handover.
 *
 * Everything that is only a row change goes through the owner-gated RPCs in
 * migration 0051. Creating an account and resetting a password need the GoTrue
 * admin API, so those go through the `staff-admin` edge function, which checks
 * the caller against the `staff` table before touching anything.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { callEdge } from '../../../lib/edge';
import type { StaffRole } from '../../../lib/auth';
import { useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import {
  Button,
  ErrorText,
  Field,
  Modal,
  Select,
  Skeleton,
  card,
  inputStyle,
} from '../../../components/ui';

const ROLES: readonly StaffRole[] = ['cashier', 'prep', 'court_desk', 'manager', 'owner'];
/** Matches the edge function's floor; stated here so the form can say so first. */
const MIN_PASSWORD = 10;

export const STAFF_QUERY_KEY = ['staffList'] as const;

interface StaffRow {
  id: string;
  display_name: string;
  role: StaffRole;
  is_active: boolean;
  /** Present for managers/owners with an authorisation PIN set (0026). */
  has_pin: boolean;
}

const cell: React.CSSProperties = {
  paddingBlock: '0.45rem',
  paddingInline: '0.5rem',
  borderBlockEnd: '1px solid var(--tp-border)',
  textAlign: 'start',
  verticalAlign: 'middle',
};

export function StaffList() {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { staff: me } = useAuth();
  const [adding, setAdding] = useState(false);
  const [passwordFor, setPasswordFor] = useState<StaffRow | null>(null);
  const [pinFor, setPinFor] = useState<StaffRow | null>(null);

  const staffQ = useQuery({
    queryKey: STAFF_QUERY_KEY,
    // app.list_staff, not a table select: pin_hash is deliberately outside the
    // client column grant (0004:170), and a bcrypt hash of a 4-6 digit PIN is
    // brute-forceable offline in seconds. The server returns the boolean.
    queryFn: () => appRpc<StaffRow[]>('list_staff'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });

  const setRole = useMutation({
    mutationFn: (v: { id: string; role: StaffRole }) =>
      appRpc('set_staff_role', { p_staff_id: v.id, p_role: v.role }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void refresh();
    },
    onError: (e) => toast.err(e),
  });

  const setActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      appRpc('set_staff_active', { p_staff_id: v.id, p_active: v.active }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void refresh();
    },
    onError: (e) => toast.err(e),
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      appRpc('rename_staff', { p_staff_id: v.id, p_display_name: v.name }),
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

  const owners = useMemo(
    () => (staffQ.data ?? []).filter((s) => s.role === 'owner' && s.is_active).length,
    [staffQ.data],
  );

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

  async function promptRename(row: StaffRow) {
    const next = window.prompt(tr('op.staff.name'), row.display_name);
    if (next === null || next.trim() === row.display_name) return;
    rename.mutate({ id: row.id, name: next });
  }

  return (
    <div style={{ maxInlineSize: '52rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h2 style={{ marginBlockStart: 0, marginInlineEnd: 'auto' }}>{tr('op.staff.title')}</h2>
        <Button kind="primary" onClick={() => setAdding(true)}>
          {tr('op.staff.add')}
        </Button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>{tr('op.staff.hint')}</p>

      <ErrorText error={staffQ.error} />
      {staffQ.isPending && <Skeleton lines={4} />}

      {staffQ.isSuccess && (
        <div style={{ ...card, paddingBlock: 0, paddingInline: 0, overflowX: 'auto' }}>
          <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '0.75rem', color: 'var(--tp-muted-fg)' }}>
                <th style={cell}>{tr('op.staff.name')}</th>
                <th style={cell}>{tr('op.staff.role')}</th>
                <th style={cell}>{tr('op.staff.pin')}</th>
                <th style={cell}>{tr('op.staff.active')}</th>
                <th style={cell}>{tr('op.common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {staffQ.data.map((s) => {
                // The server refuses self-edits (CANNOT_EDIT_SELF) so a single
                // owner can never lock the venue out; show that rather than let
                // the owner discover it by being refused.
                const isSelf = s.id === me?.id;
                return (
                  <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                    <td style={cell}>
                      {s.display_name}
                      {isSelf && (
                        <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.75rem' }}>
                          {' '}
                          {tr('op.staff.you')}
                        </span>
                      )}
                    </td>
                    <td style={cell}>
                      <Select<StaffRole>
                        value={s.role}
                        disabled={isSelf || setRole.isPending}
                        onChange={(role) => setRole.mutate({ id: s.id, role })}
                        options={ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))}
                        style={{ minInlineSize: '9rem' }}
                      />
                    </td>
                    <td style={cell}>
                      {s.role === 'manager' || s.role === 'owner' ? (
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.8rem' }}>
                            {s.has_pin ? tr('op.staff.pinSet') : tr('op.staff.pinNone')}
                          </span>
                          <Button kind="ghost" onClick={() => setPinFor(s)}>
                            {s.has_pin ? tr('op.staff.pinChange') : tr('op.staff.pinSetAction')}
                          </Button>
                          {s.has_pin && (
                            <Button kind="ghost" onClick={() => clearPin.mutate(s.id)}>
                              {tr('op.staff.pinClear')}
                            </Button>
                          )}
                        </div>
                      ) : (
                        // A PIN authorises discounts and voids; only manager and
                        // owner have anything to authorise (0026).
                        <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
                      )}
                    </td>
                    <td style={cell}>
                      {s.is_active ? tr('op.staff.active') : tr('op.staff.inactive')}
                    </td>
                    <td style={cell}>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Button kind="ghost" onClick={() => void promptRename(s)}>
                          {tr('op.common.edit')}
                        </Button>
                        <Button kind="ghost" onClick={() => setPasswordFor(s)}>
                          {tr('op.staff.resetPassword')}
                        </Button>
                        <Button
                          kind={s.is_active ? 'danger' : undefined}
                          disabled={isSelf || setActive.isPending}
                          onClick={() => void toggleActive(s)}
                        >
                          {s.is_active ? tr('op.staff.deactivate') : tr('op.staff.activate')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {owners === 1 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>{tr('op.staff.oneOwner')}</p>
      )}

      {adding && (
        <AddStaffDialog
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void refresh();
          }}
        />
      )}
      {passwordFor && (
        <PasswordDialog staff={passwordFor} onClose={() => setPasswordFor(null)} />
      )}
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
    onError: (e) => toast.err(e),
  });

  const ready = email.includes('@') && name.trim() !== '' && password.length >= MIN_PASSWORD;

  return (
    <Modal title={tr('op.staff.add')} onClose={onClose}>
      <Field label={tr('auth.emailLabel')}>
        <input
          style={inputStyle}
          dir="ltr"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label={tr('op.staff.name')}>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('op.staff.role')}>
        <Select<StaffRole>
          value={role}
          onChange={setRole}
          options={ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))}
        />
      </Field>
      <Field label={tr('op.staff.openingPassword')}>
        <input
          style={inputStyle}
          dir="ltr"
          type="text"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {/* Shown, not masked: the owner reads this out during training and the
          staff member changes it afterwards. Masking a value you must dictate
          aloud only produces typos. */}
      <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
        {tr('op.staff.passwordHint', { min: MIN_PASSWORD })}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {tr('op.staff.add')}
        </Button>
      </div>
    </Modal>
  );
}

function PasswordDialog({ staff, onClose }: { staff: StaffRow; onClose(): void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () =>
      callEdge<unknown, { result: string }>(
        'staff-admin',
        { action: 'reset_password', staff_id: staff.id, password },
        { ttlMs: 0 },
      ),
    onSuccess: () => {
      toast.ok(tr('op.staff.passwordReset'));
      onClose();
    },
    onError: (e) => toast.err(e),
  });

  return (
    <Modal title={tr('op.staff.resetPasswordFor', { name: staff.display_name })} onClose={onClose}>
      <Field label={tr('op.staff.openingPassword')}>
        <input
          style={inputStyle}
          dir="ltr"
          type="text"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
        {tr('op.staff.passwordHint', { min: MIN_PASSWORD })}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button
          kind="primary"
          disabled={password.length < MIN_PASSWORD || reset.isPending}
          onClick={() => reset.mutate()}
        >
          {tr('op.staff.resetPassword')}
        </Button>
      </div>
    </Modal>
  );
}

function PinDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffRow;
  onClose(): void;
  onSaved(): void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const [pin, setPin] = useState('');

  const save = useMutation({
    mutationFn: () => appRpc('set_staff_pin', { p_staff_id: staff.id, p_pin: pin }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      onSaved();
    },
    onError: (e) => toast.err(e),
  });

  // 4-6 digits, matching app.set_staff_pin's own check, so the refusal is
  // caught here rather than after a round trip.
  const valid = /^[0-9]{4,6}$/.test(pin);

  return (
    <Modal title={tr('op.staff.pinFor', { name: staff.display_name })} onClose={onClose}>
      <Field label={tr('op.common.pin')}>
        <input
          style={inputStyle}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </Field>
      <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>{tr('op.staff.pinHint')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {tr('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
