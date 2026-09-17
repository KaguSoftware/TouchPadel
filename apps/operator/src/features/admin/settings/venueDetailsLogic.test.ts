import { describe, expect, it } from 'vitest';
import { draftFromVenue, durationParts, venueDraftErrors, venuePatch } from './venueDetailsLogic';
import type { VenueAdminRow } from './venueQueries';

describe('durationParts', () => {
  it('says a stored number of seconds in the largest unit it divides into', () => {
    expect(durationParts(300)).toEqual({ unit: 'minutes', count: 5 });
    expect(durationParts(90)).toEqual({ unit: 'seconds', count: 90 });
    expect(durationParts(4 * 3600)).toEqual({ unit: 'hours', count: 4 });
    expect(durationParts(180 * 86_400)).toEqual({ unit: 'days', count: 180 });
  });

  it('stops at the unit a rule was set in: 48 hours stays 48 h, not 2 days', () => {
    expect(durationParts(48 * 3600, 'hours')).toEqual({ unit: 'hours', count: 48 });
    expect(durationParts(48 * 3600)).toEqual({ unit: 'days', count: 2 });
  });

  it('zero is zero seconds, never a unit it happens to divide into', () => {
    expect(durationParts(0)).toEqual({ unit: 'seconds', count: 0 });
  });
});

const saved: VenueAdminRow = {
  venue_name: 'Touch Padel',
  currency: 'IQD',
  timezone: 'Asia/Baghdad',
  phone: null,
  tax_inclusive: false,
  cancellation_window_hours: 12,
  hold_ttl_seconds: 300,
  protected_horizon_hours: 48,
  max_booking_horizon_days: 180,
  max_live_holds_per_guest: 3,
};

describe('editing venue details', () => {
  it('starts the form from the saved values, the hold in minutes', () => {
    expect(draftFromVenue(saved)).toEqual({ venueName: 'Touch Padel', phone: '', cancellationHours: '12', holdMinutes: '5', horizonDays: '180', maxHolds: '3' });
  });

  it('sends only what changed, in the server units', () => {
    const d = { ...draftFromVenue(saved), phone: ' +964 770 123 4567 ', holdMinutes: '10' };
    expect(venuePatch(saved, d)).toEqual({ phone: '+964 770 123 4567', hold_ttl_seconds: 600 });
    expect(venuePatch(saved, draftFromVenue(saved))).toEqual({});
  });

  it('clears the phone with null, not an empty string', () => {
    expect(venuePatch({ ...saved, phone: '0770' }, { ...draftFromVenue(saved), phone: '' })).toEqual({ phone: null });
  });

  it('checks the same limits the server does', () => {
    const d = draftFromVenue(saved);
    expect(venueDraftErrors(d)).toEqual({});
    expect(venueDraftErrors({ ...d, venueName: 'x', phone: 'call me', holdMinutes: '90', maxHolds: '0', horizonDays: '1.5' })).toEqual({
      venueName: 'nameLength',
      phone: 'phoneFormat',
      holdMinutes: 'range',
      maxHolds: 'range',
      horizonDays: 'wholeNumber',
    });
  });
});
