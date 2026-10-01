/**
 * Coaching on the operator (docs/design/coaching/operator.md §5.22, R58),
 * against the local stack once migrations 0273–0289 are in it. Lesson times are
 * tomorrow on the branch's clock unless a journey backdates one (a lesson cannot
 * be booked in the past), so CI's clock never lands a start inside a cut-off by
 * accident. Desk-typed names carry no digits (deskLogic sanitizeName). Labels
 * are read from the catalogs, so a copy edit does not break a journey.
 *
 *  1. Manager: Make a coach from a guest account (names, bio, a photo stored at
 *     coaches/<uuid>/<uuid>.<ext>, never an id), the waiting-to-accept and
 *     no-hours states, hours set at the desk, and a launched lesson type's price
 *     and length read-only with their ways out.
 *  2. court_desk books a private lesson for a typed walk-in from a free slot;
 *     the lesson screen and the calendar block (only Open lesson).
 *  3. A private lesson that started 30 minutes ago: Arrived, Take payment in
 *     cash with change, then "All paid" in Today's Lessons today.
 *  4. A group session: a directory customer and a typed walk-in; one sign-up
 *     cancelled, then the lesson; a second session inside its cut-off refused.
 *  5. A four-session course with session 3 moved a day; session 2 rescheduled;
 *     the course cancelled.
 *  6. Money: a desk-paid sign-up cancelled → Lesson refunds due on Ops, refunded
 *     with the manager PIN, then on the day close; a statement drafted,
 *     approved without a PIN, a card number refused as the reference, then
 *     marked paid with the PIN.
 *  7. Price approval (R58, R80): a manager proposes a lesson price and puts a
 *     draft type on sale; the owner decides one in the operator and the other
 *     the way the staff phone sends it; the types show the result.
 *  8. Cashier (R20): Take payment from the customer record; the lesson screen is
 *     not theirs.
 *  9. A manager who coaches (CM-11): their own statement reads as theirs and
 *     offers nothing; a direct approve is FORBIDDEN own_statement.
 * 10. Staging with coaching off (R51): the desk still books a lesson.
 * 11. Retiring a coach with lessons (C-25, R45): never refused; both lessons
 *     cancelled; the desk-paid student is a refund due.
 * 12. Online payment through the fake provider (R58): paid online, no Take
 *     payment; cancelled by the desk, the online refund is on Ops.
 * 13. @ar: journeys 2 and 3 condensed in Arabic, right to left, Latin digits.
 *
 * Every coach is an `e2e-coach-<letter>` account (or the seeded manager), every
 * student the desk types starts with E2E_LESSON_NAME, and cleanE2eLessons ends
 * what a run leaves, so a rerun without a db reset starts clean. The EN and AR
 * projects run apart (`@ar` is the AR project's grep), so each test seeds what
 * it needs itself.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { ar } from '../../packages/i18n/src/catalogs/ar';
import { en } from '../../packages/i18n/src/catalogs/en';
import {
  DEV_PASSWORD,
  E2E_LESSON_NAME,
  E2E_LESSON_PRICES,
  E2E_LESSON_TYPES,
  FIXTURE_COURT_IDS,
  FIXTURE_VENUE_ID,
  MANAGER_PIN,
  SEED_STAFF,
  appRpc,
  backdateLesson,
  calendarSlot,
  choose,
  cleanE2eLessons,
  closeStationShift,
  draftCoachStatement,
  enableCoaching,
  ensureOpenDay,
  ensureTillFresh,
  lastMonth,
  lessonReservationId,
  passShiftGate,
  payLessonOnline,
  seedCoach,
  seedCoachAccount,
  seedGroupSession,
  seedLessonTypes,
  seedMatchPlayers,
  seedPrivateLesson,
  serviceClient,
  setLessonTerms,
  settleLessonCash,
  signedInClient,
  venueBusinessDate,
  venueTime,
  type SeededCoach,
  type SeededLessonTypes,
} from './helpers';

const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;
const [COURT_1, COURT_2] = FIXTURE_COURT_IDS;
const C = en.ws.coaching;

async function signIn(browser: Browser, email: string, locale: 'en' | 'ar' = 'en'): Promise<Page> {
  const context = await browser.newContext({ locale: locale === 'ar' ? 'ar-IQ' : 'en-US' });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem('touch-operator-locale', l);
    } catch {
      /* no storage */
    }
  }, locale);
  const page = await context.newPage();
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.locator('input[type="email"]');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.locator('input[type="password"]').fill(DEV_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 30_000 });
  return page;
}

/** A catalog sentence as a pattern: its words literal, each `{placeholder}` anything (bidi isolates included). */
function phrase(template: string): RegExp {
  const escaped = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\{\w+\}/g, '.*?').replace(/[{}]/g, '\\$&'));
}

/** The kit's manager PIN prompt (PinPromptOverlay, "Manager authorisation"): the seeded PIN, then Authorise. */
async function enterPin(page: Page): Promise<void> {
  const prompt = page.getByRole('dialog', { name: en.ws.kit.pin.title });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel(en.ws.kit.pin.pin).fill(MANAGER_PIN);
  await prompt.getByRole('button', { name: en.ws.kit.pin.confirm }).click();
  await expect(prompt).toBeHidden({ timeout: 30_000 });
}

