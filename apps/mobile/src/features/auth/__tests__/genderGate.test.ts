import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetGenderAsked,
  genderAskedThisSession,
  genderGateStep,
  markGenderAsked,
  signupGenderOf,
  type GenderGateInput,
} from '../genderGate';
import { bookingGateState, needsProfileCompletion, postSignInStep, profileGateState } from '../social';
import { validateSignUp } from '../api';

const base: GenderGateInput = {
  hasSession: true,
  isAnonymous: false,
  staffAnswered: true,
  staff: false,
  gender: null,
  signupGender: null,
  recordFailed: false,
  pendingIntent: false,
  pathname: '/',
  askedThisSession: false,
};

describe('0353: a gender is a must for every account (the completion gate)', () => {
  const full = { phone: '+9647700000000', full_name: 'Sara Ali' };

  it('a known profile with no gender is incomplete', () => {
    expect(needsProfileCompletion({ ...full, gender: null })).toBe(true);
    expect(profileGateState({ status: 'success', data: { ...full, gender: null } })).toBe('incomplete');
  });

  it('a set gender completes it; a row without the column is not judged', () => {
    expect(needsProfileCompletion({ ...full, gender: 'female' })).toBe(false);
    expect(needsProfileCompletion({ ...full, gender: 'male' })).toBe(false);
    expect(needsProfileCompletion(full)).toBe(false);
  });

  it('unknown stays unknown: no row, or a read in flight', () => {
    expect(needsProfileCompletion(null)).toBe(false);
    expect(needsProfileCompletion(undefined)).toBe(false);
    expect(profileGateState({ status: 'pending', data: undefined })).toBe('unknown');
  });

  it('the booking gate stops a guest without a gender before the phone check', () => {
    const user = { phone: '9647700000000', phone_confirmed_at: '2026-10-01T00:00:00Z' };
    expect(bookingGateState({ status: 'success', data: { ...full, gender: null } }, user)).toBe('incomplete');
    expect(bookingGateState({ status: 'success', data: { ...full, gender: 'male' } }, user)).toBe('complete');
  });

  it('after sign-in: staff first, then the gender like any missing field', () => {
    expect(postSignInStep({ ...full, gender: null }, false, { is_active: true })).toBe('staff');
    expect(postSignInStep({ ...full, gender: null }, false)).toBe('await-gate');
    expect(postSignInStep({ ...full, gender: null }, true)).toBe('complete-profile');
    expect(postSignInStep({ ...full, gender: 'female' }, false)).toBe('continue');
  });
});

describe('genderGateStep: the app-open ask', () => {
  afterEach(() => __resetGenderAsked());

  it('asks a guest with no gender on a calm tab', () => {
    expect(genderGateStep(base)).toBe('ask');
    expect(genderGateStep({ ...base, pathname: '/play' })).toBe('ask');
  });

  it('records the sign-up answer first, and asks only if that failed', () => {
    expect(genderGateStep({ ...base, signupGender: 'female' })).toBe('record');
    expect(genderGateStep({ ...base, signupGender: 'female', recordFailed: true })).toBe('ask');
  });

  it('never for staff, an unread staff row, an anonymous session or no session', () => {
    expect(genderGateStep({ ...base, staff: true })).toBe('none');
    expect(genderGateStep({ ...base, staffAnswered: false })).toBe('none');
    expect(genderGateStep({ ...base, isAnonymous: true })).toBe('none');
    expect(genderGateStep({ ...base, hasSession: false })).toBe('none');
  });

  it('not while the gender is set or not known yet', () => {
    expect(genderGateStep({ ...base, gender: 'male' })).toBe('none');
    expect(genderGateStep({ ...base, gender: undefined })).toBe('none');
  });

  it('no loop: once per launch, never over an intent or off the tabs', () => {
    expect(genderGateStep({ ...base, askedThisSession: true })).toBe('none');
    expect(genderGateStep({ ...base, pendingIntent: true })).toBe('none');
    expect(genderGateStep({ ...base, pathname: '/complete-profile' })).toBe('none');
    expect(genderGateStep({ ...base, pathname: '/review' })).toBe('none');
  });

  it('remembers who was asked, per account', () => {
    expect(genderAskedThisSession('a')).toBe(false);
    markGenderAsked('a');
    expect(genderAskedThisSession('a')).toBe(true);
    expect(genderAskedThisSession('b')).toBe(false);
  });
});

describe('the sign-up form', () => {
  it('reads only a real answer from the metadata', () => {
    expect(signupGenderOf({ gender: 'female' })).toBe('female');
    expect(signupGenderOf({ gender: 'male' })).toBe('male');
    expect(signupGenderOf({ gender: 'other' })).toBeNull();
    expect(signupGenderOf({})).toBeNull();
    expect(signupGenderOf(null)).toBeNull();
  });

  it('refuses until a gender is chosen, after the name and before the phone', () => {
    const form = { firstName: 'Sara', lastName: 'Ali', phoneNational: '', password: 'longenough' };
    expect(validateSignUp({ ...form, gender: null })).toBe('GENDER_REQUIRED');
    expect(validateSignUp({ ...form, firstName: '', gender: null })).toBe('FIRST_NAME_REQUIRED');
    expect(validateSignUp({ ...form, gender: 'female' })).toBe('PHONE_REQUIRED');
  });
});
