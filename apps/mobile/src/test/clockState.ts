/**
 * What the mocked expo-location and expo-camera answer in one smoke case
 * (jest.setup.ts), in a mutable holder for the same reason as routerState:
 * the modules are mocked once, globally, and a case steers them from here.
 * `resetClockState()` puts back "everything allowed, a precise fix at the club".
 *
 * TEST-ONLY, plain data, no react-native import.
 */
export interface MockPermission {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}

export interface ClockState {
  location: MockPermission & { precise: boolean };
  /** What a location request turns the permission into. */
  locationAfterAsk: MockPermission;
  servicesOn: boolean;
  camera: MockPermission;
  /** Metres; the fix is taken "now" at every read. */
  accuracy: number;
  mocked: boolean;
  /** How many location prompts the case raised. */
  locationAsks: number;
  /** Whether a location watch is running. */
  watching: number;
}

export const clockState: ClockState = fresh();

function fresh(): ClockState {
  return {
    location: { status: 'granted', canAskAgain: true, precise: true },
    locationAfterAsk: { status: 'granted', canAskAgain: true },
    servicesOn: true,
    camera: { status: 'granted', canAskAgain: true },
    accuracy: 12,
    mocked: false,
    locationAsks: 0,
    watching: 0,
  };
}

export function resetClockState(): void {
  Object.assign(clockState, fresh());
}
