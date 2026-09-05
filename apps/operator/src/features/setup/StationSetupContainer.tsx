import { useEffect, useReducer, useRef } from 'react';
import { touch } from '../../ipc/bridge';
import { StationSetupScreen } from './StationSetupScreen';
import { initialSetupState, setupReducer } from './stationSetup';

/**
 * The bridge-facing half of first-run setup: runs the LAN search while the
 * screen says "scanning", and writes station.json while it says "saving".
 * A successful save never resolves into a new state — the shell relaunches
 * within ~150 ms (main/first-run.ts) and the next boot is a configured one.
 */
export function StationSetupContainer() {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState);
  const appVersion = touch.getStation().appVersion;

  // A search that finishes after "Back" must not land on the form; the
  // reducer ignores a stray scanResult there anyway, the sequence number just
  // keeps a superseded search from racing a newer one.
  const scanning = state.step === 'scanning' ? state.details : null;
  const scanSeq = useRef(0);
  useEffect(() => {
    if (!scanning) return;
    const seq = ++scanSeq.current;
    const { code, host } = scanning;
    void touch.discoverTill(host ? { code, host } : { code }).then((result) => {
      if (seq !== scanSeq.current) return;
      dispatch({ type: 'scanResult', result: 'status' in result ? result : { status: 'none' } });
    });
  }, [scanning]);

  const saving = state.step === 'saving' ? state.request : null;
  useEffect(() => {
    if (!saving) return;
    let cancelled = false;
    void touch.saveStation(saving).then((res) => {
      if (cancelled) return;
      if (!('ok' in res)) dispatch({ type: 'saveFailed', error: 'ipc' });
      else if (!res.ok) dispatch({ type: 'saveFailed', error: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [saving]);

  return <StationSetupScreen state={state} appVersion={appVersion} dispatch={dispatch} />;
}
