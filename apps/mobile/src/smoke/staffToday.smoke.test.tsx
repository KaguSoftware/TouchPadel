/**
 * Today with the page lanes mounted (build-contracts-2026-09-23 §6.1): the
 * checklists still to finish at the top of To do, the work list under them,
 * and the rows each role gets. The route's own table case is in
 * staff.smoke.test.tsx; these are extra states, in EN and AR, so this file
 * names no route (smokeCoverage counts each route in exactly one suite).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { fireEvent, within } from '@testing-library/react-native';
import type { MyProtocolWork } from '@touch/core';
import { formatNumber, formatTime, makeT, type Locale } from '@touch/i18n';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import { dueText, type ChecklistsToday } from '../features/staff/checklists/logic';
import StaffToday from '../../app/staff';
import StaffGroup from '../../app/staff-group';
import { ROW_GROUPS } from '../features/staff/todayGroups';
import { isGuestPreview, setGuestPreview } from '../features/staff/guestPreview';

const V = TEST_VENUE_ID;
const OPEN_RUN = 'c1a00000-0000-4000-8000-000000000001';
const CLOSE_RUN = 'c1a00000-0000-4000-8000-000000000002';
const STEP = 'c1a00000-0000-4000-8000-000000000003';
// 0323: a person's own list, overdue since this morning.
const PERSON_RUN = 'c1a00000-0000-4000-8000-000000000005';
const PAST_DUE = '2026-09-25T06:00:00Z';
const LATER_DUE = new Date(Date.now() + 3_600_000).toISOString();

const CHECKLISTS: ChecklistsToday = {
  business_date: '2026-09-25',
  lists: [
    {
      run_id: OPEN_RUN,
      role: 'head_chef',
      slot: 'open',
      name_en: 'Opening the kitchen',
      name_ar: 'افتتاح المطبخ',
      done: 1,
      total: 3,
      items: [],
      // 0323: due later today, shared by the role.
      template_id: 'c1a00000-0000-4000-8000-0000000000a1',
      audience: 'role',
      copy_mode: 'shared',
      repeat_kind: 'weekdays',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      period_start: '2026-09-25',
      period_end: '2026-09-25',
      due_at: LATER_DUE,
      overdue: false,
      assignee_id: null,
    },
    // Finished: it leaves Today.
    {
      run_id: CLOSE_RUN,
      role: 'head_chef',
      slot: 'close',
      name_en: 'Closing the kitchen',
      name_ar: 'إغلاق المطبخ',
      done: 2,
      total: 2,
      items: [],
    },
    // 0323: one person's own copy, past its due time; Today puts it first.
    {
      run_id: PERSON_RUN,
      role: null,
      slot: 'open',
      name_en: 'Fridge temperatures',
      name_ar: 'حرارة الثلاجات',
      done: 0,
      total: 2,
      items: [],
      template_id: 'c1a00000-0000-4000-8000-0000000000a2',
      audience: 'people',
      copy_mode: 'each',
      repeat_kind: 'weekdays',
      weekdays: [0, 4],
      period_start: '2026-09-25',
      period_end: '2026-09-27',
      due_at: PAST_DUE,
      overdue: true,
      assignee_id: 'c1a00000-0000-4000-8000-0000000000b1',
    },
  ],
};

const WORK: MyProtocolWork = {
  todo: [
    {
      run_step_id: STEP,
      run_id: 'c1a00000-0000-4000-8000-000000000004',
      kind: 'product_release',
      variant: null,
      title_en: 'Rose latte',
      title_ar: null,
      step_key: 'test',
      name_en: 'Test',
      name_ar: 'التجربة',
      opened_at: '2026-09-25T09:00:00Z',
      round: 1,
    },
  ],
  waiting: [],
  decided: [],
  to_decide: [],
  counts: { todo: 1, waiting: 0, to_decide: 0 },
};

const LOCALES: Locale[] = ['en', 'ar'];

type Screen = ReturnType<typeof renderRoute>;
type Options = NonNullable<Parameters<typeof renderRoute>[1]>;
type Node = ReturnType<Screen['getByTestId']>;

/**
 * Today's pages sit in the group sheets (app/staff-group.tsx): render each
 * group's sheet in turn and hand `fn` the row `id` in the one that holds it.
 * False when no group does.
 */
