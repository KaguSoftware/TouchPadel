/**
 * F-49: the whole screen of a station that was retired. Nothing behind it is
 * mounted — no rail, no routed screen, no till, no queue writes — so a
 * retired till cannot sell, order, pay or take a shift. What it offers is the
 * way back (a manager or the owner registers this machine again, as
 * Settings › Cashier computers does) and the ways off (Sign out, Quit).
 */
import { useState } from 'react';
import { useAuth, can } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { appRpc } from '../lib/appRpc';
import { useVenue } from '../lib/venue';
import { touch } from '../ipc/bridge';
import { BrandLockup } from './brand';
import { Icon } from './icons';
import { Button, ErrorText, card } from './ui';
import { InlineQuitPanel, hasShell } from './LeaveStation';

export function StationRetiredScreen({ stationId, onRegistered }: { stationId: string; onRegistered: () => void }) {
  const { tr } = useLocale();
  const { staff, signOut } = useAuth();
  const { branchId } = useVenue();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [quitting, setQuitting] = useState(false);
  const mayRegister = can(staff, 'registerStation') && Boolean(branchId);
  const mode = touch.getStation().mode;

  async function register() {
    setBusy(true);
    setError(null);
    try {
      // The same call Settings › Cashier computers makes (StationsPanel):
      // this machine's own id and kind, at the branch in scope. It clears
      // retired_at (0229), so the next beat answers registered again.
      await appRpc('register_station', {
        p_id: stationId,
        p_venue_id: branchId,
        p_mode: mode === 'desk' || mode === 'kds' || mode === 'shop' ? mode : 'till',
      });
      onRegistered();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      data-testid="station-retired"
      style={{ minBlockSize: '100vh', display: 'grid', placeItems: 'center', paddingBlock: 'var(--tp-sp-6)', paddingInline: 'var(--tp-sp-5)', background: 'var(--tp-bg)' }}
    >
      <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-5)' }}>
        <BrandLockup size={48} title="Touch Padel" />
        <div style={{ ...card, inlineSize: 'min(28rem, 92vw)', display: 'grid', gap: 'var(--tp-sp-4)', paddingBlock: 'var(--tp-sp-6)', paddingInline: 'var(--tp-sp-5)' }}>
          <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 'var(--tp-sp-2)' }}>
            <span style={{ display: 'grid', placeItems: 'center', inlineSize: '3rem', blockSize: '3rem', borderRadius: '50%', background: 'var(--tp-warn-soft)', color: 'var(--tp-warn-fg)' }}>
              <Icon name="ban" size={22} />
            </span>
            <h1 style={{ fontSize: 'var(--tp-fs-2xl)' }}>{tr('ws.shell.retired.title')}</h1>
            <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.retired.body', { station: `\u2068${stationId}\u2069` })}</p>
          </div>
          {quitting ? (
            <InlineQuitPanel onBack={() => setQuitting(false)} />
          ) : (
            <>
              {mayRegister ? (
                <Button kind="primary" size="lg" icon="refresh" busy={busy} onClick={() => void register()} style={{ inlineSize: '100%' }} data-testid="station-retired.register">
                  {tr('ws.shell.retired.register')}
                </Button>
              ) : (
                <p style={{ textAlign: 'center', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.shell.retired.askManager')}</p>
              )}
              <ErrorText error={error} style={{ marginBlock: 0 }} />
              <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-3)' }}>
                <Button kind="ghost" size="sm" icon="logOut" onClick={() => void signOut()} disabled={busy}>
                  {tr('ws.shell.retired.signOut')}
                </Button>
                {hasShell() && (
                  <Button kind="ghost" size="sm" icon="x" onClick={() => setQuitting(true)} disabled={busy} data-testid="station-retired.quit">
                    {tr('ws.shell.nav.quit')}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
