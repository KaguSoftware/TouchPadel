/**
 * The start panel on the page itself (wave5-addendum §5.1: "a start panel on
 * /till and the payment pane"): at the top of /till and the desk's Today
 * while the station's holder has no shift of their own open here, so the
 * shift starts before a guest is waiting at the tender rather than at the
 * first press of Cash. The same flow as the rail's and the payment pane's
 * (ShiftDialog, inline): the handover sentence, "That's right" or "I counted
 * a different amount"; someone else's open shift is closed first with a
 * manager's PIN; a shift open on another till says where to end it.
 *
 * It follows the gate, so it FAILS OPEN like it: loading, a failed read, an
 * offline station, a manager or owner (never asked), or a station with no
 * drawer draw nothing. Once a shift is open it goes, and what it replaced
 * (`fallback`, the till's "Start shift" sound strip) shows again; starting a
 * shift arms the sound itself (ShiftDialog.start).
 */
import type { CSSProperties, ReactNode } from 'react';
import { useTillShiftOptional } from './shiftContext';
import { ShiftDialog, type ShiftDialogEntry } from './ShiftDialog';
import { gateBlocks } from './tillShiftLogic';

const noop = () => {};
/** The page's gate needs no call back: the panel leaves once the gate passes. */
const PAGE_GATE: ShiftDialogEntry = { kind: 'gate', onReady: noop };

export function TillShiftPanel({ fallback = null, style }: { fallback?: ReactNode; style?: CSSProperties }) {
  const shift = useTillShiftOptional();
  if (!shift || !gateBlocks(shift.gate)) return <>{fallback}</>;
  return (
    <div style={style}>
      <ShiftDialog inline entry={PAGE_GATE} onClose={noop} onDone={noop} />
    </div>
  );
}
