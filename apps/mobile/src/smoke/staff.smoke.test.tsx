/**
 * The staff shell: Today and requests, rendered as a staff session
 * (build-contracts-2026-09-23 §6.2), plus the three screens a staff account can
 * be stopped at and the guest tabs' gate. See `src/smoke/auth.smoke.test.tsx`
 * for what a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * A staff case passes `staff: { role }`: renderRoute signs the test session in,
 * mounts StaffStatusProvider and seeds its own-row read, so RequireStaff lets
 * the screen through on the first render. The page lane's screens are cased in
 * staffPages.smoke.test.tsx.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { supabase } from '../lib/supabase';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { TEST_SESSION } from '../test/authState';
import { headerAdd } from '../test/headerAdd';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import StaffToday from '../../app/staff';
import StaffGroup from '../../app/staff-group';
import StaffLayout from '../../app/(staff)/_layout';
import StaffWork from '../../app/(staff)/staff-work';
import StaffRequest from '../../app/(staff)/staff-request';
import StaffRequestNew from '../../app/(staff)/staff-request-new';
import TabsLayout from '../../app/(tabs)/_layout';

runSmokeCases('staff', [
  {
    route: 'staff',
    Component: StaffToday,
    // The pages sit in the group sheets, so the primary is the account's
    // Settings button, which every role sees.
    labelKey: 'settings.title',
    options: { staff: { role: 'head_chef' } },
  },
  {
    // A group's sheet: the requests row is in every role's team group, as
    // "Vacation & requests" (#62).
    route: 'staff-group',
    Component: StaffGroup,
    labelKey: 'staff.checklists.vacation.row',
    options: { staff: { role: 'head_chef' }, params: { group: 'team' } },
  },
  // The staff pages' own stack: a todo in the table (it needs a live router).
  {
    route: 'staff-stack',
    Component: StaffLayout,
  },
  {
    // Today's checklists and work list, behind the Work alerts button. With
    // nothing waiting the page is its empty line, which carries no action, so
    // the case checks its text.
    route: 'staff-work',
    Component: StaffWork,
    nearbyKey: 'staff.shell.work.empty',
    options: {
      staff: { role: 'head_chef' },
      queryData: [
        [staffKeys.checklists(TEST_VENUE_ID), { business_date: '2026-10-10', lists: [] }],
        [
          staffKeys.work(TEST_VENUE_ID),
          {
            todo: [],
            waiting: [],
            decided: [],
            to_decide: [],
            counts: { todo: 0, waiting: 0, to_decide: 0 },
          },
        ],
      ],
    },
  },
  {
    // The list is the page; the + in the bar opens the form, so the case
    // checks the empty line inside the list.
    route: 'staff-request',
    Component: StaffRequest,
    nearbyKey: 'staff.shell.requests.empty',
    options: {
      staff: { role: 'barista' },
      queryData: [
        [staffKeys.requests(TEST_SESSION.user.id), { requests: [], total: 0, pending: 0 }],
      ],
    },
  },
  {
    route: 'staff-request-new',
    Component: StaffRequestNew,
    labelKey: 'staff.shell.requests.submit',
    options: { staff: { role: 'barista' } },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];
const UID = TEST_SESSION.user.id;
const VENUE_B = 'f1f70000-0000-4000-8000-00000000be01';

/** The own-row read answering something other than an active known role. */
const rowSeed = (row: Record<string, unknown>) =>
  [
    staffKeys.status(UID),
    { row: { id: UID, display_name: 'Test Staff', ...row }, venueIds: [] },
  ] as [readonly unknown[], unknown];

