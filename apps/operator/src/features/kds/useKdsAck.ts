/**
 * F-11: tell the till's side which tickets this board has drawn (kdsAck.ts).
 * Cloud ids → app.kds_ack_tickets; LAN refs → touch.sendLanAck. A failed
 * cloud call puts its ids back, so the next redraw tries them again.
 */
import { useEffect, useRef, useState } from 'react';
import { appRpc } from '../../lib/appRpc';
import { touch } from '../../ipc/bridge';
import { ACK_DEBOUNCE_MS, markAcked, pendingAcks } from './kdsAck';

export function useKdsAck(
  cloudIds: readonly string[],
  lanRefs: readonly string[],
  /** The LAN link (lanState): an ack sent while it was down never arrived, so a reconnect sends them all again. */
  lanLink: boolean | null | undefined,
): void {
  const sentCloud = useRef(new Set<string>());
  const sentLan = useRef(new Set<string>());
  const cloudKey = cloudIds.join(',');
  const lanKey = lanRefs.join(',');
  const [lanEpoch, setLanEpoch] = useState(0);
  const [cloudRetry, setCloudRetry] = useState(0);

  useEffect(() => {
    if (lanLink !== true) return;
    sentLan.current.clear();
    setLanEpoch((n) => n + 1);
  }, [lanLink]);

  useEffect(() => {
    if (cloudIds.length === 0) return;
    const t = setTimeout(() => {
      const ids = pendingAcks(cloudIds, sentCloud.current);
      if (ids.length === 0) return;
      markAcked(sentCloud.current, ids);
      appRpc('kds_ack_tickets', { p_ticket_ids: ids }).catch(() => {
        for (const id of ids) sentCloud.current.delete(id);
        // Offline or refused: try the same ids again shortly, not only when the board changes.
        setTimeout(() => setCloudRetry((n) => n + 1), 10_000);
      });
    }, ACK_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids' content, not the array identity
  }, [cloudKey, cloudRetry]);

  useEffect(() => {
    if (lanRefs.length === 0) return;
    const t = setTimeout(() => {
      const refs = pendingAcks(lanRefs, sentLan.current);
      if (refs.length === 0) return;
      markAcked(sentLan.current, refs);
      touch.sendLanAck(refs);
    }, ACK_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  }, [lanKey, lanEpoch]);
}
