/**
 * The age band the sign-up form asked for (0368; features/auth/ageBand.ts).
 * The recorder writes once, for a guest, only while the profile has none.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAgeBandRecorded,
  ageBandRecordedThisSession,
  markAgeBandRecorded,
  shouldRecordAgeBand,
  signupAgeBandOf,
  type AgeBandRecordInput,
} from '../ageBand';

const UID = 'f1f70000-0000-4000-8000-0000000000aa';

/** A guest whose session just landed carrying the form's answer. */
const base: AgeBandRecordInput = {
  hasSession: true,
  isAnonymous: false,
  staffAnswered: true,
  staff: false,
  band: null,
  signupBand: '25_34',
  recordFailed: false,
  recordedThisSession: false,
};

beforeEach(__resetAgeBandRecorded);

describe('signupAgeBandOf', () => {
  it('reads the six bands out of the metadata and nothing else', () => {
    expect(signupAgeBandOf({ age_band: 'u18' })).toBe('u18');
    expect(signupAgeBandOf({ age_band: '55_plus' })).toBe('55_plus');
    expect(signupAgeBandOf({ age_band: 'old' })).toBeNull();
    expect(signupAgeBandOf({ gender: 'female' })).toBeNull();
    expect(signupAgeBandOf(null)).toBeNull();
    expect(signupAgeBandOf('25_34')).toBeNull();
  });
});

describe('shouldRecordAgeBand', () => {
  it('writes the form’s answer once a guest session has landed', () => {
    expect(shouldRecordAgeBand(base)).toBe(true);
  });

  it('never writes without a session, for an anonymous café session, or for staff', () => {
    expect(shouldRecordAgeBand({ ...base, hasSession: false })).toBe(false);
    expect(shouldRecordAgeBand({ ...base, isAnonymous: true })).toBe(false);
    expect(shouldRecordAgeBand({ ...base, staff: true })).toBe(false);
    // An unread staff row looks like a guest; nothing is written until it answers.
    expect(shouldRecordAgeBand({ ...base, staffAnswered: false })).toBe(false);
  });

  it('writes nothing when the band is not known, already set, or was not asked', () => {
    expect(shouldRecordAgeBand({ ...base, band: undefined })).toBe(false);
    expect(shouldRecordAgeBand({ ...base, band: '35_44' })).toBe(false);
    expect(shouldRecordAgeBand({ ...base, signupBand: null })).toBe(false);
  });

  it('writes once a launch, and not again after a failure', () => {
    expect(shouldRecordAgeBand({ ...base, recordedThisSession: true })).toBe(false);
    expect(shouldRecordAgeBand({ ...base, recordFailed: true })).toBe(false);
  });
});

describe('recorded this session', () => {
  it('is per account and starts empty', () => {
    expect(ageBandRecordedThisSession(UID)).toBe(false);
    markAgeBandRecorded(UID);
    expect(ageBandRecordedThisSession(UID)).toBe(true);
    expect(ageBandRecordedThisSession('other')).toBe(false);
  });
});
