import { describe, expect, it } from 'vitest';
import { coachGate } from '../gate';
import { parseCoachMe, type CoachMe, type CoachMeRetired } from '../logic';
import { NOT_A_COACH, NO_SESSION, PENDING, READ_ERROR } from '../status';
import { coachMeRaw, coachMeRetiredRaw } from '../../../test/coachFixtures';

/** guest.md §4.13.1: the coach-mode gate, retired allowed on the statements only (C-25, R45). */
const coach = parseCoachMe(coachMeRaw()).coach as CoachMe;
const retired = parseCoachMe(coachMeRetiredRaw()).coach as CoachMeRetired;

describe('coachGate', () => {
  it('waits while the status is pending', () => {
    expect(coachGate(PENDING, 'mode')).toBe('loading');
    expect(coachGate(PENDING, 'statements')).toBe('loading');
  });

  it('lets a coach into every coach-mode screen', () => {
    expect(coachGate({ kind: 'coach', coach }, 'mode')).toBe('allow');
    expect(coachGate({ kind: 'coach', coach }, 'statements')).toBe('allow');
  });

  it('lets a retired coach see the statements only, and sends them there from anywhere else', () => {
    expect(coachGate({ kind: 'retired', coach: retired }, 'statements')).toBe('allow');
    expect(coachGate({ kind: 'retired', coach: retired }, 'mode')).toBe('redirect-statements');
  });

  it('sends anyone who is not a coach home', () => {
    expect(coachGate(NOT_A_COACH, 'mode')).toBe('redirect-home');
    expect(coachGate(NO_SESSION, 'statements')).toBe('redirect-home');
  });

  it('shows the error state when the read failed with no answer', () => {
    expect(coachGate(READ_ERROR, 'mode')).toBe('error');
  });
});
