import { expect } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';

/**
 * Every native alert the app raised in the current case, newest last.
 *
 * Errors reach the guest as the platform's own alert, not a line of red text
 * (`ErrorAlert` / `ErrorText`, `src/components/overlays.tsx`), so a smoke case
 * reads what was said from here instead of from the rendered tree. jest.setup.ts
 * records each `Alert.alert` call and presses its first button at once, the way
 * a guest taps OK, so one alert never blocks the next.
 */
export interface AlertRecord {
  title: string;
  body: string;
}

export const alertState: { log: AlertRecord[] } = { log: [] };

/** Waits for an alert whose body contains `text` (the alerts are batched a few ms). */
export function expectAlerted(text: string) {
  return waitFor(() => expect(alertState.log.some((a) => a.body.includes(text))).toBe(true));
}
