/**
 * "Staff QR" (0442): the rail footer row any signed-in person presses to show the desk's clock QR
 * full screen, for a colleague who arrives after the station is signed in. The same QR logs
 * arriving and leaving. Without a key on this machine the view says the desk is not set up, and
 * offers setup to whoever may do it (Settings › Stations).
 *
 * It also exports the sign-in screen's panel (`SignInClockPanel`): before anyone signs in, the
 * QR is the first thing on the station.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { ScreenOwnerClaim } from '../../lib/screenOwner';
import { Button, trapTab } from '../../components/ui';
import { Icon } from '../../components/icons';
import { railLabelStyle } from '../../components/railStyles';
import { ClockQrCode, useStationKey } from './ClockQr';

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
          </div>
        ) : (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-3)', textAlign: 'center', maxInlineSize: '28rem' }} data-testid="staff-qr-missing">
            <Icon name="qr" size={40} />
            <h2 style={{ fontSize: 'var(--tp-fs-xl)', color: 'inherit' }}>{tr('ws.clock.qr.missingTitle')}</h2>
            <p style={{ margin: 0, opacity: 0.9 }}>{tr(canSetUp ? 'ws.clock.qr.missingBodyManager' : 'ws.clock.qr.missingBody')}</p>
            {canSetUp && (
              <Button
                kind="primary"
                icon="settings"
                onClick={() => {
                  onClose();
                  void navigate({ to: CLOCK_SETUP_ROUTE });
                }}
                data-testid="staff-qr-setup"
              >
                {tr('ws.clock.qr.setUp')}
              </Button>
            )}
          </div>
        )}
      </div>
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
