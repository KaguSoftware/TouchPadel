/**
 * "Staff QR" (0442): the rail footer row any signed-in person presses to show the desk's clock QR
 * full screen, for a colleague who arrives after the station is signed in. The same QR logs
 * arriving and leaving. Without a key on this machine the view says the desk is not set up, and
 * whoever may set it up does it right here with one press (useSetUpDesk: it registers the computer
 * at the branch when it is not yet a station); the QR then takes the screen. Settings › Stations
 * keeps the club's location and the other desks.
 *
 * It also exports the sign-in screen's panel (`SignInClockPanel`): before anyone signs in, the
 * QR is the first thing on the station.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { ScreenOwnerClaim } from '../../lib/screenOwner';
import { useVenue } from '../../lib/venue';
import { isRpcMissing } from '../../lib/appRpc';
import { Button, ErrorText, trapTab } from '../../components/ui';
import { Icon } from '../../components/icons';
import { railLabelStyle } from '../../components/railStyles';
import { ClockQrCode, useStationKey } from './ClockQr';
import { CK, fetchClockSetup } from './api';
import { isKeyNotKept, useSetUpDesk } from './useSetUpDesk';

export const CLOCK_SETUP_ROUTE = '/admin/settings/stations';

export function StaffQrRailButton({ style }: { style?: CSSProperties }) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="tp-nav-item"
        style={style}
        data-testid="rail.staffQr"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="qr" size={16} />
        <span style={railLabelStyle}>{tr('ws.clock.qr.railButton')}</span>
      </button>
      {open && <StaffQrView onClose={() => setOpen(false)} />}
    </>
  );
}

export function StaffQrView({ onClose }: { onClose: () => void }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const { key } = useStationKey();
  const panelRef = useRef<HTMLDivElement>(null);
  const canSetUp = canAccess(staff, CLOCK_SETUP_ROUTE);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-qr-title"
      onKeyDown={(e) => trapTab(e, panelRef.current)}
      data-testid="staff-qr-view"
      className="tp-fade"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--tp-z-overlay-raised)' as unknown as number,
        background: 'var(--tp-rail)',
        color: 'var(--tp-rail-fg)',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        paddingBlock: 'var(--tp-sp-4)',
        paddingInline: 'var(--tp-sp-5)',
        overflow: 'auto',
      }}
    >
      <ScreenOwnerClaim />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-3)' }}>
        <h1 id="staff-qr-title" style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700, color: 'inherit' }}>
          {tr('ws.clock.qr.title')}
        </h1>
        <Button autoFocus className="tp-rail-btn" icon="x" onClick={onClose} data-testid="staff-qr-close">
          {tr('ws.clock.qr.close')}
        </Button>
      </div>
      <div style={{ display: 'grid', placeItems: 'center', paddingBlock: 'var(--tp-sp-4)' }}>
        {key ? (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-4)' }}>
            <ClockQrCode secret={key.secret} size="min(62vh, 30rem)" digitsSize="calc(var(--tp-fs-3xl) * 1.5)" />
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', textAlign: 'center', maxInlineSize: '34ch' }}>{tr('ws.clock.qr.caption')}</p>
            {canSetUp && (
              <PlaceMissingNote
                onOpen={() => {
                  onClose();
                  void navigate({ to: CLOCK_SETUP_ROUTE });
                }}
              />
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-3)', textAlign: 'center', maxInlineSize: '28rem' }} data-testid="staff-qr-missing">
            <Icon name="qr" size={40} />
            <h2 style={{ fontSize: 'var(--tp-fs-xl)', color: 'inherit' }}>{tr('ws.clock.qr.missingTitle')}</h2>
            {canSetUp ? <SetUpHere /> : <p style={{ margin: 0, opacity: 0.9 }}>{tr('ws.clock.qr.missingBody')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** The one-press setup on the Staff QR screen; on success the key event swaps in the QR. */
function SetUpHere() {
  const { tr } = useLocale();
  const setUp = useSetUpDesk();
  const err = setUp.error;
  return (
    <>
      <p style={{ margin: 0, opacity: 0.9 }}>{tr('ws.clock.qr.missingBodyManager')}</p>
      {/* The rail's "here and now" green: the primary blue would vanish into this blue screen. */}
      <Button
        kind="primary"
        size="lg"
        icon="qr"
        busy={setUp.isPending}
        onClick={() => setUp.mutate()}
        style={{ background: 'var(--tp-rail-active)', borderColor: 'var(--tp-rail-active)', color: 'var(--tp-rail-active-fg)' }}
        data-testid="staff-qr-setup"
      >
        {tr('ws.clock.qr.setUp')}
      </Button>
      {err &&
        (isRpcMissing(err) ? (
          <p role="alert" style={{ margin: 0 }} data-testid="staff-qr-setup-error">{tr('ws.clock.qr.unavailable')}</p>
        ) : isKeyNotKept(err) ? (
          <p role="alert" style={{ margin: 0 }} data-testid="staff-qr-setup-error">{tr('ws.clock.setup.desk.notKept')}</p>
        ) : (
          <div data-testid="staff-qr-setup-error">
            <ErrorText error={err} />
          </div>
        ))}
    </>
  );
}

/**
 * Under a working QR, for whoever may set things up: phones are refused until the club's location
 * is set, so say so here rather than let the first scan fail.
 */
function PlaceMissingNote({ onOpen }: { onOpen: () => void }) {
  const { tr } = useLocale();
  const { branchId } = useVenue();
  const q = useQuery({ queryKey: CK.setup(branchId), enabled: Boolean(branchId), queryFn: fetchClockSetup, retry: false });
  if (!q.data || q.data.place) return null;
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-2)', textAlign: 'center', maxInlineSize: '34ch' }} data-testid="staff-qr-place-missing">
      <p style={{ margin: 0, opacity: 0.9 }}>{tr(q.data.canEditPlace ? 'ws.clock.qr.placeMissing' : 'ws.clock.qr.placeMissingManager')}</p>
      {q.data.canEditPlace && (
        <Button className="tp-rail-btn" icon="pin" onClick={onOpen} data-testid="staff-qr-set-place">
          {tr('ws.clock.qr.setPlace')}
        </Button>
      )}
    </div>
  );
}

/**
 * The sign-in screen's clock panel: the QR big on the blue panel beside the form, the six digits
 * under it, and one line saying what it is for. Nothing when this desk has no key: setup is a
 * manager's, after signing in.
 */
export function SignInClockPanel() {
  const { tr } = useLocale();
  const { key } = useStationKey();
  if (!key) return null;
  return (
    <section aria-labelledby="signin-clock-title" style={{ position: 'relative', display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-3)' }} data-testid="signin-clock">
      <h2 id="signin-clock-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, color: 'inherit', textAlign: 'center' }}>
        {tr('ws.clock.qr.title')}
      </h2>
      <ClockQrCode secret={key.secret} size="min(22rem, 46vh, 100%)" />
      <p style={{ margin: 0, fontSize: 'var(--tp-fs-md)', textAlign: 'center', maxInlineSize: '30ch' }}>{tr('ws.clock.qr.caption')}</p>
    </section>
  );
}
