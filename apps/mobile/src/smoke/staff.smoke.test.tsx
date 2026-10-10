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
import { describe, expect, it } from '@jest/globals';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { TEST_SESSION } from '../test/authState';
import { staffKeys } from '../features/staff/keys';
import StaffToday from '../../app/staff';
import StaffGroup from '../../app/staff-group';
import StaffWork from '../../app/staff-work';
import StaffRequest from '../../app/staff-request';
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
          { todo: [], waiting: [], decided: [], to_decide: [], counts: { todo: 0, waiting: 0, to_decide: 0 } },
        ],
      ],
    },
  },
  {
    route: 'staff-request',
    Component: StaffRequest,
    labelKey: 'staff.shell.requests.submit',
    options: {
      staff: { role: 'barista' },
      queryData: [
        [staffKeys.requests(TEST_SESSION.user.id), { requests: [], total: 0, pending: 0 }],
      ],
    },
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
      expect(screen.queryByTestId('staff-request.submit')).toBeNull();
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
