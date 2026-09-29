/**
 * Open matches on the Book tab's booking sheet (docs/design/open-matches/
 * guest.md §4.11): the chips, the entry row and the Book / Start / Join
 * choice, in EN and AR.
 *
 * Not a route case (the Book tab's own case is tabs.smoke.test.tsx's, which
 * renders the court and its CTA): this suite renders the SHEET directly, open,
 * over one branch with two courts, and walks a guest from a free time to
 * where each choice leads. Everything the grid reads is seeded, so no request
 * leaves the render; the choice sheet is ActionSheetIOS (the preset is iOS),
 * spied to answer with the button a case picks.
 *
 * The first case pins rule 1: with the branch's switch off (the fixture's
 * default) there is no chip, no entry row and no choice, and a tap on a free
 * time goes where it always went.
 *
 * A signed-in join or start runs on a `verified` session: `in` has no phone
 * confirmed by a code, and the booking gate stops a start or a join on that as
 * it stops a hold (owner, 2026-09-29), which the gate cases pin.
 */
import { useState } from 'react';
import { ActionSheetIOS, Alert, Animated, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { wallTimeToUtc } from '@touch/core';
import { isolateLtr, makeT, type Locale } from '@touch/i18n';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_MATCH_ID,
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  matchSlotsFixture,
  openMatchesFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { listBookableDates } from '../features/availability/assemble';
import { profileKeys } from '../features/profile/hooks';
import { matchKeys } from '../features/matches/keys';
import { guestWindow, minuteWindow } from '../features/matches/logic';
import { clearPendingJoin, getPendingJoin } from '../features/matches/pendingJoin';
import { clearPendingSlot, getPendingSlot } from '../features/booking/pendingSlot';
import { BookingSheet } from '../components/BookingSheet';
import { nativeChoice } from '../components/nativeChoice';

const TZ = 'Asia/Baghdad';
const COURT_1 = courtFixture();
const COURT_2 = courtFixture({
  id: '22222222-2222-4222-8222-000000000002',
  name_en: 'Court Two',
  name_ar: 'الملعب الثاني',
  sort_order: 2,
});

/** The sheet, open and at rest, as the Book tab mounts it. */
function Sheet() {
  const [progress] = useState(() => new Animated.Value(1));
  return (
    <BookingSheet testID="book.sheet" progress={progress} direction={1} bottomInset={0} isOpen />
  );
}

/**
 * Tomorrow, and its first time: the first cell of each court's lane, which a
 * tap books (or asks about) at once — a later time would first scroll to the
 * middle. At 08:00 it is always more than the fill deadline plus an hour away.
 */
function tomorrow() {
  const settings = venueSettingsFixture();
  const strip = listBookableDates(new Date(), TZ, 6, settings);
  const date = strip[1]!;
  const startAt = wallTimeToUtc(date, 8 * 60, TZ);
  return { strip, date, startAt, startMin: Math.floor(startAt.getTime() / 60_000) };
}

function seeds(over: {
  on: boolean;
  signedIn?: boolean;
  profile?: ReturnType<typeof profileFixture>;
  slots?: ReturnType<typeof matchSlotsFixture>;
  found?: ReturnType<typeof openMatchesFixture>;
}): [readonly unknown[], unknown][] {
  const { strip, startAt } = tomorrow();
  const { from, to } = guestWindow(new Date(), TZ);
  const minute = minuteWindow(startAt);
  return [
    [availabilityKeys.branches, [branchFixture()]],
    [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ matches_enabled: over.on })],
    [availabilityKeys.courts(TEST_VENUE_ID), [COURT_1, COURT_2]],
    [availabilityKeys.rates(TEST_VENUE_ID), []],
    [availabilityKeys.ratePrices, []],
    [availabilityKeys.window(TEST_VENUE_ID, strip[0]!, strip[strip.length - 1]!), []],
    [matchKeys.slots(TEST_VENUE_ID, from, to), over.slots ?? []],
    [matchKeys.open(TEST_VENUE_ID, minute.from, minute.to), over.found ?? openMatchesFixture()],
    ...(over.signedIn
      ? ([[profileKeys.own, over.profile ?? profileFixture()]] as [readonly unknown[], unknown][])
      : []),
  ];
}

