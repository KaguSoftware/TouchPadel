/**
 * The desk's staff clock QR (0442): `TPCLOCK:<6 digits>`, drawn from this machine's secret with
 * `clockCode`, a new code every 30 seconds, offline and with nobody signed in. The six digits sit
 * under it in large type for a phone whose camera will not read the screen, with how long the
 * code has left.
 *
 * Black on white, always, with the scanner's quiet margin (QR_INK, QR_PAPER, QUIET_MODULES from
 * @touch/core/loyalty, the same rule as the table cards): a QR is a machine mark, not a brand
 * surface. The text around it takes its colour from the parent, so it reads on the sign-in
 * screen's blue panel and on the page alike.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { clockCode, CLOCK_STEP_SECONDS } from '@touch/core/staff/clock';
import { QR_INK, QR_PAPER, QUIET_MODULES, qrModules, qrPath } from '@touch/core/loyalty';
import { formatNumber } from '@touch/i18n';
import { useClock } from '../../lib/clock';
import { useLocale } from '../../lib/i18n';
import { station } from '../../lib/idem';
import { CLOCK_KEY_EVENT, browserStorage, readStationKey, type StoredClockKey } from './stationKey';

function thisStation(): string {
  try {
    return station();
  } catch {
    return '';
  }
}

/** This machine's station id and its stored clock key, kept fresh when setup writes a new one. */
export function useStationKey(): { stationId: string; key: StoredClockKey | null; reload: () => void } {
  const [stationId] = useState(thisStation);
  const [key, setKey] = useState<StoredClockKey | null>(() => readStationKey(stationId, browserStorage()));
  const reload = useCallback(() => setKey(readStationKey(stationId, browserStorage())), [stationId]);
  useEffect(() => {
    window.addEventListener(CLOCK_KEY_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(CLOCK_KEY_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, [reload]);
  return { stationId, key, reload };
}

/** Tell open screens this machine's key changed. */
export function announceKeyChange(): void {
  window.dispatchEvent(new Event(CLOCK_KEY_EVENT));
}

function QrMark({ text, label }: { text: string; label: string }) {
  const { d, size } = useMemo(() => qrPath(qrModules(text)), [text]);
  const box = size + QUIET_MODULES * 2;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${-QUIET_MODULES} ${-QUIET_MODULES} ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{ display: 'block', inlineSize: '100%', blockSize: 'auto', borderRadius: 'var(--tp-radius-ctl)' }}
    >
      <rect x={-QUIET_MODULES} y={-QUIET_MODULES} width={box} height={box} fill={QR_PAPER} />
      <path d={d} fill={QR_INK} />
    </svg>
  );
}

export function ClockQrCode({
  secret,
  size,
  digitsSize = 'var(--tp-fs-3xl)',
  style,
}: {
  secret: string;
  /** The QR's side, any CSS length. */
  size: string;
  digitsSize?: string;
  style?: CSSProperties;
}) {
  const { tr, locale } = useLocale();
  const now = useClock(1000);
  const { code, qr, secondsLeft } = useMemo(() => clockCode(secret, now), [secret, now]);
  const left = Math.min(CLOCK_STEP_SECONDS, Math.max(0, secondsLeft));
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-3)', ...style }} data-testid="clock-qr">
      <div style={{ inlineSize: size, maxInlineSize: '100%' }}>
        <QrMark text={qr} label={tr('ws.clock.qr.aria')} />
      </div>
      <p
        dir="ltr"
        aria-label={tr('ws.clock.qr.digitsAria', { code: code.split('').join(' ') })}
        style={{ margin: 0, fontSize: digitsSize, fontWeight: 700, lineHeight: 1, letterSpacing: '0.12em', fontVariantNumeric: 'tabular-nums' }}
        data-testid="clock-qr-digits"
      >
        {code.slice(0, 3)}
        <span aria-hidden="true" style={{ display: 'inline-block', inlineSize: '0.4em' }} />
        {code.slice(3)}
      </p>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', inlineSize: size, maxInlineSize: '100%' }}>
        <div aria-hidden="true" style={{ blockSize: '4px', borderRadius: '2px', background: 'color-mix(in oklab, currentColor 22%, transparent)', overflow: 'hidden' }}>
          <div style={{ blockSize: '100%', inlineSize: `${(left / CLOCK_STEP_SECONDS) * 100}%`, background: 'currentColor', borderRadius: '2px' }} />
        </div>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', opacity: 0.85, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {tr('ws.clock.qr.newCodeIn', { seconds: formatNumber(left, locale) })}
        </p>
      </div>
    </div>
  );
}
