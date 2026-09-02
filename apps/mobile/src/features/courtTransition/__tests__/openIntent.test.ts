import { describe, expect, it } from 'vitest';
import { requestBookingSheet, takeBookingSheetRequest } from '../openIntent';

describe('booking sheet open intent', () => {
  it('is one-shot: the Book tab opens once per request, not on every focus', () => {
    // Left set, every later visit to the tab would replay the court → booking
    // transition on a guest who only wanted to look at the court.
    expect(takeBookingSheetRequest()).toBe(false);

    requestBookingSheet();
    expect(takeBookingSheetRequest()).toBe(true);
    expect(takeBookingSheetRequest()).toBe(false);
  });

  it('does not queue: two taps before the tab reads it still open one sheet', () => {
    requestBookingSheet();
    requestBookingSheet();
    expect(takeBookingSheetRequest()).toBe(true);
    expect(takeBookingSheetRequest()).toBe(false);
  });
});
