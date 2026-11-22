/**
 * One press sets up this desk's staff QR (0442), wherever the press is: the Staff QR screen or
 * Settings › Stations. It asks the server for a new secret for THIS station, keeps it on the
 * machine (stationKey.ts) and tells open screens, so the QR draws itself at once.
 *
 * A computer that is not yet a station of the branch is registered first (app.register_station,
 * with the mode its setup gave it): the server refuses a key for an unknown station with
 * REF_NOT_FOUND, and making the manager go and find a Register button elsewhere is the dead end
 * this hook exists to remove.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useVenue } from '../../lib/venue';
import { touch } from '../../ipc/bridge';
import { refusalCode } from '../protocols/errors';
import { STATIONS_KEY } from '../admin/settings/StationsPanel';
import { CK, fetchClockSetup, issueStationKey } from './api';
import { announceKeyChange, useStationKey } from './ClockQr';
import { browserStorage, writeStationKey } from './stationKey';

/** Thrown when the machine would not keep the secret (storage full or blocked). */
export const CLOCK_KEY_NOT_KEPT = 'CLOCK_KEY_NOT_KEPT';

export function isKeyNotKept(error: unknown): boolean {
  return error instanceof Error && error.message === CLOCK_KEY_NOT_KEPT;
}

export function useSetUpDesk() {
  const qc = useQueryClient();
  const { branchId } = useVenue();
  const { stationId } = useStationKey();

  return useMutation({
    mutationFn: async () => {
      let secret: string;
      try {
        ({ secret } = await issueStationKey(stationId));
      } catch (e) {
        if (refusalCode(e) !== 'REF_NOT_FOUND' || !branchId) throw e;
        const mode = touch.getStation().mode;
        await appRpc('register_station', {
          p_id: stationId,
          p_venue_id: branchId,
          p_mode: mode === 'desk' || mode === 'shop' ? mode : 'till',
        });
        void qc.invalidateQueries({ queryKey: STATIONS_KEY });
        ({ secret } = await issueStationKey(stationId));
      }
      const storage = browserStorage();
      if (!writeStationKey(stationId, { secret, issued_at: null }, storage)) throw new Error(CLOCK_KEY_NOT_KEPT);
      // Read the server's stamp back, so a later re-issue elsewhere shows as "out of date" here.
      try {
        const fresh = await fetchClockSetup();
        qc.setQueryData(CK.setup(branchId), fresh);
        const stamp = fresh.stations.find((s) => s.stationId === stationId)?.issuedAt ?? null;
        if (stamp) writeStationKey(stationId, { secret, issued_at: stamp }, storage);
      } catch {
        /* the key works; the stamp is filled the next time it can be compared */
      }
      announceKeyChange();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: CK.all }),
  });
}
