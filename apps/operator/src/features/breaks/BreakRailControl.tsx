/**
 * The rail's break row (0105), just above the identity lines it belongs with.
 *
 *   none     "Go on break" with today's remaining minutes under it — or, with
 *            nothing left, the button disabled and the reason in its place.
 *   covered  "{name} is back": the person on break ends it with their PIN.
 *   away     nothing — the break screen is up and owns the station.
 *
 * `style` is the rail's own button box (routes/__root.tsx navButtonStyle), so
 * this row sits on the same start edge as Sign out above it.
 */
import { useState, type CSSProperties } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/toast';
import { Icon } from '../../components/icons';
import { canStartBreak, remainingSeconds, wholeMinutes } from '../../lib/breaks';
import { useBreak } from './BreakProvider';
import { BreakPinDialog } from './BreakPinDialog';

export function BreakRailControl({ style, captionStyle }: { style: CSSProperties; captionStyle: CSSProperties }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const brk = useBreak();
  const [dialog, setDialog] = useState<'start' | 'end' | null>(null);

  if (!staff || !brk.status || brk.phase === 'away') return null;
  // Managers and owners are the jokers (owner call, 2026-09-18): they hold no
  // station of their own to leave, they cover everyone else's, and the plan
  // shows them at work wherever they are signed in. No break row for them.
  if (staff.role === 'manager' || staff.role === 'owner') return null;
  const n = (v: number) => formatNumber(v, locale);
  const remaining = remainingSeconds(brk.status, brk.nowMs);
  const can = canStartBreak(brk.status, brk.nowMs);

  return (
    <>
      {brk.phase === 'none' ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <button
            type="button"
            className="tp-nav-item"
            style={{ ...style, opacity: can ? 1 : 0.6, cursor: can ? 'pointer' : 'not-allowed' }}
            disabled={!can}
            aria-describedby="tp-break-left"
            onClick={() => setDialog('start')}
          >
            <Icon name="hourglass" size={16} />
            <span>{tr('ws.shell.break.goOnBreak')}</span>
          </button>
          <p id="tp-break-left" style={captionStyle}>
            {can ? tr('ws.shell.break.remainingToday', { minutes: n(wholeMinutes(remaining)) }) : tr('ws.shell.break.noneLeft')}
          </p>
        </div>
      ) : (
        <button type="button" className="tp-nav-item" style={style} onClick={() => setDialog('end')}>
          <Icon name="undo" size={16} />
          <span>{tr('ws.shell.break.backNamed', { name: staff.displayName })}</span>
        </button>
      )}

      {dialog === 'start' && (
        <BreakPinDialog
          title={tr('ws.shell.break.startTitle')}
          lead={tr('ws.shell.break.startLead')}
          action={tr('ws.shell.break.startAction')}
          onClose={() => setDialog(null)}
          onSubmit={async (pin) => {
            await brk.start(pin);
            setDialog(null);
            toast.ok(tr('ws.shell.break.started'));
          }}
        />
      )}
      {dialog === 'end' && (
        <BreakPinDialog
          title={tr('ws.shell.break.endTitle')}
          lead={tr('ws.shell.break.endLead')}
          action={tr('ws.shell.break.endAction')}
          onClose={() => setDialog(null)}
          onSubmit={async (pin) => {
            const r = await brk.end(pin);
            setDialog(null);
            toast.ok(
              r.remaining_seconds >= 0
                ? tr('ws.shell.break.ended', { minutes: n(wholeMinutes(r.remaining_seconds)) })
                : tr('ws.shell.break.endedOver', { minutes: n(wholeMinutes(r.remaining_seconds)) }),
            );
          }}
        />
      )}
    </>
  );
}