/** The till's PIN-and-reason step (ui PinReasonModal): the seeded PIN with the offered reason, then Confirm. */
async function enterPinWithReason(page: Page): Promise<void> {
  const prompt = page.getByRole('dialog').filter({ has: page.getByLabel(en.op.common.pin) }).last();
  await expect(prompt).toBeVisible();
  await prompt.getByLabel(en.op.common.pin).fill(MANAGER_PIN);
  await prompt.getByRole('button', { name: en.common.confirm }).click();
  await expect(prompt).toBeHidden({ timeout: 30_000 });
}

/** The kit's ReasonCodePrompt: pick the reason by its words, then Continue. */
async function giveReason(page: Page, reason: string): Promise<void> {
  const prompt = page.getByRole('dialog').filter({ has: page.getByRole('radiogroup') }).last();
  await expect(prompt).toBeVisible();
  await prompt.locator('label.tp-choice').filter({ hasText: reason }).click();
  await prompt.getByRole('button', { name: en.ws.kit.reason.confirm }).click();
  await expect(prompt).toBeHidden({ timeout: 30_000 });
}

/** The Today board's "Lessons today" panel, found by its heading. */
function lessonsToday(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: C.today.title }) });
}

/** A roster row of the lesson screen, by the student's name. */
function rosterRow(page: Page, name: string) {
  return page.getByTestId('lesson-roster').getByRole('listitem').filter({ hasText: name }).first();
}

/** A business date moved by whole days ('YYYY-MM-DD'). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A lesson's status straight from the table (service role). */
async function lessonStatus(svc: SupabaseClient, lessonId: string): Promise<{ status: string; cancel_reason: string | null }> {
  const { data, error } = await svc.from('lessons').select('status, cancel_reason').eq('id', lessonId).single();
  if (error) throw new Error(`lessonStatus failed: ${error.message}`);
  return data as { status: string; cancel_reason: string | null };
}

/** The lesson id in the page's URL. */
function lessonIdOf(page: Page): string {
  const m = /\/desk\/lessons\/([0-9a-f-]{36})/.exec(page.url());
  if (!m) throw new Error(`not on a lesson screen: ${page.url()}`);
  return m[1]!;
}

