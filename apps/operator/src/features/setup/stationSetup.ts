/**
 * First-run station setup — the pure state machine behind StationSetupScreen.
 *
 * Shown once per machine, before sign-in, when the shell reports
 * `configured: false` (no station.json yet). Every kind of station answers with
 * a role and an id.
 */
import type { StationMode, StationSetupRequest } from '../../ipc/bridge';

/** Same source as @touch/core's stationRegex; asserted in the test. */
export const STATION_ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

export const STATION_MODES: readonly StationMode[] = ['till', 'desk', 'shop'];

export function suggestStationId(mode: StationMode): string {
  return { till: 'TILL-01', desk: 'DESK-01', shop: 'SHOP-01' }[mode];
}

/** Uppercase; spaces and underscores become dashes; anything else is dropped. */
export function normaliseStationId(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 32);
}

export function isValidStationId(value: string): boolean {
  return STATION_ID_RE.test(value);
}

export interface DetailsState {
  step: 'details';
  mode: StationMode;
  stationId: string;
}

export type SetupState =
  | { step: 'mode' }
  | DetailsState
  | { step: 'saving'; details: DetailsState; request: StationSetupRequest }
  | { step: 'failed'; details: DetailsState; error: 'already-configured' | 'write-failed' | 'ipc' };

export type SetupAction =
  | { type: 'chooseMode'; mode: StationMode }
  | { type: 'stationId'; value: string }
  | { type: 'back' }
  | { type: 'confirm' }
  | { type: 'saveFailed'; error: 'already-configured' | 'write-failed' | 'ipc' }
  | { type: 'retry' };

export const initialSetupState: SetupState = { step: 'mode' };

function details(mode: StationMode): DetailsState {
  return { step: 'details', mode, stationId: suggestStationId(mode) };
}

/** Field-level validity of the details form. */
export function detailsValidity(d: DetailsState): { stationId: boolean; all: boolean } {
  const stationId = isValidStationId(d.stationId);
  return { stationId, all: stationId };
}

export function requestFor(d: DetailsState): StationSetupRequest {
  return { stationId: d.stationId, mode: d.mode };
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (state.step) {
    case 'mode':
      return action.type === 'chooseMode' ? details(action.mode) : state;

    case 'details':
      switch (action.type) {
        case 'stationId':
          return { ...state, stationId: normaliseStationId(action.value) };
        case 'back':
          return { step: 'mode' };
        case 'confirm':
          return detailsValidity(state).all ? { step: 'saving', details: state, request: requestFor(state) } : state;
        default:
          return state;
      }

    case 'saving':
      return action.type === 'saveFailed' ? { step: 'failed', details: state.details, error: action.error } : state;

    case 'failed':
      // Retry saves the same thing again rather than re-showing a form whose
      // answers were already accepted. Already-configured is not retried: the
      // screen tells the person to restart instead.
      if (action.type === 'retry') {
        if (state.error === 'already-configured') return state;
        return { step: 'saving', details: state.details, request: requestFor(state.details) };
      }
      if (action.type === 'back') return { step: 'mode' };
      return state;
  }
}
