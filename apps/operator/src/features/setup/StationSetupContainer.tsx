import { useEffect, useReducer } from 'react';
import { touch } from '../../ipc/bridge';
import { StationSetupScreen } from './StationSetupScreen';
import { initialSetupState, setupReducer } from './stationSetup';

/**
 * The bridge-facing half of first-run setup: writes station.json while the
 * screen says "saving". A successful save never resolves into a new state: the
 * shell relaunches within ~150 ms (main/first-run.ts) and the next boot is a
 * configured one.
 */
export function StationSetupContainer() {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState);
  const appVersion = touch.getStation().appVersion;

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