/** A price_promo run's step and its live submission (service role), as packages/db/tests/price-promo.test.ts reads them. */
async function stepOf(svc: SupabaseClient, runId: string, key: string): Promise<string> {
  const { data, error } = await svc.from('protocol_run_steps').select('id').eq('run_id', runId).eq('step_key', key).single();
  if (error) throw new Error(`stepOf ${key}: ${error.message}`);
  return (data as { id: string }).id;
}
async function liveSubmissionOf(svc: SupabaseClient, stepId: string): Promise<string | null> {
  const { data, error } = await svc
    .from('protocol_submissions')
    .select('id')
    .eq('run_step_id', stepId)
    .is('decision', null)
    .is('withdrawn_at', null)
    .is('superseded_at', null)
    .limit(1);
  if (error) throw new Error(`liveSubmissionOf: ${error.message}`);
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

test.describe('operator coaching', () => {
  test.describe.configure({ mode: 'serial' });

  // Tomorrow on the branch's clock: every start clears a 2-hour cut-off.
  const day = venueBusinessDate(1);
  let svc: SupabaseClient;
  let types: SeededLessonTypes;
  let alpha: SeededCoach;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    // The desk takes lesson money here: its first payment starts a shift of its own.
    await closeStationShift();
    await enableCoaching({ enabled: true, mode: 'desk' });
    await cleanE2eLessons(svc);
    types = await seedLessonTypes(svc);
    alpha = await seedCoach(svc, 'A', { lessonTypeIds: [types.privateId, types.groupId, types.courseId] });
  });

  test.afterAll(async () => {
    await cleanE2eLessons(svc);
    await enableCoaching({ enabled: false, mode: 'desk' });
    await setLessonTerms(svc, null);
    await closeStationShift();
  });

  // ---------------------------------------------------------------------
  // 1. Make a coach, hours, and a launched type's locks (§5.13)
  // ---------------------------------------------------------------------
  test('a manager makes a coach, sets the hours, and meets the launched type locks', async ({ browser }) => {
    const bravo = await seedCoachAccount(svc, 'B');
    // A rerun: Bravo is a coach from the last run; retire them so Make a coach revives the row.
    const { data: existing } = await svc.from('coaches').select('id, status').eq('profile_id', bravo.profileId).maybeSingle();
    if (existing && (existing as { status: string }).status !== 'retired') {
      const owner = await signedInClient(SEED_STAFF.owner);
      try {
        await appRpc(owner, 'set_coach_status', { p_coach_id: (existing as { id: string }).id, p_status: 'retired', p_reason: 'e2e rerun' });
      } finally {
        await owner.auth.signOut();
      }
    }

    const A = C.coachesAdmin;
    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/admin/coaches?tab=coaches`);
    await expect(page.getByRole('heading', { name: A.title })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: A.makeCoach }).first().click();
    const make = page.getByRole('dialog', { name: A.promote.title });
    await make.getByLabel(en.ws.courtDesk.create.customer).fill('Playwright Coach Bravo');
    await make.getByRole('button', { name: /Playwright Coach Bravo/ }).first().click();
    await make.getByLabel(A.promote.nameEn).fill('Coach Bravo');
    await make.getByLabel(A.promote.nameAr).fill('المدرّب برافو');
    await make.getByLabel(A.promote.bioEn).fill('Patient with beginners.');
    // A 1×1 PNG: the stored path is a fresh random folder, never an id (R43).
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await make.locator('input[type="file"]').setInputFiles({ name: 'coach.png', mimeType: 'image/png', buffer: png });
    await make.getByRole('checkbox', { name: new RegExp(E2E_LESSON_TYPES.private) }).check();
    await make.getByRole('button', { name: A.promote.submit }).click();
    await expect(make).toBeHidden({ timeout: 30_000 });

    const { data: row } = await svc.from('coaches').select('id, photo_path, status, public_accepted_at').eq('profile_id', bravo.profileId).single();
    const coach = row as { id: string; photo_path: string | null; status: string; public_accepted_at: string | null };
    expect(coach.status).toBe('active');
    expect(coach.public_accepted_at).toBeNull();
    expect(coach.photo_path).toMatch(/^coaches\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/);
    expect(coach.photo_path).not.toContain(bravo.profileId);
    expect(coach.photo_path).not.toContain(coach.id);

    const listRow = page.getByRole('row', { name: /Coach Bravo/ }).first();
    await expect(listRow).toContainText(en.ws.coaching.common.coachStatus.active);
    await expect(listRow).toContainText(A.waitingAccept);
    await expect(listRow).toContainText(A.noHours);

    // Hours: Sunday 09:00–23:00, copied to every day, at this branch.
    const H = C.coachHours;
    const sunday = en.op.days.sun;
    await page.goto(`${OPERATOR_URL}/admin/coaches?tab=hours&coach=${coach.id}`);
    const hours = page.getByTestId('coach-hours');
    await expect(hours).toBeVisible({ timeout: 30_000 });
    await hours.getByRole('button', { name: `${H.addWindow}: ${sunday}` }).click();
    await choose(hours.getByLabel(`${H.windowAria.replace('{day}', sunday).replace('{n}', '1')} · ${H.end}`), '23:00');
    await hours.getByRole('button', { name: H.copyAllAria.replace('{day}', sunday) }).click();
    await page.getByRole('button', { name: H.save }).click();
    await expect(page.getByText(phrase(H.setByStaff))).toBeVisible({ timeout: 30_000 });

    // Lesson types: the launched private type's price is the owner's, its length a new type's.
    const T = C.lessonTypes.editor;
    await page.goto(`${OPERATOR_URL}/admin/coaches?tab=types&type=${types.privateId}`);
    const propose = page.getByRole('button', { name: T.proposePrice }).first();
    await expect(propose).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: T.makeNew })).toBeVisible();
    await propose.click();
    await expect(page).toHaveURL(/\/protocols\?.*start=price_promo.*change=lesson_price.*lessonType=/);
    await expect(page.getByText(en.work.protocol.change.lesson_price).first()).toBeVisible({ timeout: 30_000 });
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 2. A private lesson from a free slot (§5.9)
  // ---------------------------------------------------------------------
  test('court_desk books a private lesson for a walk-in from a free slot', async ({ browser }) => {
    const student = `${E2E_LESSON_NAME} Alpha`;
    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({ timeout: 30_000 });

    // The booking dialog's Lesson kind hands the pressed court, time and typed name to New lesson.
    await calendarSlot(page, COURT_1, '10:00').click();
    const booking = page.getByRole('dialog', { name: en.op.desk.newBooking });
    await booking.getByLabel(en.op.desk.guestName).fill(student);
    await booking.getByRole('button', { name: C.common.lesson, exact: true }).click();
    const start = page.getByRole('dialog', { name: C.common.newLesson });
    await start.getByRole('button', { name: C.common.kind.private, exact: true }).click();
    await choose(start.getByLabel(C.start.coach), { label: alpha.displayName });
    await start.getByRole('button', { name: /^10:00/ }).first().click();
    await expect(start.getByLabel(en.op.desk.guestName)).toHaveValue(student);
    await start.getByLabel(en.op.desk.guestPhone).fill('07701234567');
    await expect(start.getByTestId('lesson-price')).toContainText('30,000');
    await start.getByRole('button', { name: C.start.submit }).click();
    await expect(start).toBeHidden({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/desk\/lessons\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(alpha.displayName);
    await expect(rosterRow(page, student)).toContainText(/To pay .*30,000.* at the desk/);

    // The calendar block names the coach and offers only Open lesson (lessons never drag, R7).
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    const block = page.getByRole('button', { name: new RegExp(alpha.displayName) }).first();
    await expect(block).toBeVisible({ timeout: 30_000 });
    await block.click();
    const summary = page.getByTestId('lesson-summary');
    await expect(summary).toBeVisible();
    const actions = page.getByRole('dialog').filter({ has: summary });
    await expect(actions.getByRole('button', { name: C.common.openLesson })).toBeVisible();
    for (const name of ['Arrived', 'No-show', 'Move', 'Extend', 'Cancel booking']) {
      await expect(actions.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 3. Arrived and Take payment on a started lesson (§5.10.5, §5.10.6, §5.11)
  // ---------------------------------------------------------------------
  test('court_desk marks a started private lesson arrived and takes its payment', async ({ browser }) => {
    const student = `${E2E_LESSON_NAME} Bravo`;
    const lesson = await seedPrivateLesson(svc, {
      coachId: alpha.coachId,
      lessonTypeId: types.privateId,
      startAt: venueTime(day, '14:00'),
      name: student,
    });
    await backdateLesson(svc, lesson.lessonId, 30);

    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk/today`);
    const row = lessonsToday(page).getByRole('listitem').filter({ hasText: student }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: C.today.open, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/desk/lessons/${lesson.lessonId}`));

    const sign = rosterRow(page, student);
    await sign.getByRole('button', { name: C.attendance.arrived, exact: true }).click();
    await expect(sign.getByRole('button', { name: C.attendance.undo, exact: true })).toBeVisible();

    await sign.getByRole('button', { name: C.common.take.button, exact: true }).click();
    await passShiftGate(page);
    const cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill('50000');
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden();
    await expect(page.getByText(/Took .*30,000.* Change .*20,000/)).toBeVisible();
    await expect(sign).toContainText(/Paid at the desk .*30,000/);

    await page.goto(`${OPERATOR_URL}/desk/today`);
    await expect(lessonsToday(page).getByRole('listitem').filter({ hasText: student }).first()).toContainText(C.common.pay.allPaid, {
      timeout: 30_000,
    });
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 4. A group session: add, cancel a sign-up, cancel the lesson, the cut-off (§5.10.7–5.10.8, R47)
  // ---------------------------------------------------------------------
  test('court_desk runs a group session and cancels it', async ({ browser }) => {
    const [customer] = await seedMatchPlayers(svc, ['a']);
    const walkIn = `${E2E_LESSON_NAME} Charlie`;
    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({ timeout: 30_000 });

    await calendarSlot(page, COURT_2, '18:00').click();
    await page.getByRole('dialog', { name: en.op.desk.newBooking }).getByRole('button', { name: C.common.lesson, exact: true }).click();
    const start = page.getByRole('dialog', { name: C.common.newLesson });
    await start.getByRole('button', { name: C.common.kind.group, exact: true }).click();
    await choose(start.getByLabel(C.start.coach), { label: alpha.displayName });
    await start.getByRole('button', { name: C.start.submit }).click();
    await expect(page).toHaveURL(/\/desk\/lessons\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const lessonId = lessonIdOf(page);

    // A directory customer, then a typed walk-in.
    for (const who of [customer!.name, walkIn]) {
      await page.getByRole('button', { name: C.roster.addStudent }).click();
      const add = page.getByRole('dialog', { name: C.add.title });
      if (who === walkIn) {
        await add.getByLabel(C.add.name).fill(walkIn);
      } else {
        await add.getByLabel(en.ws.courtDesk.create.customer).fill(customer!.name);
        await add.getByRole('button', { name: new RegExp(customer!.name) }).first().click();
      }
      await add.getByRole('button', { name: C.add.submit }).click();
      await expect(add).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText(phrase(C.add.added)).first()).toBeVisible();
    }

    // The walk-in's sign-up is cancelled: it moves under Earlier.
    await rosterRow(page, walkIn).getByRole('button', { name: C.roster.cancelSignUp }).click();
    await giveReason(page, en.op.reasons.customer_request);
    await expect(page.getByTestId('lesson-roster').getByText(C.roster.earlier)).toBeVisible();
    await expect(rosterRow(page, walkIn)).toContainText(en.ws.coaching.common.enrolmentStatus.cancelled);

    // Then the lesson, for the coach's reason.
    await page.getByRole('button', { name: C.lesson.cancelLesson }).click();
    await giveReason(page, en.op.reasons.coach_unavailable);
    await expect(page.getByText(C.banner.cancelled.staff_cancel)).toBeVisible({ timeout: 30_000 });
    expect(await lessonStatus(svc, lessonId)).toMatchObject({ status: 'cancelled', cancel_reason: 'staff_cancel' });
    expect(await lessonReservationId(svc, lessonId)).toBeNull();

    // A second group session inside its 2-hour cut-off is refused (R47): an hour from now, when that is in opening hours.
    const soon = new Date(Math.ceil((Date.now() + 60 * 60_000) / 1_800_000) * 1_800_000);
    const localHour = (soon.getUTCHours() + 3) % 24;
    if (localHour >= 9 && localHour < 22) {
      const desk = await signedInClient(SEED_STAFF.court_desk);
      try {
        await expect(
          appRpc(desk, 'desk_create_group', {
            p_coach_id: alpha.coachId,
            p_lesson_type_id: types.groupId,
            p_start_at: soon.toISOString(),
            p_idempotency_key: `lesson.group:${crypto.randomUUID()}`,
          }),
        ).rejects.toThrow(/LESSON_CLOSED/);
      } finally {
        await desk.auth.signOut();
      }
    }
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 5. A course: weekly starts, one moved, a reschedule, cancel the course (§5.9, §5.10.3, §5.10.9)
  // ---------------------------------------------------------------------
  test('court_desk creates a four-session course, reschedules a session, and cancels it', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({ timeout: 30_000 });
    await calendarSlot(page, COURT_1, '16:00').click();
    await page.getByRole('dialog', { name: en.op.desk.newBooking }).getByRole('button', { name: C.common.lesson, exact: true }).click();
    const start = page.getByRole('dialog', { name: C.common.newLesson });
    await start.getByRole('button', { name: C.common.kind.course, exact: true }).click();
    await choose(start.getByLabel(C.start.coach), { label: alpha.displayName });
    await expect(start.getByTestId('course-starts').getByRole('listitem')).toHaveCount(4);
    // Session 3 a day later than the weekly rhythm puts it.
    const third = start.getByLabel(C.start.sessionDate.replace('{n}', '3'));
    await third.fill(addDays(await third.inputValue(), 1));
    await start.getByRole('button', { name: C.start.submit }).click();
    await expect(page).toHaveURL(/\/desk\/lessons\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const strip = page.getByTestId('course-strip');
    await expect(strip.getByRole('link')).toHaveCount(4);

    // Session 2 an hour later on its own day.
    await strip.getByRole('link').nth(1).click();
    await page.getByRole('button', { name: C.lesson.reschedule }).click();
    const reschedule = page.getByRole('dialog', { name: C.reschedule.title });
    await choose(reschedule.getByLabel(C.reschedule.start), venueTime(addDays(day, 7), '17:00').toISOString());
    await reschedule.getByRole('button', { name: C.reschedule.submit }).click();
    await expect(reschedule).toBeHidden({ timeout: 30_000 });
    await expect(strip.getByRole('link').nth(1)).toContainText(/17:00|5:00\s*PM/);

    // Cancel the rest of the course: every session reads Cancelled.
    await page.getByRole('button', { name: C.lesson.cancelCourse }).click();
    await giveReason(page, en.op.reasons.coach_unavailable);
    for (let i = 0; i < 4; i++) {
      await expect(strip.getByRole('link').nth(i)).toContainText(C.common.status.cancelled, { timeout: 30_000 });
    }
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 6. Money: a refund due, the day close, a statement (§5.10.10, §5.16–§5.18)
  // ---------------------------------------------------------------------
  test('a manager refunds a cancelled desk-paid lesson and pays a coach statement', async ({ browser }) => {
    const student = `${E2E_LESSON_NAME} Delta`;
    const lesson = await seedPrivateLesson(svc, {
      coachId: alpha.coachId,
      lessonTypeId: types.privateId,
      startAt: venueTime(day, '12:00'),
      name: student,
    });
    await settleLessonCash(lesson.enrolmentId!, E2E_LESSON_PRICES.private);
    const desk = await signedInClient(SEED_STAFF.court_desk);
    try {
      await appRpc(desk, 'desk_cancel_lesson', { p_lesson_id: lesson.lessonId, p_reason: 'customer_request' });
    } finally {
      await desk.auth.signOut();
    }

    const manager = await signIn(browser, SEED_STAFF.manager);
    await manager.goto(`${OPERATOR_URL}/ops`);
    const due = manager.getByTestId('lesson-refunds-due');
    const row = due.getByTestId('lesson-refund').filter({ hasText: student }).first();
    await expect(row).toContainText(/Due .*30,000/, { timeout: 30_000 });
    await row.getByRole('button', { name: C.refunds.refund }).first().click();
    const refund = manager.getByRole('dialog', { name: en.op.till.refund });
    // Capped at what is due unless it is marked goodwill (R36).
    await expect(refund.getByText(phrase(C.refunds.capLead))).toBeVisible();
    await refund.getByRole('button', { name: en.op.till.refund }).click();
    await enterPinWithReason(manager);
    await expect(row).toHaveCount(0, { timeout: 30_000 });

    // The day close counts the refund on the day it was made (C-31).
    await manager.goto(`${OPERATOR_URL}/admin/day-close`);
    await expect(manager.getByText(C.dayClose.rows.deskRefunded).first()).toBeVisible({ timeout: 30_000 });

    // Statements: last month's statement of Coach Alpha, drafted by the service client.
    const P = C.coachPay;
    await draftCoachStatement(svc, alpha.coachId, lastMonth());
    await manager.goto(`${OPERATOR_URL}/reports/coaches?month=${lastMonth()}`);
    await expect(manager.getByRole('heading', { name: P.title })).toBeVisible({ timeout: 30_000 });
    await manager.getByRole('row', { name: new RegExp(alpha.displayName) }).first().click();
    const statement = manager.getByRole('dialog', { name: new RegExp(alpha.displayName) });
    await expect(statement).toBeVisible();
    const approve = statement.getByRole('button', { name: P.actions.approve, exact: true });
    if (await approve.isVisible()) {
      // Approve is a confirm, never a PIN (R4).
      await approve.click();
      await manager.getByRole('dialog', { name: phrase(P.actions.approveTitle) }).getByRole('button', { name: P.actions.approve }).click();
    }
    await statement.getByRole('button', { name: P.actions.markPaid }).click();
    const markPaid = manager.getByRole('dialog', { name: P.markPaid.title }).last();
    await markPaid.getByLabel(P.markPaid.reference).fill('4111 1111 1111');
    await expect(markPaid.getByText(C.errors.cardNumber)).toBeVisible();
    await markPaid.getByLabel(P.markPaid.reference).fill('E2E REF');
    await markPaid.getByRole('button', { name: P.markPaid.next }).click();
    await enterPin(manager);
    await expect(statement.getByText(phrase(P.dialog.paidLine))).toBeVisible({ timeout: 30_000 });
    await manager.context().close();
  });

  // ---------------------------------------------------------------------
  // 7. Price approval of lesson prices (§5.14, R58, R80)
  // ---------------------------------------------------------------------
  test('lesson price changes go through the owner, one decided as the phone sends it', async ({ browser }) => {
    const newPrice = 35_000;
    const manager = await signedInClient(SEED_STAFF.manager);
    const owner = await signedInClient(SEED_STAFF.owner);
    let priceRun = '';
    let launchRun = '';
    try {
      const reason = { reason: 'Demand is up', expected_effect: 'Same bookings, more per lesson' };
      priceRun = (
        await appRpc<{ run_id: string }>(manager, 'start_protocol', {
          p_kind: 'price_promo',
          p_title_en: 'Playwright lesson price',
          p_title_ar: null,
          p_first_record: { change: 'lesson_price', lesson_type_id: types.privateId, price_iqd: newPrice, ...reason },
          p_venue_id: FIXTURE_VENUE_ID,
        })
      ).run_id;
      launchRun = (
        await appRpc<{ run_id: string }>(manager, 'start_protocol', {
          p_kind: 'price_promo',
          p_title_en: 'Playwright group launch',
          p_title_ar: null,
          p_first_record: { change: 'lesson_launch', lesson_type_id: types.draftGroupId, price_iqd: 15_000, court_share_iqd: 5_000, ...reason },
          p_venue_id: FIXTURE_VENUE_ID,
        })
      ).run_id;
    } finally {
      await manager.auth.signOut();
    }

    // The owner decides the lesson_price proposal in the operator, under "Waiting on you".
    const page = await signIn(browser, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/protocols?run=${priceRun}`);
    await expect(page.getByText(en.work.protocol.change.lesson_price).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0, { timeout: 30_000 });
    await page.context().close();

    const managerAgain = await signedInClient(SEED_STAFF.manager);
    try {
      // The lesson_launch proposal is decided exactly as the staff phone sends it (app.decide_step).
      const launchProp = await liveSubmissionOf(svc, await stepOf(svc, launchRun, 'propose'));
      if (launchProp) await appRpc(owner, 'decide_step', { p_submission_id: launchProp, p_decision: 'approve' });

      // Numbers, announce skipped, apply now, for both runs.
      for (const run of [priceRun, launchRun]) {
        await appRpc(managerAgain, 'submit_step', { p_run_step_id: await stepOf(svc, run, 'numbers'), p_record: { recommendation: 'go' } });
        const num = await liveSubmissionOf(svc, await stepOf(svc, run, 'numbers'));
        if (num) await appRpc(owner, 'decide_step', { p_submission_id: num, p_decision: 'approve' });
        await appRpc(managerAgain, 'skip_step', { p_run_step_id: await stepOf(svc, run, 'announce'), p_note: 'No announcement' });
        await appRpc(managerAgain, 'submit_step', { p_run_step_id: await stepOf(svc, run, 'apply'), p_record: { when: 'now' } });
      }
    } finally {
      await managerAgain.auth.signOut();
      await owner.auth.signOut();
    }

    const { data } = await svc.from('lesson_types').select('id, price_iqd, is_active').in('id', [types.privateId, types.draftGroupId]);
    const byId = new Map(((data ?? []) as { id: string; price_iqd: number; is_active: boolean }[]).map((t) => [t.id, t]));
    expect(byId.get(types.privateId)?.price_iqd).toBe(newPrice);
    expect(byId.get(types.draftGroupId)?.is_active).toBe(true);

    const check = await signIn(browser, SEED_STAFF.manager);
    await check.goto(`${OPERATOR_URL}/admin/coaches?tab=types`);
    await expect(check.getByRole('row', { name: new RegExp(E2E_LESSON_TYPES.draftGroup) }).first()).toContainText(C.lessonTypes.state.onSale, {
      timeout: 30_000,
    });
    await expect(check.getByRole('row', { name: new RegExp(E2E_LESSON_TYPES.private) }).first()).toContainText('35,000');
    await check.context().close();
    // Put the seeded price back for the next journeys (the owner edits directly).
    await seedLessonTypes(svc);
  });

  // ---------------------------------------------------------------------
  // 8. The cashier takes lesson money from the record (R20)
  // ---------------------------------------------------------------------
  test('the cashier takes a lesson payment from the customer record', async ({ browser }) => {
    const [guest] = await seedMatchPlayers(svc, ['b']);
    const group = await seedGroupSession(svc, {
      coachId: alpha.coachId,
      lessonTypeId: types.groupId,
      startAt: venueTime(day, '20:00'),
      students: [{ customerId: guest!.id }],
    });

    const page = await signIn(browser, SEED_STAFF.cashier);
    await page.goto(`${OPERATOR_URL}/desk/customers/${guest!.id}`);
    const panel = page.getByTestId('customer-lessons');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: C.customers.takeCardAria }).first().click();
    await passShiftGate(page);
    const card = page.getByRole('dialog', { name: 'Card' });
    await card.getByRole('button', { name: 'Record payment' }).click();
    await expect(card).toBeHidden({ timeout: 30_000 });
    await expect(panel).toContainText(/Paid at the desk/, { timeout: 30_000 });

    // The lesson screen is the desk's, not the cashier's.
    await page.goto(`${OPERATOR_URL}/desk/lessons/${group.lessonId}`);
    await expect(page.getByTestId('lesson-roster')).toHaveCount(0, { timeout: 30_000 });
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 9. A manager who coaches cannot approve their own statement (CM-11)
  // ---------------------------------------------------------------------
  test('a manager who coaches sees their own statement and cannot approve it', async ({ browser }) => {
    const mike = await seedCoach(svc, 'M', { staff: 'manager', lessonTypeIds: [types.privateId] });
    const statementId = await draftCoachStatement(svc, mike.coachId, lastMonth());

    const P = C.coachPay;
    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/reports/coaches?month=${lastMonth()}`);
    await page.getByRole('row', { name: new RegExp(mike.displayName) }).first().click();
    const dialog = page.getByRole('dialog', { name: new RegExp(mike.displayName) });
    await expect(dialog.getByText(C.errors.ownStatement)).toBeVisible({ timeout: 30_000 });
    for (const name of [P.actions.approve, P.actions.markPaid, P.actions.void, P.actions.recount]) {
      await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await page.context().close();

    if (statementId) {
      const self = await signedInClient(SEED_STAFF.manager);
      try {
        await expect(appRpc(self, 'coach_statement_approve', { p_statement_id: statementId })).rejects.toThrow(/FORBIDDEN/);
      } finally {
        await self.auth.signOut();
      }
    }
  });

  // ---------------------------------------------------------------------
  // 10. Staging with coaching off (R51)
  // ---------------------------------------------------------------------
  test('the desk books a lesson while lessons are switched off at the branch', async ({ browser }) => {
    await enableCoaching({ enabled: false });
    try {
      const page = await signIn(browser, SEED_STAFF.court_desk);
      await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
      await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({ timeout: 30_000 });
      await calendarSlot(page, COURT_2, '11:00').click();
      const booking = page.getByRole('dialog', { name: en.op.desk.newBooking });
      await booking.getByLabel(en.op.desk.guestName).fill(`${E2E_LESSON_NAME} Echo`);
      await booking.getByRole('button', { name: C.common.lesson, exact: true }).click();
      const start = page.getByRole('dialog', { name: C.common.newLesson });
      await expect(start.getByText(C.common.stagingOff)).toBeVisible();
      await start.getByRole('button', { name: C.common.kind.private, exact: true }).click();
      await choose(start.getByLabel(C.start.coach), { label: alpha.displayName });
      await start.getByRole('button', { name: /^11:00/ }).first().click();
      await start.getByRole('button', { name: C.start.submit }).click();
      await expect(page).toHaveURL(/\/desk\/lessons\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await page.context().close();
    } finally {
      await enableCoaching({ enabled: true });
    }
  });

  // ---------------------------------------------------------------------
  // 11. Retiring a coach with lessons (C-25, R45)
  // ---------------------------------------------------------------------
  test('a manager retires a coach with lessons to come; it is never refused', async ({ browser }) => {
    const charlie = await seedCoach(svc, 'C', { lessonTypeIds: [types.privateId, types.groupId] });
    const priv = await seedPrivateLesson(svc, {
      coachId: charlie.coachId,
      lessonTypeId: types.privateId,
      startAt: venueTime(day, '09:30'),
      name: `${E2E_LESSON_NAME} Foxtrot`,
    });
    const paid = `${E2E_LESSON_NAME} Golf`;
    const group = await seedGroupSession(svc, {
      coachId: charlie.coachId,
      lessonTypeId: types.groupId,
      startAt: venueTime(day, '13:00'),
      students: [{ name: paid }],
    });
    await settleLessonCash(group.enrolmentIds[0]!, E2E_LESSON_PRICES.group);

    const E = C.coachesAdmin.editor;
    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/admin/coaches?tab=coaches&coach=${charlie.coachId}`);
    await page.getByRole('button', { name: E.retire, exact: true }).click();
    const confirm = page.getByRole('dialog', { name: phrase(E.retireTitle) });
    await expect(confirm).toContainText(/two lessons|2 lessons/);
    await confirm.getByLabel(E.retireNote).fill('Moved away');
    await confirm.getByRole('button', { name: E.retireConfirm }).click();
    await expect(page.getByText(phrase(E.retired))).toBeVisible({ timeout: 30_000 });

    for (const id of [priv.lessonId, group.lessonId]) {
      expect(await lessonStatus(svc, id)).toMatchObject({ status: 'cancelled', cancel_reason: 'coach_retired' });
      await page.goto(`${OPERATOR_URL}/desk/lessons/${id}`);
      await expect(page.getByText(C.banner.cancelled.coach_retired)).toBeVisible({ timeout: 30_000 });
    }
    await page.goto(`${OPERATOR_URL}/ops`);
    await expect(page.getByTestId('lesson-refunds-due')).toContainText(paid, { timeout: 30_000 });
    await page.context().close();
  });

  // ---------------------------------------------------------------------
  // 12. Online payment through the fake provider (R58)
  // ---------------------------------------------------------------------
  test('a lesson paid online reads Paid online, and its cancel refunds the card', async ({ browser }) => {
    await setLessonTerms(svc);
    await enableCoaching({ enabled: true, mode: 'online_optional' });
    try {
      const [guest] = await seedMatchPlayers(svc, ['c']);
      const lesson = await payLessonOnline(svc, guest!, {
        coachId: alpha.coachId,
        lessonTypeId: types.privateId,
        startAt: venueTime(day, '19:00'),
        priceIqd: E2E_LESSON_PRICES.private,
      });

      const page = await signIn(browser, SEED_STAFF.court_desk);
      await page.goto(`${OPERATOR_URL}/desk/lessons/${lesson.lessonId}`);
      const sign = rosterRow(page, guest!.name);
      await expect(sign).toContainText(/Paid online/, { timeout: 30_000 });
      await expect(sign.getByRole('button', { name: C.common.take.button })).toHaveCount(0);

      await page.getByRole('button', { name: C.lesson.cancelLesson }).click();
      await giveReason(page, en.op.reasons.coach_unavailable);
      await expect(page.getByText(C.banner.cancelled.staff_cancel)).toBeVisible({ timeout: 30_000 });
      await page.context().close();

      const { data } = await svc.from('booking_payments').select('status, refund_reason').eq('lesson_enrolment_id', lesson.enrolmentId!).single();
      expect(['refund_pending', 'refunded']).toContain((data as { status: string }).status);

      const manager = await signIn(browser, SEED_STAFF.manager);
      await manager.goto(`${OPERATOR_URL}/ops`);
      await expect(manager.getByText(new RegExp(`Lesson refund · .*${guest!.name}`)).first()).toBeVisible({ timeout: 30_000 });
      await manager.context().close();
    } finally {
      await enableCoaching({ enabled: true, mode: 'desk' });
    }
  });

  // ---------------------------------------------------------------------
  // 13. @ar: journeys 2 and 3 condensed in Arabic
  // ---------------------------------------------------------------------
  test('@ar the desk books a private lesson and marks a started one, in Arabic', async ({ browser }) => {
    const a = ar.ws.coaching;
    const page = await signIn(browser, SEED_STAFF.court_desk, 'ar');
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: ar.desk.title })).toBeVisible({ timeout: 30_000 });

    // Journey 2, condensed: «حصة» from a free slot, then «حصة جديدة».
    await calendarSlot(page, COURT_2, '15:00').click();
    const booking = page.getByRole('dialog', { name: ar.op.desk.newBooking });
    await booking.getByLabel(ar.op.desk.guestName).fill(`${E2E_LESSON_NAME} Hotel`);
    await booking.getByRole('button', { name: a.common.lesson, exact: true }).click();
    const start = page.getByRole('dialog', { name: a.common.newLesson });
    await start.getByRole('button', { name: a.common.kind.private, exact: true }).click();
    await choose(start.getByLabel(a.start.coach), { label: alpha.displayName });
    await start.getByRole('button', { name: /^(15:00|3:00)/ }).first().click();
    await start.getByRole('button', { name: a.start.submit }).click();
    await expect(page).toHaveURL(/\/desk\/lessons\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(a.common.kind.private).first()).toBeVisible();
    await expect(page.getByTestId('lesson-roster')).toContainText('30,000');
    await expect(page.getByTestId('lesson-roster')).not.toContainText(/[٠-٩]/);

    // Journey 3, condensed: a started lesson, marked arrived.
    const student = `${E2E_LESSON_NAME} India`;
    const lesson = await seedPrivateLesson(svc, { coachId: alpha.coachId, lessonTypeId: types.privateId, startAt: venueTime(day, '21:00'), name: student });
    await backdateLesson(svc, lesson.lessonId, 30);
    await page.goto(`${OPERATOR_URL}/desk/lessons/${lesson.lessonId}`);
    const sign = rosterRow(page, student);
    await expect(sign).toBeVisible({ timeout: 30_000 });
    await sign.getByRole('button', { name: a.attendance.arrived, exact: true }).click();
    await expect(sign.getByRole('button', { name: a.attendance.undo, exact: true })).toBeVisible();
    await expect(sign).toContainText('30,000');
    await expect(sign).not.toContainText(/[٠-٩]/);
    await page.context().close();
  });
});
