/**
 * Today with the page lanes mounted (build-contracts-2026-09-23 §6.1): the
 * checklists still to finish at the top of To do, the work list under them,
 * and the rows each role gets. The route's own table case is in
 * staff.smoke.test.tsx; these are extra states, in EN and AR, so this file
 * names no route (smokeCoverage counts each route in exactly one suite).
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import type { MyProtocolWork } from '@touch/core';
import { formatNumber, makeT, type Locale } from '@touch/i18n';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import type { ChecklistsToday } from '../features/staff/checklists/logic';
import StaffToday from '../../app/staff';

const V = TEST_VENUE_ID;
const OPEN_RUN = 'c1a00000-0000-4000-8000-000000000001';
const CLOSE_RUN = 'c1a00000-0000-4000-8000-000000000002';
const STEP = 'c1a00000-0000-4000-8000-000000000003';

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
      expect(screen.getByText(`${t('staff.checklists.title')} · 1`)).toBeTruthy();
      const row = screen.getByTestId(`staff.checklist.${OPEN_RUN}`);
      expect(within(row).getByText(locale === 'ar' ? 'افتتاح المطبخ' : 'Opening the kitchen')).toBeTruthy();
      expect(within(row).getByText(t('staff.checklists.progress', { done: 1, total: 3 }))).toBeTruthy();
      expect(screen.queryByTestId(`staff.checklist.${CLOSE_RUN}`)).toBeNull();
      expect(screen.getByTestId(`staff.todo.${STEP}`)).toBeTruthy();
      // Tree order is screen order: the checklist comes before the step.
      const ids = screen.UNSAFE_root.findAll((n) => typeof n.props.testID === 'string').map(
        (n) => n.props.testID as string,
      );
      expect(ids.indexOf(`staff.checklist.${OPEN_RUN}`)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(`staff.checklist.${OPEN_RUN}`)).toBeLessThan(ids.indexOf(`staff.todo.${STEP}`));
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
        [staffKeys.checklists(V), { ...CHECKLISTS, lists: CHECKLISTS.lists.slice(1) }],
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
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'head_chef' } });
    try {
      for (const [id, key] of [
        ['staff.row.production', 'staff.checklists.production.title'],
        ['staff.row.ideas', 'staff.protocols.ideas.title'],
        ['staff.row.recipe-changes', 'staff.checklists.recipeChange.title'],
        ['staff.row.ask-marketing', 'staff.marketing.rows.ask'],
        ['staff.requests', 'staff.checklists.vacation.row'],
      ] as const) {
        expect(within(screen.getByTestId(id)).getByText(t(key))).toBeTruthy();
      }
      expect(screen.queryByTestId('staff.row.run')).toBeNull();
      expect(screen.queryByTestId('staff.row.marketing-inbox')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  // Wave 5 (wave5-addendum-2026-09-25 §5.3): the people records' counted rows.
  it('counts the reports a manager can review, and puts deductions with the requests', () => {
    const screen = renderRoute(StaffToday, {
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
    });
    try {
      expect(
        within(screen.getByTestId('staff.row.incidents')).getByText(
          t('staff.incidents.rowCount', { count: formatNumber(2, locale) }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('staff.shell.today.groups.team'))).toBeTruthy();
      expect(screen.getByTestId('staff.row.deductions')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('counts the posts waiting on the owner, and those sent back to marketing', () => {
    const owner = renderRoute(StaffToday, {
      locale,
      staff: { role: 'owner' },
      queryData: [[staffKeys.content(V, 'waiting'), { content: [], waiting_count: 2, total: 2 }]],
    });
    try {
      expect(
        within(owner.getByTestId('staff.row.content')).getByText(
          t('staff.content.rowCount', { count: formatNumber(2, locale) }),
        ),
      ).toBeTruthy();
    } finally {
      owner.unmount();
    }
    const marketing = renderRoute(StaffToday, {
      locale,
      staff: { role: 'marketing' },
      queryData: [[staffKeys.content(V, 'changes'), { content: [], waiting_count: 0, total: 1 }]],
    });
    try {
      expect(
        within(marketing.getByTestId('staff.row.content')).getByText(
          t('staff.content.rowChanges', { count: formatNumber(1, locale) }),
        ),
      ).toBeTruthy();
    } finally {
      marketing.unmount();
    }
  });

  it('gives the driver the run and purchases, and no plain shopping row', () => {
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'driver' } });
    try {
      expect(within(screen.getByTestId('staff.row.run')).getByText(t('staff.supplies.rows.run'))).toBeTruthy();
      expect(screen.getByTestId('staff.row.purchases')).toBeTruthy();
      expect(screen.queryByTestId('staff.row.shopping')).toBeNull();
      expect(screen.queryByTestId('staff.row.production')).toBeNull();
      fireEvent.press(screen.getByTestId('staff.row.run'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-shopping' });
    } finally {
      screen.unmount();
    }
  });

  it('never lets a guest in', () => {
    const screen = renderRoute(StaffToday, { locale, session: 'in' });
    try {
      expect(screen.queryByTestId('staff.requests')).toBeNull();
      expect(screen.queryByTestId('staff.row.protocols')).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});
