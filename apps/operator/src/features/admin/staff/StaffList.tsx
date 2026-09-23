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
 * WHY THE ROWS NO LONGER CARRY CONTROLS
 *
 * Every row used to hold a live role dropdown, two PIN buttons, Edit, Reset
 * password and a red Remove — and the Edit panel beside it repeated all of
 * them. A role dropdown that saves on change is one slip of the mouse from
 * making a cashier an owner, with nothing asking first; and a table of five
 * red buttons read as five alarms. The screen is opened a few times a year, so
 * the question it must answer at a glance is "who can sign in, as what", and
 * the changes belong in one place that explains each before it happens.
 *
 * So a row is a reading — name, role with what the role can open, the manager
 * PIN, whether they can sign in — and "Manage" opens the account panel
 * (StaffAccountEditor), where every change says what it does and the ones that
 * take something away are confirmed. People who no longer have access fold
 * away, the way switched-off rate rules do, so the table is the team as it is.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { useCafeSettings, useSetCafeSetting } from '../../../lib/settings';
import { appRpc } from '../../../lib/appRpc';
import { callEdge } from '../../../lib/edge';
import { useAuth, usePermissions, requiredRoleFor, type StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, Field, Modal, inputStyle } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { StaffAccountEditor } from './StaffAccountEditor';
import { RoleField, StaffErrorText } from './staffParts';
import {
  MIN_PASSWORD,
  PIN_MAX,
  PIN_MIN,
  STAFF_QUERY_KEY,
  approvesWithPin,
  isRetiredRole,
  looksLikeEmail,
  pinFormatOk,
  type StaffRow,
} from './staffModel';

export { STAFF_QUERY_KEY } from './staffModel';

