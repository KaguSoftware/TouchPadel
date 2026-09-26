/**
 * The leaving guard on the idle lock (wave5-addendum §5.1, §6.2). "Switch
 * user" with the signed-in person's own shift open here asks first, INSIDE the
 * lock card: a dialog over the lock would sit under it (--tp-z-lock), and the
 * lock is not closable. The person at the lock may not be the shift's holder,
 * so it only says what signing out leaves behind; ending the shift is the
 * holder's (their PIN) or a manager's (the rail's Close, after unlocking).
 */
import { isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';

export function LockLeaveGuard({ name, onBack, onSignOut }: { name: string; onBack: () => void; onSignOut: () => void }) {
  const { tr } = useLocale();
  return (
    <div
      role="alert"
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        justifyItems: 'center',
        textAlign: 'center',
        borderBlockStart: '1px solid var(--tp-border)',
        paddingBlockStart: 'var(--tp-sp-3)',
      }}
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', textWrap: 'balance' }}>{tr('ws.tillShift.leave.lock', { name: isolate(name) })}</p>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button size="sm" autoFocus onClick={onBack}>
          {tr('ws.tillShift.leave.lockBack')}
        </Button>
        <Button size="sm" kind="danger" icon="logOut" onClick={onSignOut} data-testid="lock.signOutAnyway">
          {tr('ws.tillShift.leave.signOut')}
        </Button>
      </div>
    </div>
  );
}
