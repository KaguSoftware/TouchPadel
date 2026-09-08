/**
 * StaffAccountEditorScreen (spec 06.46) — one account, edited in an inline
 * panel beside the list. Name → `rename_staff`, role → `set_staff_role`,
 * enabled → `set_staff_active`, PIN → `set_staff_pin` / `clear_staff_pin`.
 * Each is the owner-gated RPC from migration 0051/0026; the panel only
 * decides which of them a save has to call. States: ready · busy · error · dirty.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import type { StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import { MessagePresenter, Panel, StatusBadge } from '../../../components/kit';
import { Switch } from '../../../components/Switch';
import { ROLES, STAFF_QUERY_KEY, type StaffRow } from './staffModel';

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
  const [active, setActive] = useState(staff.is_active);
  const [error, setError] = useState<unknown>(null);

  const nameDirty = name.trim() !== '' && name.trim() !== staff.display_name;
  const roleDirty = role !== staff.role;
  const activeDirty = active !== staff.is_active;
  const dirty = nameDirty || roleDirty || activeDirty;
  const locked = !canManage || isSelf;

  const save = useMutation({
    mutationFn: async () => {
      // Row changes only; each RPC is audited on its own, so they run in sequence
      // and the first refusal stops the rest with its own error code.
      if (nameDirty) await appRpc('rename_staff', { p_staff_id: staff.id, p_display_name: name.trim() });
      if (roleDirty) await appRpc('set_staff_role', { p_staff_id: staff.id, p_role: role });
      if (activeDirty) await appRpc('set_staff_active', { p_staff_id: staff.id, p_active: active });
    },
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      setError(null);
      void queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });
    },
    onError: (e) => setError(e),
  });

  const clearPin = useMutation({
    mutationFn: () => appRpc('clear_staff_pin', { p_staff_id: staff.id }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });
    },
    onError: (e) => setError(e),
  });

  async function submit() {
    if (activeDirty && !active) {
      const ok = await confirm({
        title: tr('op.staff.confirmDeactivate'),
        body: tr('op.staff.confirmDeactivateBody', { name: staff.display_name }),
        kind: 'danger',
        confirmLabel: tr('op.staff.deactivate'),
      });
      if (!ok) return;
    }
    save.mutate();
  }

  function discard() {
    setName(staff.display_name);
    setRole(staff.role);
    setActive(staff.is_active);
    setError(null);
  }

  const holdsPin = role === 'manager' || role === 'owner';
  const busy = save.isPending || clearPin.isPending;

  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
          {tr('ws.owner.staff.editor.title')} — <bdi>{staff.display_name}</bdi>
          {dirty && <StatusBadge tone="warn" size="sm" label={tr('ws.owner.staff.editor.unsaved')} />}
        </span>
      }
      actions={<Button kind="ghost" size="sm" icon="x" aria-label={tr('ws.owner.staff.editor.close')} onClick={onClose} disabled={busy} />}
      data-testid="staff-editor"
    >
      {isSelf && <MessagePresenter tone="info" message={tr('ws.owner.staff.editor.selfNote')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />}

      <Field label={tr('ws.owner.staff.editor.name')}>
        <input style={inputStyle} value={name} disabled={!canManage || busy} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('ws.owner.staff.editor.email')} hint={tr('ws.owner.staff.editor.emailNote')}>
        <input style={inputStyle} dir="ltr" value="" placeholder="—" disabled readOnly />
      </Field>
      <Field label={tr('ws.owner.staff.editor.role')} hint={tr('ws.owner.staff.editor.roleNote')}>
        <Select<StaffRole> value={role} disabled={locked || busy} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))} style={{ maxInlineSize: '14rem' }} />
      </Field>

      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <span style={{ display: 'block', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.owner.staff.editor.pin')}</span>
        {holdsPin ? (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge tone={staff.has_pin ? 'success' : 'neutral'} size="sm" label={staff.has_pin ? tr('op.staff.pinSet') : tr('op.staff.pinNone')} />
            <Button size="sm" icon="lock" disabled={!canManage || busy} onClick={onSetPin}>
              {staff.has_pin ? tr('op.staff.pinChange') : tr('op.staff.pinSetAction')}
            </Button>
            {staff.has_pin && (
              <Button size="sm" kind="ghost" busy={clearPin.isPending} disabled={!canManage || save.isPending} onClick={() => clearPin.mutate()}>
                {tr('op.staff.pinClear')}
              </Button>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.staff.editor.pinNotApplicable')}</span>
        )}
        <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-1)' }}>{tr('ws.owner.staff.editor.pinNote')}</span>
      </div>

      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Switch checked={active} label={tr('ws.owner.staff.editor.enabled')} disabled={locked || busy} onChange={(next) => setActive(next)} />
        <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-1)' }}>{tr('ws.owner.staff.editor.enabledNote')}</span>
      </div>

      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Button size="sm" icon="lock" disabled={!canManage || busy} onClick={onResetPassword}>
          {tr('op.staff.resetPassword')}
        </Button>
      </div>

      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end' }}>
        <Button onClick={discard} disabled={!dirty || busy}>
          {tr('ws.kit.actions.discard')}
        </Button>
        <Button kind="primary" icon="check" busy={save.isPending} disabled={!dirty || !canManage || clearPin.isPending} onClick={() => void submit()}>
          {tr('ws.kit.actions.save')}
        </Button>
      </div>
    </Panel>
  );
}