/** A match at tomorrow's first time, as `match_slots` answers it. */
function slotAtFirstTime(over: Parameters<typeof matchSlotsFixture>[0] = {}) {
  const { startAt } = tomorrow();
  return matchSlotsFixture({
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 90 * 60_000).toISOString(),
    ...over,
  });
}

/** The same match as the one-minute `open_matches` read finds it. */
function foundAtFirstTime() {
  const { startAt } = tomorrow();
  const base = openMatchesFixture();
  return {
    ...base,
    matches: base.matches.map((m) => ({
      ...m,
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + 90 * 60_000).toISOString(),
    })),
  };
}

let sheetOptions: { title?: string; message?: string; options: string[] } | null = null;
let pick = -1;

beforeEach(() => {
  sheetOptions = null;
  pick = -1;
  jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((options, callback) => {
      sheetOptions = options as typeof sheetOptions;
      callback(pick < 0 ? options.options.length - 1 : pick);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearPendingJoin();
  clearPendingSlot();
});

/** Render, then open tomorrow on the day strip. */
function renderSheet(
  locale: Locale,
  s: [readonly unknown[], unknown][],
  session: 'in' | 'out' | 'verified',
) {
  const screen = renderRoute(Sheet, { locale, session, queryData: s });
  const { date, startMin } = tomorrow();
  fireEvent.press(screen.getByTestId(`book.sheet.day.${date}`));
  const cellId = (courtId: string) => `book.sheet.slot.${courtId}-${startMin}`;
  return { screen, cellId };
}

describe.each<Locale>(['en', 'ar'])('open matches on the booking sheet in %s', (locale) => {
  const t = makeT(locale);

  it('changes nothing while the branch has open matches off', async () => {
    const { screen, cellId } = renderSheet(
      locale,
      seeds({ on: false, slots: slotAtFirstTime() }),
      'out',
    );
    try {
      const cell = screen.getByTestId(cellId(COURT_1.id));
      expect(screen.queryByTestId('book.sheet.open-matches')).toBeNull();
      expect(
        within(cell).queryByText(
          t('matches.book.chipJoin', { seats: t('matches.count.seatsLeft.one') }),
        ),
      ).toBeNull();
      expect(cell.props.accessibilityLabel).toBeUndefined();
      await act(async () => {
        fireEvent.press(cell);
      });
      expect(sheetOptions).toBeNull();
      expect(getPendingSlot()?.courtId).toBe(COURT_1.id);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/welcome' });
    } finally {
      screen.unmount();
    }
  });

  it('draws one chip for the time and the entry row, signed out', () => {
    const { screen, cellId } = renderSheet(
      locale,
      seeds({ on: true, slots: slotAtFirstTime() }),
      'out',
    );
    try {
      const chip = t('matches.book.chipJoin', {
        seats: t('matches.count.seatsLeft.one'),
      });
      const first = screen.getByTestId(cellId(COURT_1.id));
      expect(within(first).getByText(chip)).toBeTruthy();
      expect(first.props.accessibilityLabel).toContain(chip);
      // One chip per time: the second court's cell at that minute carries none.
      expect(within(screen.getByTestId(cellId(COURT_2.id))).queryByText(chip)).toBeNull();
      const entry = screen.getByTestId('book.sheet.open-matches');
      expect(within(entry).getByText(t('matches.book.entrySignIn'))).toBeTruthy();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('asks Join, Book or Start, and keeps a signed-out join for after sign-in', async () => {
    const { screen, cellId } = renderSheet(
      locale,
      seeds({ on: true, slots: slotAtFirstTime() }),
      'out',
    );
    try {
      pick = 0;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      expect(sheetOptions?.options).toEqual([
        t('matches.book.join', { seats: t('matches.count.seatsLeft.one') }),
        t('matches.book.bookCourt'),
        t('matches.book.start'),
        t('common.cancel'),
      ]);
      expect(sheetOptions?.message).toBe(t('matches.book.choiceMessage'));
      expect(getPendingJoin()).toEqual({
        kind: 'slot',
        venueId: TEST_VENUE_ID,
        startAt: tomorrow().startAt.toISOString(),
      });
      expect(getPendingSlot()).toBeNull();
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/welcome' });
    } finally {
      screen.unmount();
    }
  });

  it('opens the one match a signed-in join means', async () => {
    const { screen, cellId } = renderSheet(
      locale,
      seeds({ on: true, signedIn: true, slots: slotAtFirstTime(), found: foundAtFirstTime() }),
      'verified',
    );
    try {
      pick = 0;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      await waitFor(() =>
        expect(routerState.calls).toContainEqual({
          method: 'push',
          arg: { pathname: '/match/[id]', params: { id: TEST_MATCH_ID } },
        }),
      );
    } finally {
      screen.unmount();
    }
  });

  it('says so when the match has gone since the chip was drawn', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { screen, cellId } = renderSheet(
      locale,
      seeds({
        on: true,
        signedIn: true,
        slots: slotAtFirstTime(),
        found: { banned: false, matches: [] },
      }),
      'verified',
    );
    try {
      pick = 0;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith(
          t('errors.title'),
          t('matches.errors.notFound'),
          expect.anything(),
          expect.anything(),
        ),
      );
      expect(routerState.calls.filter((c) => c.method === 'push')).toEqual([]);
    } finally {
      screen.unmount();
    }
  });

  it('starts a match on a free time with no hold, signed in', async () => {
    const { screen, cellId } = renderSheet(locale, seeds({ on: true, signedIn: true }), 'verified');
    try {
      pick = 1;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      // No match at that time: Book, then Start.
      expect(sheetOptions?.options).toEqual([
        t('matches.book.bookCourt'),
        t('matches.book.start'),
        t('common.cancel'),
      ]);
      const { startAt } = tomorrow();
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: {
          pathname: '/match-new',
          params: {
            venueId: TEST_VENUE_ID,
            courtId: COURT_1.id,
            startAt: startAt.toISOString(),
            durationMin: '60',
          },
        },
      });
    } finally {
      screen.unmount();
    }
  });

  it('does nothing when the guest cancels the choice', async () => {
    const { screen, cellId } = renderSheet(locale, seeds({ on: true }), 'out');
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      expect(sheetOptions).not.toBeNull();
      expect(routerState.calls.filter((c) => c.method === 'push')).toEqual([]);
      expect(getPendingSlot()).toBeNull();
      expect(getPendingJoin()).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  // On an unverified phone (`in`): looking at one's own match books nothing.
  it("names the guest's own match and opens it, signed in", async () => {
    const found = foundAtFirstTime();
    const { screen, cellId } = renderSheet(
      locale,
      seeds({
        on: true,
        signedIn: true,
        slots: slotAtFirstTime({ mine: true }),
        found: { ...found, matches: found.matches.map((m) => ({ ...m, mine: 'seated' as const })) },
      }),
      'in',
    );
    try {
      const cell = screen.getByTestId(cellId(COURT_1.id));
      // "3/4" is one LTR isolate: two would let the slash flip in Arabic.
      const taken = isolateLtr(t('matches.common.seatsOf', { taken: '3', total: '4' }));
      expect(within(cell).getByText(t('matches.book.chipMine', { taken }))).toBeTruthy();
      pick = 0;
      await act(async () => {
        fireEvent.press(cell);
      });
      expect(sheetOptions?.options[0]).toBe(t('matches.book.viewMine'));
      await waitFor(() =>
        expect(routerState.calls).toContainEqual({
          method: 'push',
          arg: { pathname: '/match/[id]', params: { id: TEST_MATCH_ID } },
        }),
      );
    } finally {
      screen.unmount();
    }
  });

  it('sends an unverified join to phone verification, the join kept for after the code', async () => {
    const { screen, cellId } = renderSheet(
      locale,
      seeds({ on: true, signedIn: true, slots: slotAtFirstTime(), found: foundAtFirstTime() }),
      'in',
    );
    try {
      pick = 0;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: {
          pathname: '/phone-sign-in',
          params: { returnTo: 'continue', phone: profileFixture().phone },
        },
      });
      expect(getPendingJoin()).toEqual({
        kind: 'slot',
        venueId: TEST_VENUE_ID,
        startAt: tomorrow().startAt.toISOString(),
      });
      expect(getPendingSlot()).toBeNull();
      // Nothing read and nothing opened past the gate.
      expect(routerState.calls.filter((c) => c.method === 'push')).toHaveLength(1);
    } finally {
      screen.unmount();
    }
  });

  it('sends an unverified start to phone verification, the start kept', async () => {
    const { screen, cellId } = renderSheet(locale, seeds({ on: true, signedIn: true }), 'in');
    try {
      pick = 1;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      const { startAt } = tomorrow();
      expect(getPendingJoin()).toEqual({
        kind: 'start',
        venueId: TEST_VENUE_ID,
        courtId: COURT_1.id,
        startAt: startAt.toISOString(),
        durationMin: 60,
        priceIqd: null,
      });
      expect(routerState.calls.filter((c) => c.method === 'push')).toEqual([
        {
          method: 'push',
          arg: {
            pathname: '/phone-sign-in',
            params: { returnTo: 'continue', phone: profileFixture().phone },
          },
        },
      ]);
    } finally {
      screen.unmount();
    }
  });

  it('still sends a phone-less start to complete-profile', async () => {
    const { screen, cellId } = renderSheet(
      locale,
      seeds({ on: true, signedIn: true, profile: profileFixture({ phone: null }) }),
      'verified',
    );
    try {
      pick = 1;
      await act(async () => {
        fireEvent.press(screen.getByTestId(cellId(COURT_1.id)));
      });
      expect(getPendingJoin()?.kind).toBe('start');
      expect(routerState.calls.filter((c) => c.method === 'push')).toEqual([
        {
          method: 'push',
          arg: { pathname: '/complete-profile', params: { returnTo: 'continue' } },
        },
      ]);
    } finally {
      screen.unmount();
    }
  });

  // On an unverified phone (`in`): the list is browsing.
  it('opens the list on the chosen night from the entry row, signed in', () => {
    const { screen } = renderSheet(
      locale,
      seeds({ on: true, signedIn: true, slots: slotAtFirstTime({ mine: true }) }),
      'in',
    );
    try {
      const entry = screen.getByTestId('book.sheet.open-matches');
      expect(within(entry).getByText(t('matches.book.entry'))).toBeTruthy();
      fireEvent.press(entry);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/matches', params: { date: tomorrow().date } },
      });
    } finally {
      screen.unmount();
    }
  });
});

