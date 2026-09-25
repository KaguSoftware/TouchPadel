import { describe, expect, it } from 'vitest';
import { createdStaffId, hirePrefill, readHireStep } from './hirePrefill';

const RUN = 'r0000000-0000-4000-8000-000000000001';
const ALI = 'c0000000-0000-4000-8000-00000000a111';
const SARA = 'c0000000-0000-4000-8000-00000000a222';

// protocol_run_detail as the owner reads it: every record visible.
const detail = (steps: unknown[]) => ({ run: { id: RUN, kind: 'hiring' }, steps, can: {} });
const step = (key: string, submissions: unknown[]) => ({ step_key: key, status: 'passed', submissions });
const sub = (decision: string | null, record: unknown) => ({ decision, record });

const CANDIDATES = {
  candidates: [
    { id: ALI, candidate_name: 'Ali Hassan', picked: false },
    { id: SARA, candidate_name: 'Sara Kareem', picked: true },
  ],
  purged: false,
};

describe('the hire prefill', () => {
  it('knows an open add_staff step of a hiring run, and nothing else', () => {
    const open = { run: { id: RUN, kind: 'hiring' }, step: { step_key: 'add_staff', status: 'open' }, can: { submit: true } };
    expect(readHireStep(open)).toEqual({ runId: RUN, isHireStep: true, canSubmit: true, status: 'open' });
    expect(readHireStep({ ...open, step: { step_key: 'add_staff', status: 'passed' } }).canSubmit).toBe(false);
    expect(readHireStep({ ...open, can: { submit: false } }).canSubmit).toBe(false);
    expect(readHireStep({ ...open, run: { id: RUN, kind: 'tournament' } }).isHireStep).toBe(false);
    expect(readHireStep(null)).toEqual({ runId: null, isHireStep: false, canSubmit: false, status: null });
  });

  it('takes the role from the approved position and the name from the approved pick', () => {
    const d = detail([
      step('open_position', [sub('send_back', { role: 'barista' }), sub('approve', { role: 'cashier' })]),
      step('interviews', [sub('approve', { candidate_ids: [ALI, SARA], picked_id: ALI })]),
    ]);
    expect(hirePrefill(d, CANDIDATES)).toEqual({ role: 'cashier', name: 'Ali Hassan' });
  });

  it('falls back to the candidate marked picked, and says nothing when the candidates are gone', () => {
    const d = detail([step('open_position', [sub('auto', { role: 'driver' })]), step('interviews', [])]);
    expect(hirePrefill(d, CANDIDATES)).toEqual({ role: 'driver', name: 'Sara Kareem' });
    expect(hirePrefill(d, { candidates: [], purged: true })).toEqual({ role: 'driver', name: null });
  });

  it('refuses a role no account can be given', () => {
    for (const role of ['owner', 'prep', 'wizard']) {
      const d = detail([step('open_position', [sub('approve', { role })])]);
      expect(hirePrefill(d, CANDIDATES).role, role).toBeNull();
    }
    // An undecided position fills in nothing.
    expect(hirePrefill(detail([step('open_position', [sub(null, { role: 'cashier' })])]), CANDIDATES).role).toBeNull();
  });

  it('reads the new account’s id from the staff-admin answer', () => {
    expect(createdStaffId({ result: 'created', staff: { id: 'abc', display_name: 'X' } })).toBe('abc');
    expect(createdStaffId({ result: 'created' })).toBeNull();
    expect(createdStaffId(undefined)).toBeNull();
  });
});
