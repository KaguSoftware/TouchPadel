/**
 * Open matches at the desk (docs/design/open-matches/operator.md §5.23),
 * against the local stack. Every match is tomorrow night, or a booked one moved
 * back to have started half an hour ago: OM-43 needs the fill deadline plus an
 * hour of lead, and CI's clock is unknown, so the journeys use the calendar,
 * its strip and the match screen, never today's Today group.
 *
 *  1. court_desk starts a match for a typed walk-in from a free slot, fills it
 *     from the match screen (the fourth books the court), and the booking
 *     shows four players and no booking-level no-show; the calendar block
 *     carries 4/4.
 *  2. court_desk marks a started match seat by seat (a ticket comes back, a
 *     no-show's share is written off, Undo is offered) and takes the shares,
 *     one and then several, until the bill is paid.
 *  3. Call-off short: blocked while a seat is unmarked, then the confirmation
 *     names who came and who didn't; the booking is cancelled, the present
 *     guest keeps the ticket and the no-show's is lost.
 *  4. Bump: a filling match on the last free court is cancelled by a desk
 *     booking of that court, with the warning first and the toast after.
 *  5. Management: the owner edits the fill deadline and the ticket price (the
 *     "All branches" lead), the manager reads them; a player report is turned
 *     into a ban from Ops, which the record and the desk show; a manager cashes
 *     a guest's unused tickets out.
 *  6. @ar journeys 1 and 2 condensed in Arabic: right to left, the Arabic
 *     labels, 4/4 in Latin digits.
 *
 * Every player is an `e2e-match-<letter>` account, every name the desk types
 * starts with E2E_MATCH_NAME, and cleanE2eMatches ends what a run leaves, so
 * a rerun without a db reset starts clean. The EN and AR projects run apart
 * (`@ar` is the AR project's grep), so each test seeds what it needs itself.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { ar } from '../../packages/i18n/src/catalogs/ar';
import {
  DEV_PASSWORD,
  E2E_MATCH_NAME,
  FIXTURE_COURT_IDS,
  SEED_STAFF,
  appRpc,
  backdateBookedMatch,
  calendarSlot,
  choose,
  cleanE2eMatches,
  closeStationShift,
  enableMatches,
  ensureOpenDay,
  ensureTillFresh,
  grantTickets,
  passShiftGate,
  readMatchSettings,
  seedBookedMatch,
  seedFillingMatch,
  seedMatchPlayers,
  seedMatchReport,
  serviceClient,
  signedInClient,
  ticketWallet,
  venueBusinessDate,
  venueTime,
} from './helpers';

const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;

const [COURT_1, COURT_2] = FIXTURE_COURT_IDS;
// The EN desk writes times on a 12-hour clock ("6:00 PM", ICU's narrow space before PM).
const AT_SIX_PM = /6:00\s*PM/;
// The fixture defaults (0257): what every run starts from and goes back to.
const DEADLINE_MINUTES = 120;
const TICKET_PRICE_IQD = 10_000;

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

/**
 * A catalog sentence as a pattern: its words literal, each `{placeholder}`
 * anything (the screen fills it, often wrapped in bidi isolates).
 */
function phrase(template: string): RegExp {
  const escaped = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\{\w+\}/g, '.*?').replace(/[{}]/g, '\\$&'));
}

async function seatOf(svc: SupabaseClient, matchId: string, guestId: string): Promise<{ id: string; ticket_id: string | null }> {
  const { data, error } = await svc.from('match_seats').select('id, ticket_id').eq('match_id', matchId).eq('guest_id', guestId).single();
  if (error) throw new Error(`seatOf failed: ${error.message}`);
  return data as { id: string; ticket_id: string | null };
}

/**
 * The status of the ticket a guest's seat in this match used. The players are
 * reused across runs, so their wallets grow; the seat's own ticket is exact.
 */
