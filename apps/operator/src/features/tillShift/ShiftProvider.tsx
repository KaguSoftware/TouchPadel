/**
 * Till shifts (wave5-addendum §2.9, §5.1): the station's shift state, shared by
 * the rail row, the payment gate, the drawer card and the leaving guard, and
 * the one place the start and close dialogs opened from the rail are hosted.
 *
 * One read, app.till_shift_status for this station (QK.tillShift), refetched
 * every 30 seconds and on focus; the shift writes invalidate it. The gate is
 * computed from it by tillShiftLogic.shiftGate and FAILS OPEN whenever the read
 * cannot be trusted right now: still loading, its last attempt failed, or the
 * station's heartbeat says it cannot reach the server. A payment is never held
 * up by a shift the screen cannot see.
 *
 * Mounted inside the break provider in WorkspaceShell. Outside it (a screen
 * test, the sign-in screen) `useTillShiftOptional()` is null and nothing is
 * gated, which is what the existing PaymentPane and CourtBillPanel tests rely
 * on.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, useAuth, usePermissions } from '../../lib/auth';
import { QK } from '../../lib/queryKeys';
import { fetchShiftStatus, shiftDeviceId, stationMode } from './api';
import { gateBlocks, railShift, shiftGate, stationHasDrawer, type Holder } from './tillShiftLogic';
import { TillShiftContext, type TillShiftContextValue } from './shiftContext';
import { ShiftDialog, type ShiftDialogEntry } from './ShiftDialog';
import { LeaveShiftDialog } from './LeaveShiftDialog';

export function ShiftProvider({ offline, children }: { offline: boolean; children: ReactNode }) {
  const { staff } = useAuth();
  const perms = usePermissions();
  const qc = useQueryClient();
  const device = useMemo(() => shiftDeviceId(), []);
  const mode = useMemo(() => stationMode(), []);
  const holder = useMemo<Holder>(
    () => ({ holdsShift: perms.takeCourtPayment, payOnOthersShift: can(staff?.role, 'payOnOthersShift') }),
    [perms.takeCourtPayment, staff?.role],
  );
  const enabled = !!staff && holder.holdsShift && stationHasDrawer(mode);

  const q = useQuery({
    queryKey: QK.tillShift.station(device),
    queryFn: () => fetchShiftStatus(device),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const lastStatus = q.data ?? null;
  const status = !enabled || offline || q.isError ? null : lastStatus;

  const [dialog, setDialog] = useState<ShiftDialogEntry | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);

  const gate = useMemo(() => shiftGate({ ...holder, mode, status }), [holder, mode, status]);
  const rail = useMemo(() => railShift({ ...holder, mode, status: lastStatus }), [holder, mode, lastStatus]);
  const mineHere = Boolean(lastStatus?.shift?.is_mine);

  const refetch = useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK.tillShift.station(device) });
  }, [qc, device]);

  const openStart = useCallback(() => setDialog({ kind: 'start' }), []);
  const openClose = useCallback((opts?: { thenSignOut?: boolean }) => setDialog({ kind: 'close', thenSignOut: opts?.thenSignOut ?? false }), []);
  const withShift = useCallback(
    (next: () => void) => {
      if (!gateBlocks(gate)) next();
      else setDialog({ kind: 'gate', onReady: next });
    },
    [gate],
  );

  const guardSignOut = useCallback(
    (signOut: () => void) => {
      if (!mineHere) return false;
      setLeaving(() => signOut);
      return true;
    },
    [mineHere],
  );

  const value = useMemo<TillShiftContextValue>(
    () => ({ device, mode, holder, lastStatus, status, gate, rail, mineHere, refetch, openStart, openClose, withShift, guardSignOut }),
    [device, mode, holder, lastStatus, status, gate, rail, mineHere, refetch, openStart, openClose, withShift, guardSignOut],
  );

  return (
    <TillShiftContext.Provider value={value}>
      {children}
      {dialog && <ShiftDialog entry={dialog} onClose={() => setDialog(null)} />}
      {leaving && (
        <LeaveShiftDialog
          onCancel={() => setLeaving(null)}
          onSignOut={() => {
            const go = leaving;
            setLeaving(null);
            go();
          }}
          onEndShift={() => {
            setLeaving(null);
            setDialog({ kind: 'close', thenSignOut: true });
          }}
        />
      )}
    </TillShiftContext.Provider>
  );
}
