/**
 * The typed name + number that become a customer (0448): what is sent, what
 * comes back, and when a number that is somebody's under another name must be
 * shown before anything is written against it. Pure; the call itself is
 * covered by the dialogs' screen tests.
 */
import { describe, expect, it } from 'vitest';
import { DESK_ACCOUNT_NAME_MAX, deskAccountInput, deskAccountOf, deskPhoneDigits, isIncompleteCustomer, realEmail, sameCustomerName } from './deskAccount';

describe('deskAccountInput', () => {
  it('takes a name and a 7-15 digit number, however the number is written', () => {
    expect(deskAccountInput(' Ali Hassan ', ' 0770 123 4567 ')).toEqual({ fullName: 'Ali Hassan', phone: '0770 123 4567' });
    expect(deskAccountInput('Ali', '+964 (770) 123-4567')).toEqual({ fullName: 'Ali', phone: '+964 (770) 123-4567' });
    expect(deskAccountInput('علي', '٠٧٧٠١٢٣٤٥٦٧')).toEqual({ fullName: 'علي', phone: '٠٧٧٠١٢٣٤٥٦٧' });
  });

  it('is null with no name: there is nobody to save', () => {
    expect(deskAccountInput('', '07701234567')).toBeNull();
    expect(deskAccountInput('   ', '07701234567')).toBeNull();
    expect(deskAccountInput('', '')).toBeNull();
  });

  it('a name alone, or with something that is not a number, is saved by name only', () => {
    expect(deskAccountInput('Ali', '')).toEqual({ fullName: 'Ali', phone: null });
    expect(deskAccountInput('Ali', '12345')).toEqual({ fullName: 'Ali', phone: null });
    expect(deskAccountInput('Ali', '1234567890123456')).toEqual({ fullName: 'Ali', phone: null });
  });

  it("cuts a long name to the profile's bound", () => {
    const made = deskAccountInput('x'.repeat(200), '07701234567');
    expect(made?.fullName).toHaveLength(DESK_ACCOUNT_NAME_MAX);
  });

  it('counts Arabic-Indic digits', () => {
    expect(deskPhoneDigits('٠٧٧٠ ١٢٣ ٤٥٦٧')).toBe(11);
    expect(deskPhoneDigits('۰۷۷۰۱۲۳۴۵۶۷')).toBe(11);
  });
});

describe('sameCustomerName', () => {
  it('folds case and spacing, and takes a first name for the full one', () => {
    expect(sameCustomerName('ali  hassan', 'Ali Hassan')).toBe(true);
    expect(sameCustomerName('Ali', 'Ali Hassan')).toBe(true);
    expect(sameCustomerName('Ali Hassan Karim', 'Ali Hassan')).toBe(true);
    expect(sameCustomerName('علي', 'علي حسن')).toBe(true);
  });

  it('is false for another name, a partial word or nothing', () => {
    expect(sameCustomerName('Omar', 'Ali Hassan')).toBe(false);
    expect(sameCustomerName('Al', 'Ali Hassan')).toBe(false);
    expect(sameCustomerName('', 'Ali')).toBe(false);
  });
});

describe('deskAccountOf', () => {
  const typed = { fullName: 'Ali', phone: '07701234567' };

  it('a new account: not existing, not claimed, nothing to check', () => {
    const made = deskAccountOf({ id: 'c1', customer: { id: 'c1', full_name: 'Ali', phone: '07701234567', gender: null } }, typed);
    expect(made).toEqual({
      customer: { id: 'c1', name: 'Ali', phone: '07701234567', flags: [], gender: null },
      existing: false,
      claimed: false,
      incomplete: false,
      check: false,
    });
  });

  it('a name saved alone: a customer with no number, marked incomplete', () => {
    const made = deskAccountOf({ id: 'c9', incomplete: true, customer: { id: 'c9', full_name: 'Ali', phone: null, gender: null } }, { fullName: 'Ali', phone: null });
    expect(made).toEqual({
      customer: { id: 'c9', name: 'Ali', phone: null, flags: [], gender: null, incomplete: true },
      existing: false,
      claimed: false,
      incomplete: true,
      check: false,
    });
  });

  it('an existing account under the same name is linked with no question', () => {
    const made = deskAccountOf({ id: 'c2', existing: true, claimed: false, customer: { full_name: 'Ali Hassan', phone: '+9647701234567', gender: 'male' } }, typed);
    expect(made).toMatchObject({ existing: true, claimed: false, check: false, customer: { id: 'c2', name: 'Ali Hassan', gender: 'male' } });
  });

  it('an existing account under another name is shown first', () => {
    const made = deskAccountOf({ id: 'c3', existing: true, claimed: true, customer: { full_name: 'Omar Saleh', phone: '07701234567', gender: 'male' } }, typed);
    expect(made).toMatchObject({ existing: true, claimed: true, check: true, customer: { name: 'Omar Saleh' } });
  });

  it('an existing account that does not say whether it is claimed reads as claimed', () => {
    expect(deskAccountOf({ id: 'c4', existing: true, customer: { full_name: 'Ali' } }, typed)?.claimed).toBe(true);
  });

  it('falls back to what was typed when the answer has no name or number, and is null without an id', () => {
    expect(deskAccountOf({ id: 'c5', customer: null }, typed)?.customer).toMatchObject({ name: 'Ali', phone: '07701234567' });
    expect(deskAccountOf({ customer: { full_name: 'Ali' } }, typed)).toBeNull();
    expect(deskAccountOf(null, typed)).toBeNull();
  });
});

describe('isIncompleteCustomer / realEmail', () => {
  it('only the desk\'s own name-only record is incomplete', () => {
    expect(isIncompleteCustomer({ phone: null, email: 'name-0b1c@guest.touch.local' })).toBe(true);
    expect(isIncompleteCustomer({ phone: '', email: 'NAME-0b1c@GUEST.touch.local' })).toBe(true);
    // A number makes it whole; a walk-in registered with a number never was one.
    expect(isIncompleteCustomer({ phone: '0770', email: 'name-0b1c@guest.touch.local' })).toBe(false);
    expect(isIncompleteCustomer({ phone: null, email: '07701234567@guest.touch.local' })).toBe(false);
    // A Google or Apple account that never gave a number: its owner adds it, not the desk.
    expect(isIncompleteCustomer({ phone: null, email: 'someone@gmail.com' })).toBe(false);
    expect(isIncompleteCustomer({ phone: null, email: null })).toBe(false);
  });

  it('a placeholder address is never shown as an email', () => {
    expect(realEmail('name-0b1c@guest.touch.local')).toBeNull();
    expect(realEmail('07701234567@guest.touch.local')).toBeNull();
    expect(realEmail(' someone@gmail.com ')).toBe('someone@gmail.com');
    expect(realEmail(null)).toBeNull();
  });
});
