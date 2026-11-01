/**
 * Leaving the station: Quit and Exit forced full screen share one PIN rule,
 * and Quit is offered from three places with no rail behind them — the idle
 * lock (F-48) and the retired-station screen (F-49) besides the rail itself.
 * Moved out of routes/__root.tsx (2026-11-01) so all of them run the SAME
 * flow and the lock and the retired screen can be tested on their own.
 *
 * Staff are kept inside the app (owner call, 2026-09-23): on a locked station
 * (StationInfo.locked — every configured production one) Quit and Exit forced
 * full screen take a manager's PIN, and never the signed-in person's own. The
 * owner is let out with the confirmation alone (2026-09-27); main confirms the
 * role itself (main/owner-exit.ts) and answers `pin required` when it cannot.
 */
import { useState } from 'react';
import { useAuth, can } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { appRpc, AppRpcError } from '../lib/appRpc';
import { PIN_MAX, pinDigits, pinLongEnough } from '../lib/pinRules';
import { useUpdateReady } from '../lib/updates';
import { touch, type LeaveResult } from '../ipc/bridge';
import { Button, ErrorText, Field, inputStyle } from './ui';

/** True inside the Electron shell; browser mode has no kiosk to leave. */
export function hasShell(): boolean {
  return typeof window !== 'undefined' && !!window.touch;
}

/**
 * Signed in, the PIN is proved to verify_manager_pin first. It returns the
 * manager's id, which is how "not your own" is told, and the PIN is then
 * cached tagged with that id so main — which re-checks every exit against the
 * offline cache (pin-cache.ts mayLeave) — can tell the same thing offline.
 * Offline, the call fails as UNKNOWN and main's cache is the whole check.
 * Signed out there is no session to ask the server with, and no "own" to
 * exclude: main's cache alone decides.
 */
export async function proveLeavePin(pin: string, signedInStaffId: string | null): Promise<void> {
  if (!signedInStaffId) return;
  try {
    const authorizer = await appRpc<string | null>('verify_manager_pin', {
      p_pin: pin,
      p_device_id: touch.getStation().stationId,
    });
    // null is a wrong PIN (the function raises only for a lockout or a
    // non-staff caller); refused before the cache can learn it.
    if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
    if (authorizer === signedInStaffId) throw new AppRpcError('PIN_OWN', 'PIN_OWN');
    touch.pinObserved(pin, authorizer);
  } catch (e) {
    if (e instanceof AppRpcError && e.code !== 'UNKNOWN') throw e;
  }
}

/** Main's answer to quitApp / exitFullscreen, as the error the dialog shows (null: let out). */
export function leaveRefusal(res: LeaveResult): Error | null {
  if (res.ok) return null;
  if (res.error === 'own pin') return new AppRpcError('PIN_OWN', res.error);
  // The same fact the server states as PIN_INVALID, so it reads "Incorrect
  // PIN." — at sign-in the cache is the only check that ran.
  if (res.error === 'pin not recognised') return new AppRpcError('PIN_INVALID', res.error);
  return new Error(res.error);
}

/** The manager PIN for leaving: 4 to 12 digits (F-50), Enter sends once long enough. */
export function LeavePinField({
  pin,
  setPin,
  busy,
  onEnter,
}: {
  pin: string;
  setPin: (pin: string) => void;
  busy: boolean;
  onEnter: () => void;
}) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.shell.nav.leavePin')} hint={tr('ws.shell.nav.leavePinHint')}>
      <input
        style={inputStyle}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        autoFocus
        maxLength={PIN_MAX}
        disabled={busy}
        value={pin}
        data-testid="leave.pin"
        onChange={(e) => setPin(pinDigits(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && pinLongEnough(pin) && !busy && onEnter()}
      />
    </Field>
  );
}

export interface QuitFlow {
  pin: string;
  setPin: (pin: string) => void;
  error: unknown;
  busy: boolean;
  /** Main could not confirm the owner, so a manager's PIN is asked after all. */
  askPin: boolean;
  needsPin: boolean;
  /** The Quit button may be pressed. */
  ready: boolean;
  quit: () => Promise<void>;
  reset: () => void;
}

/** Quit to desktop's state and press, one copy for every place that offers it. */
export function useQuitFlow(): QuitFlow {
  const { staff } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askPin, setAskPin] = useState(false);
  const locked = hasShell() && touch.getStation().locked === true;
  const needsPin = locked && (askPin || !can(staff, 'leaveStationWithoutPin'));

  function reset() {
    setPin('');
    setError(null);
    setAskPin(false);
  }

  async function quit() {
    setBusy(true);
    setError(null);
    try {
      if (needsPin) await proveLeavePin(pin, staff?.id ?? null);
      // Main exits ~50 ms after replying, so `busy` is the last thing the
      // screen shows on success.
      const res = await touch.quitApp(needsPin ? pin : '');
      if (!res.ok && res.error === 'pin required') {
        setAskPin(true);
        setBusy(false);
        return;
      }
      const refusal = leaveRefusal(res);
      if (refusal) throw refusal;
    } catch (e) {
      setError(e);
      setPin('');
      setBusy(false);
    }
  }

  return { pin, setPin, error, busy, askPin, needsPin, ready: !needsPin || pinLongEnough(pin), quit, reset };
}

/** What the Quit confirmation says, above its PIN field. */
export function QuitNotes({ flow }: { flow: QuitFlow }) {
  const { tr } = useLocale();
  // With an update waiting, Quit installs it and the app opens again on it
  // (main/updater.ts installOnQuit): someone quitting to reach the desktop
  // is told before the app comes back on its own.
  const update = useUpdateReady();
  return (
    <>
      <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.nav.quitConfirm')}</p>
      {update && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.nav.quitInstallsUpdate')}</p>}
      {flow.askPin && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.nav.leaveOwnerUnconfirmed')}</p>}
    </>
  );
}

/**
 * Quit drawn INSIDE a full-screen card (the idle lock, the retired screen)
 * rather than as a Modal: a dialog over those sits under them (--tp-z-lock),
 * the same reason the lock's leaving guard is drawn in place.
 */
export function InlineQuitPanel({ onBack }: { onBack: () => void }) {
  const { tr } = useLocale();
  const flow = useQuitFlow();
  return (
    <div data-testid="quit.panel" style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>{tr('ws.shell.nav.quit')}</h3>
      <QuitNotes flow={flow} />
      {flow.needsPin && <LeavePinField pin={flow.pin} setPin={flow.setPin} busy={flow.busy} onEnter={() => void flow.quit()} />}
      <ErrorText error={flow.error} style={{ marginBlock: 0 }} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button
          onClick={() => {
            flow.reset();
            onBack();
          }}
          disabled={flow.busy}
        >
          {tr('common.back')}
        </Button>
        <Button kind="danger" busy={flow.busy} disabled={!flow.ready} onClick={() => void flow.quit()} data-testid="quit.confirm">
          {tr('ws.shell.nav.quit')}
        </Button>
      </div>
    </div>
  );
}