export function StaffList() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const { staff: me } = useAuth();
  const can = usePermissions();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<StaffRow | null>(null);
  const [pinFor, setPinFor] = useState<StaffRow | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const staffQ = useQuery({
    queryKey: STAFF_QUERY_KEY,
    // app.list_staff, not a table select: pin_hash is deliberately outside the
    // client column grant (0004:170), and a bcrypt hash of a 4-6 digit PIN is
    // brute-forceable offline in seconds. The server returns the boolean.
    queryFn: () => appRpc<StaffRow[]>('list_staff'),
  });
  const rows = useMemo(() => [...(staffQ.data ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name)), [staffQ.data]);
  const removedCount = rows.filter((r) => !r.is_active).length;
  const shown = showRemoved ? rows : rows.filter((r) => r.is_active);
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  const owners = rows.filter((s) => s.role === 'owner' && s.is_active).length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      header: tr('ws.owner.staff.columns.name'),
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi style={{ fontWeight: 600, whiteSpace: 'nowrap', color: s.is_active ? undefined : 'var(--tp-muted-fg)' }}>{s.display_name}</bdi>
          {s.id === me?.id && <StatusBadge size="sm" tone="info" dot={false} label={tr('op.staff.you')} />}
        </span>
      ),
    },
    {
      key: 'role',
      header: tr('ws.owner.staff.columns.role'),
      render: (s) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{tr(`op.roles.${s.role}`)}</span>
            {/* Prep since 0155: it still works but is no longer given. The badge
                stays when the panel is open and the line beneath does not. */}
            {isRetiredRole(s.role) && <StatusBadge size="sm" tone="warn" dot={false} label={tr('ws.owner.staff.retired')} />}
          </span>
          {/* With the panel open the panel says it, and the column is too narrow to. */}
          {!open && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`ws.owner.staff.roleAccess.${s.role}`)}</span>}
        </span>
      ),
    },
    {
      key: 'pin',
      header: tr('ws.owner.staff.columns.pin'),
      render: (s) =>
        // Every role holds a PIN since 0105 (breaks, idle lock). A missing one
        // is a warning only where it also blocks approvals: a manager without a
        // PIN cannot approve anything at the till.
        s.has_pin ? (
          <StatusBadge tone="success" size="sm" label={tr('op.staff.pinSet')} />
        ) : (
          <StatusBadge tone={approvesWithPin(s.role) ? 'warn' : 'neutral'} size="sm" label={tr('op.staff.pinNone')} />
        ),
    },
    {
      key: 'access',
      header: tr('ws.owner.staff.columns.status'),
      render: (s) =>
        s.is_active ? (
          <StatusBadge tone="success" size="sm" label={tr('ws.owner.staff.status.active')} />
        ) : (
          <StatusBadge tone="neutral" size="sm" label={tr('ws.owner.staff.status.inactive')} />
        ),
    },
    {
      key: 'manage',
      header: <span className="tp-sr-only">{tr('ws.owner.staff.columns.actions')}</span>,
      align: 'end',
      width: '8rem',
      render: (s) => (
        // No chevron: Button's iconEnd does not mirror in Arabic, so it pointed backwards there.
        <Button size="sm" onClick={() => setOpenId(s.id)}>
          {tr('ws.owner.staff.manage')}
        </Button>
      ),
    },
  ];
  // With the panel open, a row click moves it to another person; the button
  // column only cost the table the width its Access column needed at 1100px.
  const tableColumns = open ? columns.filter((c) => c.key !== 'manage') : columns;

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
      {!can.manageStaff && <PermissionRefusedNotice action={tr('ws.owner.staff.refusedAction')} requiredRole={requiredRoleFor('manageStaff')} style={{ marginBlockEnd: 'var(--tp-sp-4)' }} />}

      <div style={{ display: 'grid', gridTemplateColumns: open ? 'minmax(0, 1fr) minmax(19rem, 24rem)' : 'minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
        <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {/* One owner is a real risk, not trivia: if that account is lost,
              nobody can manage staff. Said once, above the list it concerns. */}
          {staffQ.data && owners === 1 && <MessagePresenter tone="info" message={tr('op.staff.oneOwner')} />}
          <BreakAllowancePanel canManage={can.manageStaff} />
          <AsyncStateWrapper
            status={asyncStatus(staffQ, (d) => d.length === 0)}
            error={staffQ.error}
            onRetry={() => void staffQ.refetch()}
            skeleton={<TableSkeleton columns={columns} />}
            emptyContent={
              <EmptyState
                icon="users"
                title={tr('ws.owner.staff.emptyTitle')}
                body={tr('ws.owner.staff.emptyBody')}
                action={
                  <Button kind="primary" disabled={!can.manageStaff} onClick={() => setAdding(true)}>
                    {tr('op.staff.add')}
                  </Button>
                }
              />
            }
          >
            <DataTable
              columns={tableColumns}
              rows={shown}
              rowKey={(s) => s.id}
              selectedKey={openId}
              onRowClick={(s) => setOpenId(s.id)}
              aria-label={tr('op.staff.title')}
            />
            {removedCount > 0 && (
              <div>
                <Button size="sm" kind="ghost" onClick={() => setShowRemoved((v) => !v)}>
                  {showRemoved
                    ? tr('ws.owner.staff.hideRemoved')
                    : tr('ws.owner.staff.showRemoved', { count: formatNumber(removedCount, locale) })}
                </Button>
              </div>
            )}
          </AsyncStateWrapper>
        </div>
        {open && (
          <StaffAccountEditor
            key={open.id}
            staff={open}
            isSelf={open.id === me?.id}
            canManage={can.manageStaff}
            onClose={() => setOpenId(null)}
            onResetPassword={() => setPasswordFor(open)}
            onSetPin={() => setPinFor(open)}
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
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('cashier');
  const [password, setPassword] = useState('');

  const create = useMutation({
    mutationFn: () =>
      callEdge<unknown, { result: string }>(
        'staff-admin',
        { action: 'create', email: email.trim(), password, display_name: name.trim(), role },
        // Never cache a mutation: a second create must reach the server.
        { ttlMs: 0 },
      ),
    onSuccess: () => {
      toast.ok(tr('op.staff.created'));
      onCreated();
    },
  });

  // Said while typing, not after a refused round trip — but only once there is
  // something to judge, so an empty form does not open in red.
  const emailProblem = email.trim() !== '' && !looksLikeEmail(email) ? tr('ws.owner.staff.add.emailInvalid') : undefined;
  const passwordProblem =
    password !== '' && password.length < MIN_PASSWORD
      ? tr('ws.owner.staff.add.passwordShort', { count: formatNumber(MIN_PASSWORD - password.length, locale) })
      : undefined;
  const ready = looksLikeEmail(email) && name.trim() !== '' && password.length >= MIN_PASSWORD;

  return (
    <Modal
      title={tr('op.staff.add')}
      subtitle={tr('ws.owner.staff.add.lead')}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={create.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="userPlus"
            disabled={!ready}
            disabledReason={!ready ? tr('ws.owner.staff.add.notReady') : undefined}
            busy={create.isPending}
            onClick={() => create.mutate()}
          >
            {tr('op.staff.add')}
          </Button>
        </>
      )}
    >
      <Field label={tr('op.staff.name')} required hint={tr('ws.owner.staff.add.nameHint')}>
        <input style={inputStyle} autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('auth.emailLabel')} required hint={tr('ws.owner.staff.add.emailHint')} error={emailProblem}>
        <input style={inputStyle} dir="ltr" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <RoleField value={role} onChange={setRole} />
      {/* Shown, not masked: the owner reads this out during training and the
          staff member changes it afterwards. Masking a value you must dictate
          aloud only produces typos. */}
      <Field label={tr('op.staff.openingPassword')} required hint={tr('op.staff.passwordHint', { min: formatNumber(MIN_PASSWORD, locale) })} error={passwordProblem}>
        <input style={inputStyle} dir="ltr" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <StaffErrorText error={create.error} />
    </Modal>
  );
}

function PasswordDialog({ staff, onClose }: { staff: StaffRow; onClose(): void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () => callEdge<unknown, { result: string }>('staff-admin', { action: 'reset_password', staff_id: staff.id, password }, { ttlMs: 0 }),
    onSuccess: () => {
      toast.ok(tr('op.staff.passwordReset'));
      onClose();
    },
  });

  const short = password.length < MIN_PASSWORD;

  return (
    <Modal
      title={tr('op.staff.resetPasswordFor', { name: staff.display_name })}
      subtitle={tr('ws.owner.staff.password.lead')}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={reset.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="lock"
            disabled={short}
            disabledReason={short ? tr('ws.owner.staff.password.tooShort', { min: formatNumber(MIN_PASSWORD, locale) }) : undefined}
            busy={reset.isPending}
            onClick={() => reset.mutate()}
          >
            {tr('ws.owner.staff.password.save')}
          </Button>
        </>
      )}
    >
      <Field label={tr('ws.owner.staff.password.label')} hint={tr('op.staff.passwordHint', { min: formatNumber(MIN_PASSWORD, locale) })}>
        <input style={inputStyle} dir="ltr" type="text" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <StaffErrorText error={reset.error} />
    </Modal>
  );
}