describe.each(LOCALES)('the staff area’s stops in %s', (locale) => {
  const t = makeT(locale);

  it('shows a switched-off account the full-screen notice with Sign out, never the guest UI', () => {
    const screen = renderRoute(StaffToday, {
      locale,
      staff: { role: 'chef' },
      queryData: [rowSeed({ role: 'chef', is_active: false })],
    });
    try {
      expect(screen.getByText(t('staff.shell.revoked.title'))).toBeTruthy();
      expect(screen.getByTestId('staff.revoked.sign-out')).toBeTruthy();
      expect(screen.queryByTestId('staff.requests')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('asks for an update when the role is newer than this build', () => {
    const screen = renderRoute(StaffRequest, {
      locale,
      staff: { role: 'chef' },
      queryData: [rowSeed({ role: 'sommelier', is_active: true })],
    });
    try {
      expect(screen.getByText(t('staff.shell.update.title'))).toBeTruthy();
      expect(screen.getByTestId('staff.update.sign-out')).toBeTruthy();
      expect(screen.queryByTestId('staff-request.list')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('offers the venue picker only to an account with more than one venue', () => {
    const one = renderRoute(StaffToday, { locale, staff: { role: 'manager' } });
    try {
      expect(one.queryByTestId('staff.venue')).toBeNull();
    } finally {
      one.unmount();
    }
    const two = renderRoute(StaffToday, {
      locale,
      staff: { role: 'owner', venues: [TEST_VENUE_ID, VENUE_B] },
    });
    try {
      expect(two.getByTestId(`staff.venue.${TEST_VENUE_ID}`)).toBeTruthy();
      expect(two.getByTestId(`staff.venue.${VENUE_B}`)).toBeTruthy();
    } finally {
      two.unmount();
    }
  });

  it('tells the owner that requests are decided on the operator', () => {
    const screen = renderRoute(StaffRequest, {
      locale,
      staff: { role: 'owner' },
      queryData: [[staffKeys.requests(UID), { requests: [], total: 0, pending: 0 }]],
    });
    try {
      expect(screen.getByText(t('staff.shell.requests.decideOnOperator'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  // Sait, 2026-10-17: Undo instead of "Are you sure?". The withdraw shows at
  // once, the toast offers Undo, and Undo puts the request back unsent.
  it('withdraws a request at once with Undo on the toast, and Undo sends nothing', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: null }));
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const row = {
      id: 'req-1',
      kind: 'leave',
      status: 'pending',
      from_date: '2026-10-22',
      to_date: '2026-10-24',
      amount_iqd: null,
      note: '',
      created_at: '2026-10-17T09:00:00Z',
      decided_at: null,
      decision_note: null,
      staff_id: UID,
      staff_name: 'Test Staff',
      staff_role: 'barista',
      decided_by_name: null,
    };
    const screen = renderRoute(StaffRequest, {
      locale,
      staff: { role: 'barista' },
      queryData: [[staffKeys.requests(UID), { requests: [row], total: 1, pending: 1 }]],
    });
    try {
      fireEvent.press(screen.getByTestId('staff-request.withdraw.req-1'));
      await waitFor(() => expect(screen.queryByTestId('staff-request.withdraw.req-1')).toBeNull());
      expect(screen.getAllByText(t('staff.shell.requests.withdrawn')).length).toBeGreaterThan(0);
      fireEvent.press(screen.getByTestId('toast.action'));
      expect(await screen.findByTestId('staff-request.withdraw.req-1')).toBeTruthy();
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('gives every role a + that opens the request form, and no form on the list', () => {
    for (const role of ['barista', 'owner'] as const) {
      const screen = renderRoute(StaffRequest, {
        locale,
        staff: { role },
        queryData: [[staffKeys.requests(UID), { requests: [], total: 0, pending: 0 }]],
      });
      try {
        expect(screen.queryByTestId('staff-request-new.submit')).toBeNull();
        const add = headerAdd(screen);
        expect(add?.label).toBe(t('staff.shell.requests.newTitle'));
        act(() => add?.onPress());
        expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-request-new' });
      } finally {
        screen.unmount();
      }
    }
  });

  it('keeps a staff session out of the guest tabs, which a guest still gets', () => {
    const staff = renderRoute(TabsLayout, { locale, staff: { role: 'driver' } });
    try {
      expect(staff.queryByTestId('tabs.book')).toBeNull();
    } finally {
      staff.unmount();
    }
    const guest = renderRoute(TabsLayout, { locale, session: 'in' });
    try {
      expect(guest.getByTestId('tabs.book')).toBeTruthy();
    } finally {
      guest.unmount();
    }
  });
});
