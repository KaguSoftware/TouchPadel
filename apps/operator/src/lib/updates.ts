import { useEffect, useState } from 'react';
import { touch, type UpdateReadyInfo } from '../ipc/bridge';

/**
 * The downloaded-and-waiting update, or null. Subscribes through the bridge,
 * which replays the current state on subscribe (the rail mounts after sign-in,
 * long after the download may have landed). Always null in browser mode.
 */
export function useUpdateReady(): UpdateReadyInfo | null {
  const [update, setUpdate] = useState<UpdateReadyInfo | null>(null);
  useEffect(() => touch.onUpdateReady(setUpdate), []);
  return update;
}
