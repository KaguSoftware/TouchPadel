/**
 * The till shift on /till/drawer (wave5-addendum §5.1).
 *
 *   YourShift       the cashier's card: since when, what the drawer started
 *                   with, how many payments, refunds and hand openings, and
 *                   End my shift. No expected figure (the blind count, Q29):
 *                   it shows once the drawer is counted. The page has the
 *                   room, so the start and the close happen here, inline,
 *                   not in a dialog: with no shift open the start panel
 *                   (TillShiftPanel) takes the card's place.
 *
 * The manager's and owner's list of the day's shifts is DrawerDay.
 */
import { useState } from 'react';
import { formatTime, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Money, Panel } from '../../components/kit';
import { CardTitle, FigureRow, RowList } from '../ops/OpsVisuals';
import { useTillShiftOptional } from './shiftContext';
import { ShiftDialog } from './ShiftDialog';
import { TillShiftPanel } from './TillShiftPanel';

/**
 * End my shift and Close Ali's shift are not primary: "Open drawer" is, once
 * a shift is open. With none open, the start panel leads and Open drawer
 * steps down (CashDrawer).
 */
export function YourShift() {
  const { tr, locale } = useLocale();
  const shift = useTillShiftOptional();
  const [closing, setClosing] = useState(false);
  const status = shift?.lastStatus ?? null;
  if (!shift || !shift.holder.holdsShift || !status) return null;
  // The close, in the card's place: count, sign, result. It stays up after the
  // shift is closed (the status then has none), so the result can be read.
  if (closing) {
    return <ShiftDialog inline entry={{ kind: 'close', thenSignOut: false }} onClose={() => setClosing(false)} />;
  }
  const time = (iso: string) => formatTime(new Date(iso), locale);
  const s = status.shift;
  const rail = shift.rail;

  if (s && s.is_mine) {
    return (
      <Panel
        title={<CardTitle icon="drawer">{tr('ws.tillShift.drawer.title')}</CardTitle>}
        actions={
          <Button size="sm" icon="lock" onClick={() => setClosing(true)} data-testid="drawer.shift.end">
            {tr('ws.tillShift.rail.end')}
          </Button>
        }
      >
        <RowList chevrons={false}>
          <FigureRow label={tr('ws.tillShift.figures.openedAt')} value={<bdi>{time(s.opened_at)}</bdi>} />
          <FigureRow label={tr('ws.tillShift.figures.float')} value={<Money amount={s.opening_float_iqd} />} />
          <FigureRow label={tr('ws.tillShift.figures.payments')} value={s.payment_count} />
          <FigureRow label={tr('ws.tillShift.figures.refunds')} value={s.refund_count} />
          <FigureRow label={tr('ws.tillShift.figures.drawerOpens')} value={s.drawer_open_count} />
        </RowList>
        <p style={{ marginBlockStart: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.tillShift.drawer.blindHint')}</p>
      </Panel>
    );
  }

  if (s) {
    return (
      <Panel muted>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <strong>{tr('ws.tillShift.drawer.others', { name: isolate(s.staff_name) })}</strong>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.tillShift.drawer.othersHint', { time: time(s.opened_at) })}</p>
          <Button icon="lock" onClick={() => setClosing(true)}>
            {tr('ws.tillShift.rail.closeOthers', { name: isolate(s.staff_name) })}
          </Button>
        </div>
      </Panel>
    );
  }

  // Managers and owners are never asked to hold a shift: nothing to say here.
  if (!rail) return null;
  const blocked = rail.kind === 'start' ? rail.blocked : null;
  const reason = blocked === 'noDay' ? tr('ws.tillShift.rail.noDay') : blocked ? tr('ws.tillShift.rail.elsewhere', { station: isolate(blocked.elsewhere) }) : undefined;
  // The start panel itself while the gate asks for a shift; when the gate
  // fails open (offline, a read that failed) the card says what it can.
  return (
    <TillShiftPanel
      fallback={
        <Panel muted>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <strong>{tr('ws.tillShift.drawer.none')}</strong>
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.tillShift.drawer.noneHint')}</p>
            <Button icon="drawer" disabled={reason !== undefined} disabledReason={reason} onClick={shift.openStart} data-testid="drawer.shift.start">
              {tr('ws.tillShift.rail.start')}
            </Button>
          </div>
        </Panel>
      }
    />
  );
}
