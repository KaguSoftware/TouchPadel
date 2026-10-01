import { describe, expect, it } from 'vitest';
import {
  isLessonPayment,
  isTerminalScreen,
  parseDepositStatus,
  screenFor,
  type DepositStatus,
} from '../../deposit/logic';
import {
  isResumeSafePath,
  parsePendingPayment,
  serializePendingPayment,
} from '../../deposit/pendingPayment';
import { ENROLMENT_ID } from '../../../test/coachingFixtures';

/**
 * A lesson paid by Qi (docs/design/coaching/guest.md §4.9.3): the lesson
 * branch of `deposit-status` and the payment screen's mapping, and the
 * pointer that survives a killed app.
 */
const NOW = Date.parse('2026-10-01T10:00:00Z');

function lessonStatus(over: Record<string, unknown> = {}): DepositStatus {
  return parseDepositStatus({
    request_id: 'req-1',
    purpose: 'lesson',
    status: 'pending',
    amount_iqd: 30000,
    deadline_at: '2026-10-01T10:15:00Z',
    attempts_left: 2,
    hold_live: true,
    reservation: null,
    lesson: { enrolment_id: ENROLMENT_ID, enrolment_status: 'held', kind: 'private' },
    server_now: '2026-10-01T10:00:00Z',
    ...over,
  });
}

const screen = (over: Record<string, unknown>) =>
  screenFor({ status: lessonStatus(over), failure: null, nowMs: NOW });

describe('the lesson branch of the payment screen', () => {
  it('is told apart by its purpose', () => {
    expect(isLessonPayment(lessonStatus())).toBe(true);
    expect(isLessonPayment(parseDepositStatus({ request_id: 'r' }))).toBe(false);
    expect(lessonStatus().lesson?.enrolmentId).toBe(ENROLMENT_ID);
  });

  it('created and pending check, then still checking past the window', () => {
    expect(screen({ status: 'pending' }).kind).toBe('checking');
    expect(
      screenFor({
        status: lessonStatus(),
        failure: null,
        nowMs: Date.parse('2026-10-01T10:20:00Z'),
      }).kind,
    ).toBe('stillChecking');
  });

  it('succeeded is lessonBooked, with the enrolment; it is terminal', () => {
    const s = screen({ status: 'succeeded' });
    expect(s).toEqual({ kind: 'lessonBooked', enrolmentId: ENROLMENT_ID });
    expect(isTerminalScreen('lessonBooked')).toBe(true);
  });

  it('failed: retry while the hold is live and attempts are left; never paid at the desk here', () => {
    expect(screen({ status: 'failed', failure_code: 'declined' })).toEqual({
      kind: 'failed',
      reason: 'declined',
      holdLive: true,
      canRetry: true,
      canPayAtDesk: false,
      outOfAttempts: false,
    });
    expect(screen({ status: 'failed', hold_live: false })).toMatchObject({
      canRetry: false,
      outOfAttempts: false,
    });
    expect(screen({ status: 'failed', attempts_left: 0 })).toMatchObject({
      canRetry: false,
      outOfAttempts: true,
    });
  });

  it('a refund is never "slot lost": the payment came after the place was released', () => {
    expect(screen({ status: 'refund_pending', refund_reason: 'slot_lost' }).kind).toBe(
      'refundPending',
    );
    expect(screen({ status: 'expired' }).kind).toBe('expired');
    expect(screen({ status: 'refunded' }).kind).toBe('refunded');
    expect(screen({ status: 'refund_failed' }).kind).toBe('refundFailed');
  });
});

describe('the pointer (§4.9.3)', () => {
  it('round-trips a lesson payment with its enrolment', () => {
    const p = {
      ref: 'req-1',
      reservationId: '',
      deadlineAt: '2026-10-01T10:15:00Z',
      purpose: 'lesson' as const,
      lessonEnrolmentId: ENROLMENT_ID,
    };
    expect(parsePendingPayment(serializePendingPayment(p))).toEqual(p);
  });

  it('keeps reading older pointers', () => {
    expect(parsePendingPayment('{"ref":"r","reservationId":"h","deadlineAt":"d"}')).toEqual({
      ref: 'r',
      reservationId: 'h',
      deadlineAt: 'd',
    });
    expect(
      parsePendingPayment('{"ref":"r","reservationId":"","deadlineAt":"d","purpose":"lesson"}'),
    ).toEqual({
      ref: 'r',
      reservationId: '',
      deadlineAt: 'd',
      purpose: 'lesson',
    });
  });

  it('never resumes over the lesson review or coach mode', () => {
    expect(isResumeSafePath('/lesson-review')).toBe(false);
    expect(isResumeSafePath('/coach-mode')).toBe(false);
    expect(isResumeSafePath('/coach-mode-lesson')).toBe(false);
    expect(isResumeSafePath('/my-lessons')).toBe(true);
    expect(isResumeSafePath('/coaches')).toBe(true);
  });
});