/**
 * The same choice on Android, where the system alert lays out three buttons
 * at most (§4.11 rule 7): three actions leave Cancel to the back button and a
 * tap outside; two leave room for a Cancel button.
 */
describe('nativeChoice on Android', () => {
  type Button = { text?: string; style?: string; onPress?: () => void };
  let buttons: Button[] = [];

  beforeEach(() => {
    buttons = [];
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, list) => {
      buttons = (list ?? []) as Button[];
    });
  });

  it('shows three actions and no Cancel button', async () => {
    const choice = nativeChoice({
      title: 'T',
      options: [
        { value: 'join', label: 'Join' },
        { value: 'book', label: 'Book' },
        { value: 'start', label: 'Start' },
      ],
      cancelLabel: 'Cancel',
    });
    expect(buttons.map((b) => b.text)).toEqual(['Join', 'Book', 'Start']);
    buttons[2]!.onPress!();
    await expect(choice).resolves.toBe('start');
  });

  it('adds Cancel beside two actions, and cancelling answers null', async () => {
    const choice = nativeChoice({
      title: 'T',
      options: [
        { value: 'book', label: 'Book' },
        { value: 'start', label: 'Start' },
      ],
      cancelLabel: 'Cancel',
    });
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Book', undefined],
      ['Start', undefined],
      ['Cancel', 'cancel'],
    ]);
    buttons[2]!.onPress!();
    await expect(choice).resolves.toBeNull();
  });
});