async function seatTicket(svc: SupabaseClient, matchId: string, guestId: string): Promise<string | null> {
  const seat = await seatOf(svc, matchId, guestId);
  if (!seat.ticket_id) return null;
  const { data, error } = await svc.from('match_tickets').select('status').eq('id', seat.ticket_id).single();
  if (error) throw new Error(`seatTicket failed: ${error.message}`);
  return (data as { status: string }).status;
}

test.describe('operator open matches', () => {
  test.describe.configure({ mode: 'serial' });

  // Tomorrow night on the branch's clock: every start clears OM-43's lead.
  const day = venueBusinessDate(1);
  let svc: SupabaseClient;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    // The desk takes shares here: its first payment starts a shift of its own,
    // not someone else's left open by an earlier suite.
    await closeStationShift();
    await enableMatches({ on: true, deadlineMinutes: DEADLINE_MINUTES, ticketPriceIqd: TICKET_PRICE_IQD });
    await cleanE2eMatches(svc);
  });

  test.afterAll(async () => {
    await cleanE2eMatches(svc);
    await enableMatches({ on: false, deadlineMinutes: DEADLINE_MINUTES, ticketPriceIqd: TICKET_PRICE_IQD });
    await closeStationShift();
  });

  test('court_desk starts an open match for a walk-in and fills it from the match screen', async ({ browser }) => {
    const alpha = `${E2E_MATCH_NAME} Alpha`;
    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({ timeout: 30_000 });

    // A free slot, then the booking dialog's Open match kind hands the typed name to the Start dialog.
    await calendarSlot(page, COURT_1, '12:00').click();
    const booking = page.getByRole('dialog', { name: 'New booking' });
    await booking.getByLabel('Guest name').fill(alpha);
    await booking.getByRole('button', { name: 'Open match', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'Start an open match' });
    await expect(start.getByLabel('Guest name')).toHaveValue(alpha);
    await expect(start.getByTestId('start-price')).toContainText('each player pays');
    await start.getByRole('button', { name: 'Start match' }).click();
    await expect(start).toBeHidden();
    await expect(page).toHaveURL(/\/desk\/matches\/[0-9a-f-]{36}/);

    // The desk fills it from the open seats; the server seats the lowest number.
    const players = page.getByTestId('match-players');
    await expect(players.getByTestId('seat-1')).toContainText(alpha);
    for (const [i, word] of ['Bravo', 'Charlie', 'Delta'].entries()) {
      await players.getByTestId(`seat-${i + 2}`).getByRole('button', { name: 'Add player' }).click();
      const add = page.getByRole('dialog', { name: 'Add player' });
      await add.getByLabel('Guest name').fill(`${E2E_MATCH_NAME} ${word}`);
      await add.getByRole('button', { name: 'Add player' }).click();
      await expect(add).toBeHidden();
      await expect(players.getByTestId(`seat-${i + 2}`)).toContainText(`${E2E_MATCH_NAME} ${word}`);
    }
    // The fourth seat booked the tapped court in the same transaction.
    await expect(page.getByText(/Four in: booked on .*Indoor Court 1/)).toBeVisible();
    await expect(page.getByText(/Booked on .*Indoor Court 1/)).toBeVisible();

    // Its booking: four Players rows, and no booking-level no-show (a match is marked seat by seat).
    await page.getByRole('button', { name: 'Open booking' }).first().click();
    await expect(page).toHaveURL(/\/desk\/bookings\/[0-9a-f-]{36}/);
    const bookingPlayers = page.getByTestId('match-players');
    for (const n of [1, 2, 3, 4]) await expect(bookingPlayers.getByTestId(`seat-${n}`)).toBeVisible();
    await expect(bookingPlayers.getByTestId('seat-4')).toContainText(`${E2E_MATCH_NAME} Delta`);
    await expect(page.getByRole('button', { name: 'Mark no-show', exact: true })).toHaveCount(0);

    // Back on the calendar the block carries the organiser's name and 4/4.
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    const block = page.getByRole('button', { name: new RegExp(alpha) });
    await expect(block.getByTestId('seat-chip')).toHaveText(/4\/4/);
    await expect(block.getByTestId('seat-chip')).toHaveAttribute('aria-label', 'Open match · 4 of 4 players');
    await page.context().close();
  });

  test('court_desk marks a started match seat by seat and takes the shares', async ({ browser }) => {
    const [aya] = await seedMatchPlayers(svc, ['a']);
    await grantTickets(svc, aya!.id, 1);
    const desk = [`${E2E_MATCH_NAME} Echo`, `${E2E_MATCH_NAME} Foxtrot`, `${E2E_MATCH_NAME} Golf`];
    const match = await seedBookedMatch({ organiser: aya!, deskNames: desk, courtId: COURT_1, startAt: venueTime(day, '20:00') });
    await backdateBookedMatch(svc, match.matchId, 30);

    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk/matches/${match.matchId}`);
    const players = page.getByTestId('match-players');
    const seat = (n: number) => players.getByTestId(`seat-${n}`);
    await expect(seat(1)).toContainText(aya!.name);

    // Seats 1–3 came, seat 4 did not.
    for (const n of [1, 2, 3]) {
      await seat(n).getByRole('button', { name: 'Arrived', exact: true }).click();
      await expect(seat(n).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    }
    await seat(4).getByRole('button', { name: 'No-show', exact: true }).click();
    await expect(seat(4)).toContainText("Didn't come · share written off");
    await expect(seat(1)).toContainText('Ticket back');
    await expect(seat(2).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    expect(await seatTicket(svc, match.matchId, aya!.id)).toBe('available');

    // Seat 1's share in cash.
    await seat(1).getByRole('button', { name: 'Take share', exact: true }).click();
    await passShiftGate(page);
    let cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill('100000');
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden();
    await expect(seat(1)).toContainText('Came · paid');

    // Seats 2 and 3 in one payment.
    await players.getByRole('button', { name: 'Take several' }).click();
    await players.getByRole('checkbox', { name: /Echo/ }).check();
    await players.getByRole('checkbox', { name: /Foxtrot/ }).check();
    await players.getByRole('button', { name: /^Take .*shares/ }).click();
    await passShiftGate(page);
    cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill('100000');
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden();
    await expect(seat(2)).toContainText('Came · paid');
    await expect(seat(3)).toContainText('Came · paid');

    // The booking's bill: paid (seat 4's share is written off), and no booking-level no-show.
    await page.getByRole('button', { name: 'Open booking' }).first().click();
    await expect(page).toHaveURL(/\/desk\/bookings\/[0-9a-f-]{36}/);
    await expect(page.getByText('The court fee is paid.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark no-show', exact: true })).toHaveCount(0);
    await page.context().close();
  });

  test('court_desk calls off a started match that is short', async ({ browser }) => {
    const [basma, celine] = await seedMatchPlayers(svc, ['b', 'c']);
    await grantTickets(svc, basma!.id, 1);
    await grantTickets(svc, celine!.id, 1);
    const hotel = `${E2E_MATCH_NAME} Hotel`;
    const india = `${E2E_MATCH_NAME} India`;
    const match = await seedBookedMatch({
      organiser: basma!,
      joiners: [celine!],
      deskNames: [hotel, india],
      courtId: COURT_2,
      startAt: venueTime(day, '21:30'),
    });
    await backdateBookedMatch(svc, match.matchId, 30);

    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk/matches/${match.matchId}`);
    const players = page.getByTestId('match-players');
    const seat = (n: number) => players.getByTestId(`seat-${n}`);
    await expect(seat(2)).toContainText(celine!.name);

    // Three came; Celine is not marked yet, so the call-off waits for her.
    for (const n of [1, 3, 4]) {
      await seat(n).getByRole('button', { name: 'Arrived', exact: true }).click();
      await expect(seat(n).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    }
    const callOff = players.getByRole('button', { name: 'Call off the match' });
    await expect(callOff).toBeDisabled();
    await expect(callOff).toHaveAttribute('title', /Mark every player first/);

    await seat(2).getByRole('button', { name: 'No-show', exact: true }).click();
    await expect(seat(2)).toContainText("Didn't come · share written off");
    await expect(callOff).toBeEnabled();
    await callOff.click();

    const confirm = page.getByRole('dialog', { name: 'Call off this match?' });
    await expect(confirm).toContainText(new RegExp(`Came: .*${basma!.name}.*${hotel}.*${india}`));
    await expect(confirm).toContainText(new RegExp(`Didn't come: .*${celine!.name}`));
    await confirm.getByRole('button', { name: 'Call off the match' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('Called off: a player was missing. Players who came kept their tickets.')).toBeVisible();

    // The booking is cancelled; the one who came has her ticket, the no-show's is lost.
    const { data } = await svc.from('reservations').select('status').eq('id', match.reservationId).single();
    expect((data as { status: string }).status).toBe('cancelled');
    expect(await seatTicket(svc, match.matchId, basma!.id)).toBe('available');
    expect(await seatTicket(svc, match.matchId, celine!.id)).toBe('forfeited');
    await page.context().close();
  });

  test('a desk booking of the last free court cancels a filling match, with a warning first', async ({ browser }) => {
    const [dalia] = await seedMatchPlayers(svc, ['d']);
    await grantTickets(svc, dalia!.id, 1);
    // Court 1 is the desk's at 18:00; the match can still have court 2, the last one free.
    const desk = await signedInClient(SEED_STAFF.court_desk);
    try {
      await appRpc(desk, 'staff_create_reservation', {
        p_court_id: COURT_1,
        p_kind: 'booking',
        p_start_at: venueTime(day, '18:00').toISOString(),
        p_end_at: venueTime(day, '19:30').toISOString(),
        p_guest_name: `${E2E_MATCH_NAME} Juliet`,
      });
    } finally {
      await desk.auth.signOut();
    }
    const match = await seedFillingMatch({ organiser: dalia!, courtId: COURT_2, startAt: venueTime(day, '18:00') });

    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    const strip = page.getByRole('navigation', { name: 'Open matches filling this night' });
    const chip = strip.getByRole('link', { name: AT_SIX_PM });
    await expect(chip).toHaveAttribute('href', new RegExp(match.matchId));

    await calendarSlot(page, COURT_2, '18:00').click();
    const dialog = page.getByRole('dialog', { name: 'New booking' });
    await expect(dialog.getByText(/Booking this court cancels the open match at .*6:00\s*PM/)).toBeVisible();
    await dialog.getByLabel('Guest name').fill(`${E2E_MATCH_NAME} Kilo`);
    await choose(dialog.getByLabel('Duration'), '90');
    await dialog.getByRole('button', { name: 'Create booking' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/The open match at .*6:00\s*PM.* was cancelled/)).toBeVisible();
    await expect(chip).toHaveCount(0);

    const { data } = await svc.from('matches').select('status').eq('id', match.matchId).single();
    expect((data as { status: string }).status).toBe('bumped');
    expect(await seatTicket(svc, match.matchId, dalia!.id)).toBe('available');
    await page.context().close();
  });

  test('the owner edits the open-match rules; the manager reads them', async ({ browser }) => {
    try {
      const owner = await signIn(browser, SEED_STAFF.owner);
      await owner.goto(`${OPERATOR_URL}/admin/settings`);
      await owner.getByRole('tab', { name: 'Venue details' }).click();
      const rules = owner.getByTestId('match-settings');
      await expect(rules.getByText('Changing these changes them at every branch.')).toBeVisible({ timeout: 30_000 });
      await rules.getByLabel('Fill deadline').fill('150');
      await rules.getByLabel('Ticket price').fill('12500');
      await rules.getByRole('button', { name: 'Save open-match rules' }).click();
      await expect(owner.getByText('Open-match rules saved.')).toBeVisible();
      expect(await readMatchSettings()).toMatchObject({ match_fill_deadline_minutes: 150, match_ticket_price_iqd: 12_500 });
      await owner.context().close();

      const manager = await signIn(browser, SEED_STAFF.manager);
      await manager.goto(`${OPERATOR_URL}/admin/settings`);
      await manager.getByRole('tab', { name: 'Venue details' }).click();
      const facts = manager.getByTestId('match-settings');
      await expect(facts.getByText('Only the owner can change these.')).toBeVisible({ timeout: 30_000 });
      await expect(facts).toContainText('150');
      await expect(facts).toContainText('12,500');
      await expect(facts.getByLabel('Fill deadline')).toHaveCount(0);
      await expect(facts.getByRole('button', { name: 'Save open-match rules' })).toHaveCount(0);
      await manager.context().close();
    } finally {
      await enableMatches({ on: true, deadlineMinutes: DEADLINE_MINUTES, ticketPriceIqd: TICKET_PRICE_IQD });
    }
  });

  test('a player report becomes a ban from Ops, shown on the record and at the desk', async ({ browser }) => {
    const [eman, farah] = await seedMatchPlayers(svc, ['e', 'f']);
    await grantTickets(svc, eman!.id, 1);
    await grantTickets(svc, farah!.id, 1);
    const match = await seedFillingMatch({ organiser: eman!, courtId: COURT_1, startAt: venueTime(day, '15:00'), joiners: [farah!] });
    await seedMatchReport(eman!, match.matchId, (await seatOf(svc, match.matchId, farah!.id)).id);

    const manager = await signIn(browser, SEED_STAFF.manager);
    await manager.goto(`${OPERATOR_URL}/ops`);
    const report = manager.getByTestId('match-report').filter({ hasText: farah!.name });
    await expect(report).toContainText('Abusive behaviour', { timeout: 30_000 });
    await expect(report).toContainText(new RegExp(`Reported by .*${eman!.name}`));
    await report.getByRole('button', { name: 'Ban', exact: true }).click();
    const confirm = manager.getByRole('dialog', { name: /from open matches at every branch\?/ });
    await expect(confirm).toContainText('Reported by players');
    await confirm.getByRole('button', { name: 'Ban', exact: true }).click();
    await expect(manager.getByText('Banned from open matches.')).toBeVisible();
    await expect(report).toHaveCount(0);

    const badge = 'Banned from open matches · Reported by players';
    await manager.goto(`${OPERATOR_URL}/desk/customers/${farah!.id}`);
    await expect(manager.getByText(badge, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(manager.getByTestId('customer-matches').getByRole('button', { name: 'Lift ban' })).toBeVisible();
    await manager.context().close();

    // The court desk sees the ban and cannot lift it (banFromMatches is managers' and the owner's).
    const desk = await signIn(browser, SEED_STAFF.court_desk);
    await desk.goto(`${OPERATOR_URL}/desk/customers/${farah!.id}`);
    await expect(desk.getByText(badge, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(desk.getByTestId('customer-matches')).toBeVisible();
    await expect(desk.getByRole('button', { name: 'Lift ban' })).toHaveCount(0);
    await desk.context().close();
  });

  test('a manager cashes out a guest’s unused tickets', async ({ browser }) => {
    const [ghada] = await seedMatchPlayers(svc, ['g']);
    const purchase = await grantTickets(svc, ghada!.id, 2);

    const manager = await signIn(browser, SEED_STAFF.manager);
    await manager.goto(`${OPERATOR_URL}/desk/customers/${ghada!.id}`);
    const cashOut = manager.getByRole('button', { name: /^Cash out .*20,000/ }).first();
    await expect(cashOut).toBeVisible({ timeout: 30_000 });
    await cashOut.click();
    const confirm = manager.getByRole('dialog', { name: /to the card they were bought with\?/ });
    await confirm.getByRole('button', { name: 'Cash out', exact: true }).click();
    await expect(manager.getByText('Refund requested.')).toBeVisible();

    const { data } = await svc.from('booking_payments').select('status, refund_reason').eq('id', purchase).single();
    expect((data as { refund_reason: string }).refund_reason).toBe('ticket_cashout');
    expect(['refund_pending', 'refunded']).toContain((data as { status: string }).status);
    expect((await ticketWallet(svc, ghada!.id)).cashed_out).toBeGreaterThanOrEqual(2);
    await manager.context().close();
  });

  test('@ar the desk starts and fills a match, then marks a started one, in Arabic', async ({ browser }) => {
    const m = ar.ws.matches;
    const page = await signIn(browser, SEED_STAFF.court_desk, 'ar');

    // Journey 1, condensed: start from a free slot, fill it, 4/4 in Latin digits.
    const lima = `${E2E_MATCH_NAME} Lima`;
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: ar.desk.title })).toBeVisible({ timeout: 30_000 });
    await calendarSlot(page, COURT_2, '13:30').click();
    const booking = page.getByRole('dialog', { name: ar.op.desk.newBooking });
    await booking.getByLabel(ar.op.desk.guestName).fill(lima);
    await booking.getByRole('button', { name: m.common.openMatch, exact: true }).click();
    const start = page.getByRole('dialog', { name: m.start.title });
    await start.getByRole('button', { name: m.start.submit }).click();
    await expect(page).toHaveURL(/\/desk\/matches\/[0-9a-f-]{36}/);
    const players = page.getByTestId('match-players');
    for (const [i, word] of ['Mike', 'November', 'Oscar'].entries()) {
      await players.getByTestId(`seat-${i + 2}`).getByRole('button', { name: m.players.addPlayer }).click();
      const add = page.getByRole('dialog', { name: m.add.title });
      await add.getByLabel(ar.op.desk.guestName).fill(`${E2E_MATCH_NAME} ${word}`);
      await add.getByRole('button', { name: m.add.submit }).click();
      await expect(add).toBeHidden();
    }
    await expect(page.getByText(phrase(m.add.fourBooked))).toBeVisible();
    await page.goto(`${OPERATOR_URL}/desk?date=${day}`);
    const chip = page.getByRole('button', { name: new RegExp(lima) }).getByTestId('seat-chip');
    await expect(chip).toHaveText(/4\/4/);
    await expect(chip).not.toHaveText(/[٠-٩]/);

    // Journey 2, condensed: a started match marked seat by seat, in Arabic.
    const [hala] = await seedMatchPlayers(svc, ['h']);
    await grantTickets(svc, hala!.id, 1);
    const started = await seedBookedMatch({
      organiser: hala!,
      deskNames: [`${E2E_MATCH_NAME} Papa`, `${E2E_MATCH_NAME} Quebec`, `${E2E_MATCH_NAME} Romeo`],
      courtId: COURT_1,
      startAt: venueTime(day, '22:00'),
    });
    await backdateBookedMatch(svc, started.matchId, 30);
    await page.goto(`${OPERATOR_URL}/desk/matches/${started.matchId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const seat = (n: number) => page.getByTestId('match-players').getByTestId(`seat-${n}`);
    await seat(1).getByRole('button', { name: m.players.arrived, exact: true }).click();
    await expect(seat(1).getByRole('button', { name: m.players.undo, exact: true })).toBeVisible();
    await expect(seat(1)).toContainText(m.common.ticket.back);
    await seat(4).getByRole('button', { name: m.players.noShow, exact: true }).click();
    await expect(seat(4)).toContainText(m.seat.noShow);
    await expect(seat(4)).not.toContainText(/[٠-٩]/);
    await page.context().close();
  });
});