function withRow(options: Options, id: string, fn?: (row: Node) => void): boolean {
  for (const { key } of ROW_GROUPS) {
    const screen = renderRoute(StaffGroup, { ...options, params: { group: key } });
    try {
      const row = screen.queryByTestId(id);
      if (row) {
        fn?.(row);
        return true;
      }
    } finally {
      screen.unmount();
    }
  }
  return false;
}

describe.each(LOCALES)('Today in %s', (locale) => {
  const t = makeT(locale);

  it('puts the unfinished checklists above the work list, each opening its list', () => {
    const screen = renderRoute(StaffToday, {
      locale,
      staff: { role: 'head_chef' },
      queryData: [
        [staffKeys.checklists(V), CHECKLISTS],
        [staffKeys.work(V), WORK],
      ],
    });
    try {
      expect(screen.getByText(`${t('staff.checklists.title')} · 2`)).toBeTruthy();
      const row = screen.getByTestId(`staff.checklist.${OPEN_RUN}`);
      expect(
        within(row).getByText(locale === 'ar' ? 'افتتاح المطبخ' : 'Opening the kitchen'),
      ).toBeTruthy();
      const now = new Date();
      expect(
        within(row).getByText(
          `${t('staff.checklists.progress', { done: 1, total: 3 })} · ${dueText(CHECKLISTS.lists[0]!, now, locale, CHECKLISTS.business_date)}`,
        ),
      ).toBeTruthy();
      // The overdue person list: its count, and the danger tag in place of the due time.
      const mine = screen.getByTestId(`staff.checklist.${PERSON_RUN}`);
      const overdueLine = dueText(CHECKLISTS.lists[2]!, now, locale, CHECKLISTS.business_date);
      expect(overdueLine).toBe(
        t('staff.checklists.overdueSince', { time: formatTime(new Date(PAST_DUE), locale) }),
      );
      expect(within(mine).getByText(overdueLine!)).toBeTruthy();
      expect(within(mine).getByText(t('staff.checklists.progress', { done: 0, total: 2 }))).toBeTruthy();
      expect(screen.queryByTestId(`staff.checklist.${CLOSE_RUN}`)).toBeNull();
      expect(screen.getByTestId(`staff.todo.${STEP}`)).toBeTruthy();
      // Tree order is screen order: the checklist comes before the step.
      const ids = screen.UNSAFE_root.findAll((n) => typeof n.props.testID === 'string').map(
        (n) => n.props.testID as string,
      );
      expect(ids.indexOf(`staff.checklist.${OPEN_RUN}`)).toBeGreaterThanOrEqual(0);
      // Overdue first.
      expect(ids.indexOf(`staff.checklist.${PERSON_RUN}`)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(`staff.checklist.${PERSON_RUN}`)).toBeLessThan(
        ids.indexOf(`staff.checklist.${OPEN_RUN}`),
      );
      expect(ids.indexOf(`staff.checklist.${OPEN_RUN}`)).toBeLessThan(
        ids.indexOf(`staff.todo.${STEP}`),
      );
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');

      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-checklist', params: { id: OPEN_RUN } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('shows no checklist block when every list is done', () => {
    const screen = renderRoute(StaffToday, {
      locale,
      staff: { role: 'head_chef' },
      queryData: [
        [
          staffKeys.checklists(V),
          { ...CHECKLISTS, lists: CHECKLISTS.lists.filter((l) => l.run_id === CLOSE_RUN) },
        ],
        [staffKeys.work(V), WORK],
      ],
    });
    try {
      expect(screen.queryByText(t('staff.checklists.title'), { exact: false })).toBeNull();
      expect(screen.getByTestId(`staff.todo.${STEP}`)).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives the head chef the kitchen rows and the vacation row, under their labels', () => {
    const chef: Options = { locale, staff: { role: 'head_chef' } };
    for (const [id, key] of [
      ['staff.row.production', 'staff.checklists.production.title'],
      ['staff.row.ideas', 'staff.protocols.ideas.title'],
      ['staff.row.recipe-changes', 'staff.checklists.recipeChange.title'],
      ['staff.requests', 'staff.checklists.vacation.row'],
    ] as const) {
      expect(withRow(chef, id, (row) => expect(within(row).getByText(t(key))).toBeTruthy())).toBe(
        true,
      );
    }
    // Asking marketing is the manager's and the owner's (2026-09-28).
    expect(withRow(chef, 'staff.row.ask-marketing')).toBe(false);
    expect(withRow(chef, 'staff.row.run')).toBe(false);
    expect(withRow(chef, 'staff.row.marketing-inbox')).toBe(false);
  });

  it('shows a tile per group, which opens the group in a sheet', () => {
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'manager' } });
    try {
      const tile = screen.getByTestId('staff.group.team');
      expect(within(tile).getByText(t('staff.shell.today.groups.team'))).toBeTruthy();
      // The rows are in the sheet, not on Today.
      expect(screen.queryByTestId('staff.row.deductions')).toBeNull();
      fireEvent.press(tile);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-group', params: { group: 'team' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('opens the group in its own sheet on Android, whose rows open their page', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'manager' } });
    try {
      expect(screen.queryByTestId('staff.sheet.list')).toBeNull();
      fireEvent.press(screen.getByTestId('staff.group.team'));
      // No route on Android: the native sheet never opened there.
      expect(routerState.calls).toEqual([]);
      const list = screen.getByTestId('staff.sheet.list');
      fireEvent.press(within(list).getByTestId('staff.row.deductions'));
      expect(routerState.calls).toEqual([{ method: 'push', arg: '/staff-deductions' }]);
      expect(screen.queryByTestId('staff.sheet.list')).toBeNull();
    } finally {
      screen.unmount();
      os.restore();
    }
  });

  it('closes the sheet and opens the page from a row', () => {
    const screen = renderRoute(StaffGroup, {
      locale,
      staff: { role: 'manager' },
      params: { group: 'team' },
    });
    try {
      fireEvent.press(screen.getByTestId('staff.row.deductions'));
      // Nothing under the sheet in a test (canGoBack is false), so the close
      // lands on Today before the page is pushed.
      expect(routerState.calls).toEqual([
        { method: 'replace', arg: '/staff' },
        { method: 'push', arg: '/staff-deductions' },
      ]);
    } finally {
      screen.unmount();
    }
  });

  // Wave 5 (wave5-addendum-2026-09-25 §5.3): the people records' counted rows.
  it('counts the reports a manager can review, and puts deductions with the requests', () => {
    const manager: Options = {
      locale,
      staff: { role: 'manager' },
      queryData: [
        [
          staffKeys.incidents(V, 'open'),
          {
            incidents: [
              { id: 'i1', status: 'open', can_review: true },
              { id: 'i2', status: 'open', can_review: true },
              // The manager's own: someone else reviews it.
              { id: 'i3', status: 'open', can_review: false },
            ],
            open_count: 3,
            total: 3,
          },
        ],
      ],
    };
    expect(
      withRow(manager, 'staff.row.incidents', (row) =>
        expect(
          within(row).getByText(t('staff.incidents.rowCount', { count: formatNumber(2, locale) })),
        ).toBeTruthy(),
      ),
    ).toBe(true);
    const team = renderRoute(StaffGroup, { ...manager, params: { group: 'team' } });
    try {
      expect(team.getByTestId('staff.row.deductions')).toBeTruthy();
    } finally {
      team.unmount();
    }
  });

  it('counts the posts waiting on the owner, and those sent back to marketing', () => {
    expect(
      withRow(
        {
          locale,
          staff: { role: 'owner' },
          queryData: [
            [staffKeys.content(V, 'waiting'), { content: [], waiting_count: 2, total: 2 }],
          ],
        },
        'staff.row.content',
        (row) =>
          expect(
            within(row).getByText(t('staff.content.rowCount', { count: formatNumber(2, locale) })),
          ).toBeTruthy(),
      ),
    ).toBe(true);
    expect(
      withRow(
        {
          locale,
          staff: { role: 'marketing' },
          queryData: [
            [staffKeys.content(V, 'changes'), { content: [], waiting_count: 0, total: 1 }],
          ],
        },
        'staff.row.content',
        (row) =>
          expect(
            within(row).getByText(
              t('staff.content.rowChanges', { count: formatNumber(1, locale) }),
            ),
          ).toBeTruthy(),
      ),
    ).toBe(true);
  });

  it('gives the driver the run and purchases, and no plain shopping row', () => {
    const driver: Options = { locale, staff: { role: 'driver' } };
    expect(
      withRow(driver, 'staff.row.run', (row) => {
        expect(within(row).getByText(t('staff.supplies.rows.run'))).toBeTruthy();
        fireEvent.press(row);
        expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-shopping' });
      }),
    ).toBe(true);
    expect(withRow(driver, 'staff.row.purchases')).toBe(true);
    expect(withRow(driver, 'staff.row.shopping')).toBe(false);
    expect(withRow(driver, 'staff.row.production')).toBe(false);
  });

  // Owner, 2026-09-28: Place an order replaces Scan an order on the floor
  // group; Protocols shows only to management or with a run that involves the
  // person; Notes on new items only while one is at its feedback stage.
  it('gives the waiter Place an order, and no Protocols or Notes with nothing in them', () => {
    const waiter: Options = {
      locale,
      staff: { role: 'waiter' },
      queryData: [
        [staffKeys.runs(V, 'active'), { runs: [], total: 0 }],
        [staffKeys.notes(V), []],
      ],
    };
    expect(
      withRow(waiter, 'staff.row.order', (row) => {
        expect(within(row).getByText(t('staff.floor.row'))).toBeTruthy();
        fireEvent.press(row);
        expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-order' });
      }),
    ).toBe(true);
    expect(withRow(waiter, 'staff.row.order-slip')).toBe(false);
    expect(withRow(waiter, 'staff.row.protocols')).toBe(false);
    expect(withRow(waiter, 'staff.row.notes')).toBe(false);
  });

  it('shows Protocols with a run that involves them, and Notes with an item at its feedback stage', () => {
    const waiter: Options = {
      locale,
      staff: { role: 'waiter' },
      queryData: [
        [staffKeys.runs(V, 'active'), { runs: [], total: 1 }],
        [
          staffKeys.notes(V),
          [
            {
              menu_item_id: 'i',
              name_en: 'Rose latte',
              name_ar: 'لاتيه الورد',
              launched_at: '2026-09-27T09:00:00Z',
              window_ends_at: '2026-10-27T09:00:00Z',
              run_id: 'r',
              notes: 0,
              my_notes: 0,
            },
          ],
        ],
      ],
    };
    expect(withRow(waiter, 'staff.row.protocols')).toBe(true);
    expect(withRow(waiter, 'staff.row.notes')).toBe(true);
  });

  it('always shows management the Protocols row', () => {
    const manager: Options = {
      locale,
      staff: { role: 'manager' },
      queryData: [[staffKeys.notes(V), []]],
    };
    expect(withRow(manager, 'staff.row.protocols')).toBe(true);
    expect(withRow(manager, 'staff.row.notes')).toBe(false);
  });

  it('opens the guest view from the account', () => {
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'waiter' } });
    try {
      const button = screen.getByTestId('staff.guest-view');
      expect(within(button).getByText(t('staff.shell.guestView.tile'))).toBeTruthy();
      fireEvent.press(button);
      expect(isGuestPreview()).toBe(true);
      expect(routerState.calls).toContainEqual({ method: 'replace', arg: '/(tabs)' });
    } finally {
      screen.unmount();
      setGuestPreview(false);
    }
  });

  it('never lets a guest in', () => {
    const today = renderRoute(StaffToday, { locale, session: 'in' });
    try {
      expect(today.queryByTestId('staff.group.team')).toBeNull();
    } finally {
      today.unmount();
    }
    expect(withRow({ locale, session: 'in' }, 'staff.requests')).toBe(false);
  });
});
