import { describe, expect, it } from 'vitest';
import { tillMayBill } from './NewTabDialog';

// tillMayBill: which of tonight's bookings the till may open a bill on.

describe('tillMayBill', () => {
  const booking = { guest_id: null, guest_name: 'Sara', tabs: [], kind: 'booking' };

  it('takes a booking with no live tab', () => {
    expect(tillMayBill(booking)).toBe(true);
    expect(tillMayBill({ ...booking, tabs: [{ id: 't1', status: 'open' }] })).toBe(false);
  });

  it('leaves out an open match’s booking (DF-16)', () => {
    expect(tillMayBill({ ...booking, guest_name: 'Open match' })).toBe(false);
  });

  it('leaves out a lesson’s court row: a lesson is paid on its own screen (coaching §5.8)', () => {
    expect(tillMayBill({ ...booking, guest_name: 'Lesson', kind: 'lesson' })).toBe(false);
    // The kind alone decides, whatever the row is called.
    expect(tillMayBill({ guest_id: 'g1', guest_name: null, tabs: [], kind: 'lesson' })).toBe(false);
    // A walk-in booking the desk happened to name "Lesson" is still a booking.
    expect(tillMayBill({ ...booking, guest_name: 'Lesson' })).toBe(true);
  });
});
