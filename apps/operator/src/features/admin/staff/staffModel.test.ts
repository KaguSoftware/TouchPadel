import { describe, expect, it } from 'vitest';
import { AppRpcError } from '../../../lib/appRpc';
import { EdgeError } from '../../../lib/edge';
import { STAFF_ROLES } from '../../../lib/auth';
import {
  ASSIGNABLE_ROLES,
  approvesWithPin,
  holdsPin,
  isRetiredRole,
  looksLikeEmail,
  onRetiredRole,
  pinFormatOk,
  roleChoices,
  staffRefusal,
  type StaffRow,
} from './staffModel';

describe('pinFormatOk', () => {
  // The field used to stop at 6 digits while its hint promised "4 to 6", and
  // the server (0078) wants 6 to 12 — so a 4-digit PIN left Save dead.
  it('matches app.set_staff_pin: 6 to 12 digits, nothing else', () => {
    expect(pinFormatOk('1234')).toBe(false);
    expect(pinFormatOk('482913')).toBe(true);
    expect(pinFormatOk('482913570146')).toBe(true);
    expect(pinFormatOk('4829135701468')).toBe(false);
    expect(pinFormatOk('48291a')).toBe(false);
  });
});

describe('holdsPin / approvesWithPin', () => {
  it('every role holds a PIN since 0105 (breaks, idle lock), the 0155 roles included', () => {
    expect(STAFF_ROLES.filter((r) => !holdsPin(r))).toEqual([]);
  });
  it('only managers and owners approve with it', () => {
    expect(STAFF_ROLES.filter((r) => approvesWithPin(r))).toEqual(['manager', 'owner']);
  });
});

describe('assignable and retired roles (0155)', () => {
  it('offers every role but prep, management last', () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(STAFF_ROLES.filter((r) => r !== 'prep').sort());
    expect(ASSIGNABLE_ROLES.slice(-2)).toEqual(['manager', 'owner']);
    expect(isRetiredRole('prep')).toBe(true);
    expect(ASSIGNABLE_ROLES.filter(isRetiredRole)).toEqual([]);
  });

  it('lists the picker with the waiter beside the cashier and the assistant barista in the bar (wave 5 §2.1.6)', () => {
    expect(ASSIGNABLE_ROLES).toEqual([
      'cashier',
      'waiter',
      'court_desk',
      'head_barista',
      'barista',
      'assistant_barista',
      'head_chef',
      'chef',
      'driver',
      'marketing',
      'manager',
      'owner',
    ]);
    expect(roleChoices('waiter').map((c) => c.role)).toEqual(ASSIGNABLE_ROLES);
    expect(roleChoices('assistant_barista').every((c) => !c.retired)).toBe(true);
  });

  it('a prep account still sees Kitchen in its picker, first, as a row it cannot choose', () => {
    // First so the list opens with it in view and ArrowDown steps straight
    // into the live roles; a disabled row at the foot could not be reached.
    const choices = roleChoices('prep');
    expect(choices[0]).toEqual({ role: 'prep', retired: true });
    expect(choices.filter((c) => c.retired)).toHaveLength(1);
    expect(choices.slice(1).map((c) => c.role)).toEqual(ASSIGNABLE_ROLES);
  });

  it('any other account is never offered prep at all', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(roleChoices(role).map((c) => c.role)).not.toContain('prep');
    }
  });

  it('counts the people who can still sign in on a retired role', () => {
    const row = (role: StaffRow['role'], is_active = true): StaffRow => ({ id: role, display_name: role, role, is_active, has_pin: false });
    expect(onRetiredRole([row('prep'), row('prep', false), row('barista'), row('chef')])).toBe(1);
    expect(onRetiredRole([row('cashier')])).toBe(0);
  });
});

describe('looksLikeEmail', () => {
  it('catches a name typed into the email box, and nothing stricter', () => {
    expect(looksLikeEmail('Sara')).toBe(false);
    expect(looksLikeEmail('sara@touch')).toBe(false);
    expect(looksLikeEmail(' sara@touch.iq ')).toBe(true);
  });
});

describe('staffRefusal', () => {
  it('names the refusals this screen explains in its own words', () => {
    expect(staffRefusal(new AppRpcError('PIN_WEAK', 'PIN_WEAK'))).toBe('pinWeak');
    expect(staffRefusal(new AppRpcError('PIN_FORMAT', 'PIN_FORMAT'))).toBe('pinFormat');
    expect(staffRefusal(new AppRpcError('LAST_OWNER', 'LAST_OWNER'))).toBe('lastOwner');
    expect(staffRefusal(new AppRpcError('ROLE_RETIRED', 'ROLE_RETIRED'))).toBe('roleRetired');
    expect(staffRefusal(new EdgeError(409, 'UNKNOWN', 'dup', 'EMAIL_IN_USE'))).toBe('emailInUse');
    expect(staffRefusal(new EdgeError(400, 'UNKNOWN', 'retired', 'ROLE_RETIRED'))).toBe('roleRetired');
  });

  it('leaves everything else to the shared error text', () => {
    expect(staffRefusal(new AppRpcError('FORBIDDEN', 'FORBIDDEN'))).toBeNull();
    expect(staffRefusal(new EdgeError(500, 'UPSTREAM', 'boom'))).toBeNull();
    expect(staffRefusal(new Error('x'))).toBeNull();
  });
});