/**
 * 0105: the daily break allowance, per person, across all their breaks. It
 * lives on the Staff screen rather than under Settings because it is a rule
 * about people, and the owner who sets PINs is the one who sets it.
 */
function BreakAllowancePanel({ canManage }: { canManage: boolean }) {
  const { tr } = useLocale();
  const toast = useToast();
  const { settings, isLoading } = useCafeSettings();
  const save = useSetCafeSetting();
  const [draft, setDraft] = useState<string | null>(null);
  const current = settings.break_allowance_minutes;
  const value = draft ?? String(current);
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= 480;
  const dirty = draft !== null && parsed !== current;

  return (
    <Panel title={tr('ws.owner.staff.breaks.title')}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label={tr('ws.owner.staff.breaks.allowance')} hint={tr('ws.owner.staff.breaks.hint')} style={{ marginBlockEnd: 0, flex: '1 1 18rem' }}>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, inlineSize: '6rem', textAlign: 'center' }}
              inputMode="numeric"
              dir="ltr"
              value={value}
              disabled={!canManage || isLoading || save.isPending}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.staff.breaks.minutes')}</span>
          </div>
        </Field>
        {dirty && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)' }}>
            <Button size="sm" kind="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
              {tr('ws.kit.actions.discard')}
            </Button>
            <Button
              size="sm"
              kind="primary"
              icon="check"
              busy={save.isPending}
              disabled={!valid || !canManage}
              disabledReason={!valid ? tr('ws.owner.staff.breaks.hint') : undefined}
              onClick={() =>
                save.mutate(
                  { key: 'break_allowance_minutes', value: parsed },
                  {
                    onSuccess: () => {
                      setDraft(null);
                      toast.ok(tr('ws.owner.staff.breaks.saved'));
                    },
                    onError: (e) => toast.err(e),
                  },
                )
              }
            >
              {tr('ws.owner.staff.breaks.save')}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function PinDialog({ staff, onClose, onSaved }: { staff: StaffRow; onClose(): void; onSaved(): void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [pin, setPin] = useState('');

  const save = useMutation({
    mutationFn: () => appRpc('set_staff_pin', { p_staff_id: staff.id, p_pin: pin }),
    onSuccess: () => {
      toast.ok(tr('ws.owner.staff.pin.saved'));
      onSaved();
    },
  });

  // 6-12 digits, matching app.set_staff_pin's own check since 0078 (SEC-13).
  // The field used to stop at 6 digits while its hint said "4 to 6", so a
  // four-digit PIN left Save dead with nothing saying why. The server
  // additionally refuses a repeated digit or a sequential run (PIN_WEAK) —
  // deliberately NOT mirrored here: duplicating the blocklist in the client is
  // how the two drift apart. StaffErrorText says it in words when it comes back.
  const valid = pinFormatOk(pin);
  const n = (v: number) => formatNumber(v, locale);

  return (
    <Modal
      title={staff.has_pin ? tr('ws.owner.staff.pin.changeFor', { name: staff.display_name }) : tr('ws.owner.staff.pin.setFor', { name: staff.display_name })}
      subtitle={tr('ws.owner.staff.pin.lead')}
      onClose={onClose}
      size="sm"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={save.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="lock"
            disabled={!valid}
            disabledReason={!valid ? tr('ws.owner.staff.pin.length', { min: n(PIN_MIN), max: n(PIN_MAX) }) : undefined}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            {tr('common.save')}
          </Button>
        </>
      )}
    >
      <Field label={tr('ws.owner.staff.pin.label')} hint={tr('ws.owner.staff.pin.hint', { min: n(PIN_MIN), max: n(PIN_MAX) })}>
        <input
          style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.3em', textAlign: 'center' }}
          dir="ltr"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !save.isPending) save.mutate();
          }}
        />
      </Field>
      <StaffErrorText error={save.error} />
    </Modal>
  );
}
