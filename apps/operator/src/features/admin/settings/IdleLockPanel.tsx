/**
 * Settings › Cashier computers: how long a station waits before it locks
 * itself (F-48). The cafe setting till_idle_lock_seconds (0064) could only be
 * changed in the database; every station of the branch reads it for its idle
 * lock (routes/__root.tsx IdleLock). The owner picks it; a manager sees it.
 * Saved through app.set_cafe_setting, which checks the range (0..3600 s).
 */
import { formatNumber } from '@touch/i18n';
import { can, useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useCafeSettings, useSetCafeSetting } from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { Field, Select } from '../../../components/ui';
import { MessagePresenter, Panel } from '../../../components/kit';
import { idleLockChoices, idleLockLabel } from './idleLockLogic';

export function IdleLockPanel() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const canEdit = can(staff, 'setIdleLock');
  const { settings, isLoading } = useCafeSettings();
  const save = useSetCafeSetting();
  const current = settings.till_idle_lock_seconds;

  const label = (seconds: number) => {
    const l = idleLockLabel(seconds);
    if (l.kind === 'never') return tr('ws.shell.lockTimeout.never');
    if (l.kind === 'minutes') return tr('ws.shell.lockTimeout.minutes', { n: formatNumber(l.minutes, locale) });
    return tr('ws.shell.lockTimeout.seconds', { n: formatNumber(l.seconds, locale) });
  };

  return (
    <Panel title={tr('ws.shell.lockTimeout.title')} data-testid="idle-lock-panel">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.lockTimeout.lead')}</p>
        {!canEdit && <MessagePresenter tone="info" icon="lock" message={tr('ws.shell.lockTimeout.ownerOnly')} />}
        <Field label={tr('ws.shell.lockTimeout.label')} style={{ marginBlockEnd: 0, maxInlineSize: '16rem' }}>
          <Select<string>
            value={String(current)}
            disabled={!canEdit || isLoading || save.isPending}
            options={idleLockChoices(current).map((s) => ({ value: String(s), label: label(s) }))}
            onChange={(v) => {
              const next = Number(v);
              if (next === current) return;
              save.mutate(
                { key: 'till_idle_lock_seconds', value: next },
                {
                  onSuccess: () => toast.ok(tr('ws.shell.lockTimeout.saved')),
                  onError: (e) => toast.err(e),
                },
              );
            }}
          />
        </Field>
      </div>
    </Panel>
  );
}
