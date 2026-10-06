/**
 * send-push: is a claimed lesson.reminder still true? (coaching review EC-02;
 * docs/design/coaching/guest.md §4.5.2). Pure, so the DB vitest suite runs it
 * unchanged (tests/send-push-guest.test.ts).
 *
 * app.lesson_sync_reminders deletes a lesson's FUTURE unsent reminders when the
 * lesson or an enrolment changes, but a reminder already due (scheduled_for
 * reached, not yet claimed, or retried after a failed send) survives the
 * delete. This is the backstop at send time: the reminder goes out only while
 *   - its lesson is still scheduled,
 *   - the enrolment it names (payload.id) is booked, belongs to the row's
 *     profile, and is a student's (the guest booked it, or confirmed the link),
 *   - and its lesson still starts 3 hours after the row was due, give or take
 *     2 minutes (a lesson moved since the row was queued has its own reminder).
 * Anything else is REMINDER_STALE, terminal.
 */

/** A lesson.reminder is due this long before the lesson's start (lesson_notify, 0283). */
export const REMINDER_LEAD_MS = 3 * 60 * 60 * 1000;
/** How far the row's due time may sit from start - 3 h and still be this lesson's reminder. */
export const REMINDER_SLACK_MS = 2 * 60 * 1000;

export interface ReminderLesson {
  start_at: string;
  status: string;
}

/** The lesson_enrolments columns the check reads. */
export interface ReminderEnrolment {
  id: string;
  guest_id: string | null;
  status: string;
  booked_by_kind: string;
  link_confirmed_at: string | null;
}

export interface ReminderRow {
  profile_id: string;
  scheduled_for: string;
}

/** True when the reminder must not be sent (REMINDER_STALE). */
export function reminderStale(
  row: ReminderRow,
  lesson: ReminderLesson | undefined,
  enrolment: ReminderEnrolment | undefined,
): boolean {
  if (!lesson || lesson.status !== 'scheduled') return true;
  if (!enrolment || enrolment.status !== 'booked' || enrolment.guest_id !== row.profile_id)
    return true;
  if (enrolment.booked_by_kind !== 'guest' && enrolment.link_confirmed_at === null) return true;
  const start = Date.parse(lesson.start_at);
  const due = Date.parse(row.scheduled_for);
  if (Number.isNaN(start) || Number.isNaN(due)) return true;
  return Math.abs(start - REMINDER_LEAD_MS - due) > REMINDER_SLACK_MS;
}
