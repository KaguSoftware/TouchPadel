/**
 * First-run station setup — the pure state machine behind StationSetupScreen.
 *
 * Shown once per machine, before sign-in, when the shell reports
 * `configured: false` (no station.json yet). Till and desk answer with an id;
 * a kitchen screen also types the pairing code the till shows, and the shell
 * finds the till on the LAN (main/lan-discover.ts). Nobody types an IP unless
 * the automatic search fails and they open Advanced.
 */
import { isPairingCode, normalisePairingCode } from '@touch/core';
import type { DiscoverResult, StationMode, StationSetupRequest } from '../../ipc/bridge';

/** Same source as @touch/core's stationRegex; asserted in the test. */
export const STATION_ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export const STATION_MODES: readonly StationMode[] = ['till', 'desk', 'kds'];

export function suggestStationId(mode: StationMode): string {
  return { till: 'TILL-01', desk: 'DESK-01', kds: 'KDS-01' }[mode];
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

export function isValidIpv4(value: string): boolean {
  return IPV4_RE.test(value);
}

export type NotFoundReason = 'none' | 'bad-code' | 'no-lan' | 'unreachable';

export interface DetailsState {
  step: 'details';
  mode: StationMode;
  stationId: string;
  /** Normalised as typed (uppercase, look-alikes mapped), at most 10 chars. */
  code: string;
  host: string;
  showAdvanced: boolean;
}

export type SetupState =
  | { step: 'mode' }
  | DetailsState
  | { step: 'scanning'; details: DetailsState }
  | { step: 'choose'; details: DetailsState; tills: string[] }
  | { step: 'notFound'; details: DetailsState; reason: NotFoundReason }
  | { step: 'saving'; details: DetailsState; request: StationSetupRequest }
  | { step: 'failed'; details: DetailsState; error: 'already-configured' | 'write-failed' | 'ipc' };

export type SetupAction =
  | { type: 'chooseMode'; mode: StationMode }
  | { type: 'stationId'; value: string }
  | { type: 'code'; value: string }
  | { type: 'host'; value: string }
  | { type: 'toggleAdvanced' }
  | { type: 'back' }
  | { type: 'confirm' }
  | { type: 'scanResult'; result: DiscoverResult }
  | { type: 'pickTill'; host: string }
  | { type: 'saveAnyway' }
  | { type: 'saveFailed'; error: 'already-configured' | 'write-failed' | 'ipc' }
  | { type: 'retry' };

export const initialSetupState: SetupState = { step: 'mode' };

function details(mode: StationMode): DetailsState {
  return { step: 'details', mode, stationId: suggestStationId(mode), code: '', host: '', showAdvanced: false };
}

/** Field-level validity of the details form. */
export function detailsValidity(d: DetailsState): { stationId: boolean; code: boolean; host: boolean; all: boolean } {
  const stationId = isValidStationId(d.stationId);
  const code = d.mode !== 'kds' || isPairingCode(d.code);
  const host = d.mode !== 'kds' || d.host === '' || isValidIpv4(d.host);
  return { stationId, code, host, all: stationId && code && host };
}

/** The request a till or desk sends, or a kitchen screen once its till is known. */
export function requestFor(d: DetailsState, tillHost?: string): StationSetupRequest {
  if (d.mode !== 'kds') return { stationId: d.stationId, mode: d.mode };
  return { stationId: d.stationId, mode: 'kds', tillHost: tillHost ?? d.host, pairingCode: d.code };
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (state.step) {
    case 'mode':
      return action.type === 'chooseMode' ? details(action.mode) : state;

    case 'details':
      switch (action.type) {
        case 'stationId':
          return { ...state, stationId: normaliseStationId(action.value) };
        case 'code':
          return { ...state, code: normalisePairingCode(action.value).slice(0, 10) };
        case 'host':
          return { ...state, host: action.value.trim() };
        case 'toggleAdvanced':
          return { ...state, showAdvanced: !state.showAdvanced };
        case 'back':
          return { step: 'mode' };
        case 'confirm': {
          if (!detailsValidity(state).all) return state;
          if (state.mode !== 'kds') return { step: 'saving', details: state, request: requestFor(state) };
          return { step: 'scanning', details: state };
        }
        default:
          return state;
      }

    case 'scanning':
      if (action.type === 'back') return state.details;
      if (action.type !== 'scanResult') return state;
      switch (action.result.status) {
        case 'found':
          if (action.result.tills.length === 1) {
            const host = action.result.tills[0]!;
            const d = { ...state.details, host };
            return { step: 'saving', details: d, request: requestFor(d, host) };
          }
          return { step: 'choose', details: state.details, tills: action.result.tills };
        case 'bad-code':
          return { step: 'notFound', details: state.details, reason: 'bad-code' };
        case 'no-lan':
          return { step: 'notFound', details: state.details, reason: 'no-lan' };
        default:
          return { step: 'notFound', details: state.details, reason: state.details.host ? 'unreachable' : 'none' };
      }

    case 'choose':
      if (action.type === 'back') return state.details;
      if (action.type === 'pickTill') {
        const d = { ...state.details, host: action.host };
        return { step: 'saving', details: d, request: requestFor(d, action.host) };
      }
      return state;

    case 'notFound':
      switch (action.type) {
        case 'retry':
          // A refused code is cleared so the next attempt starts from the till's card.
          return state.reason === 'bad-code' ? { ...state.details, code: '' } : state.details;
        case 'back':
          return state.details;
        case 'saveAnyway':
          if (!canSaveAnyway(state)) return state;
          return { step: 'saving', details: state.details, request: requestFor(state.details) };
        default:
          return state;
      }

    case 'saving':
      return action.type === 'saveFailed' ? { step: 'failed', details: state.details, error: action.error } : state;

    case 'failed':
      if (action.type === 'retry') return state.details;
      if (action.type === 'back') return { step: 'mode' };
      return state;
  }
}

/** Offered only when staff typed an address and it did not answer: the till
 *  may simply be off right now, and the client reconnects forever. */
export function canSaveAnyway(state: SetupState): boolean {
  return state.step === 'notFound' && state.reason === 'unreachable' && isValidIpv4(state.details.host);
}
