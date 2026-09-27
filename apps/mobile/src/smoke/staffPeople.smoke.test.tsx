/**
 * The people records on the staff phone (wave5-addendum-2026-09-25 §5.3):
 * pay deductions, incident reports and content for the owners' approval,
 * each rendered as a staff session of a role that sees its primary, in EN and
 * AR. See `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * Every read a screen makes on its first render is seeded under its
 * `staffKeys` key, so nothing reaches the (mocked) client; no seeded row
 * carries a photo path, which would ask storage for a signed URL.
 *
 * The cases after the table pin who sees what: the person's own deductions
 * with no proposer, the head's form, management's "decide on the operator"
 * line, the reviewer's note and the reporter's own report, the redacted text,
 * the owner's decision with a reason, marketing's next version, and the
 * manager and the guest kept out.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { formatIQD, formatMonthYear, isolate, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import type { DeductionProposal, MyDeductions } from '../features/staff/deductions/api';
import type { IncidentRow, IncidentsPage } from '../features/staff/incidents/api';
import type { ContentDetail, ContentPage, ContentRow } from '../features/staff/content/api';
import StaffDeductions from '../../app/staff-deductions';
import StaffIncidents from '../../app/staff-incidents';
import StaffContent from '../../app/staff-content';

const V = TEST_VENUE_ID;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const NO_CONTENT: ContentPage = { content: [], waiting_count: 0, total: 0 };

function proposal(patch: Partial<DeductionProposal>): DeductionProposal {
  return {
    id: ID(10),
    staff_name: 'Yusuf',
    staff_role: 'barista',
    amount_iqd: 25000,
    deduction_date: '2026-09-20',
    reason: 'Left the bar open overnight',
    status: 'waiting',
    proposed_at: '2026-09-21T08:00:00Z',
    decided_at: null,
    decision_note: null,
    ...patch,
  };
}

function incident(patch: Partial<IncidentRow>): IncidentRow {
  return {
    id: ID(20),
    kind: 'injury',
    occurred_at: '2026-09-25T15:30:00Z',
    place: 'court',
    court_id: ID(90),
    court_name_en: 'Court 2',
    court_name_ar: 'الملعب 2',
    place_detail: null,
    description: 'A player twisted an ankle on the back line',
    people_involved: null,
    photos: [],
    status: 'open',
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: null,
    redacted: false,
    ...patch,
  };
}

function contentRow(patch: Partial<ContentRow>): ContentRow {
  return {
    id: ID(30),
    title: 'Friday latte post',
    channel: 'instagram',
    planned_for: '2026-10-02',
    status: 'waiting',
    current_version: 2,
    author_name: 'Noor',
    submitted_at: '2026-09-25T09:00:00Z',
    cover_image: null,
    menu_item_id: null,
    item_name_en: null,
    item_name_ar: null,
    campaign_id: null,
    campaign_name_en: null,
    campaign_name_ar: null,
    decided_by_name: null,
    decided_at: null,
    updated_at: '2026-09-25T09:00:00Z',
    ...patch,
  };
}

function contentDetail(patch: Partial<ContentDetail>): ContentDetail {
  return {
    content: {
      id: ID(30),
      title: 'Friday latte post',
      channel: 'instagram',
      planned_for: '2026-10-02',
      status: 'waiting',
      current_version: 2,
      author_name: 'Noor',
      menu_item_id: null,
      item_name_en: null,
      item_name_ar: null,
      campaign_id: null,
      campaign_name_en: null,
      campaign_name_ar: null,
      decided_by_name: null,
      decided_at: null,
      created_at: '2026-09-24T09:00:00Z',
      updated_at: '2026-09-25T09:00:00Z',
    },
    versions: [
      {
        version: 2,
        body: 'Friday is latte day. Come early.',
        images: [],
        media_link: 'https://example.com/reel',
        note: null,
        submitted_by_name: 'Noor',
        submitted_at: '2026-09-25T09:00:00Z',
        superseded_at: null,
        decision: null,
        decided_by_name: null,
        decided_at: null,
        decision_note: null,
      },
      {
        version: 1,
        body: 'Latte day.',
        images: [],
        media_link: null,
        note: null,
        submitted_by_name: 'Noor',
        submitted_at: '2026-09-24T09:00:00Z',
        superseded_at: null,
        decision: 'changes',
        decided_by_name: 'Majed',
        decided_at: '2026-09-24T12:00:00Z',
        decision_note: 'Say what time',
      },
    ],
    can_decide: false,
    can_revise: false,
    can_withdraw: false,
    ...patch,
  };
}

runSmokeCases('staff people records', [
  {
    route: 'staff-deductions',
    Component: StaffDeductions,
    labelKey: 'staff.deductions.propose.open',
    options: {
      staff: { role: 'head_barista' },
      queryData: [[staffKeys.myDeductionProposals(V), { proposals: [] }]],
    },
  },
  {
    route: 'staff-incidents',
    Component: StaffIncidents,
    labelKey: 'staff.incidents.form.submit',
    options: {
      staff: { role: 'driver' },
      queryData: [[staffKeys.myIncidents(V), { incidents: [] }]],
    },
  },
  {
    route: 'staff-content',
    Component: StaffContent,
    labelKey: 'staff.content.form.submit',
    options: {
      staff: { role: 'marketing' },
      queryData: [[staffKeys.content(V, 'all'), NO_CONTENT]],
    },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('pay deductions by role in %s', (locale) => {
  const t = makeT(locale);
  const month = (m: string) => formatMonthYear(new Date(`${m}T12:00:00Z`), locale);

  it('shows the person their own month with no proposer, and nothing to propose', () => {
    const mine: MyDeductions = {
      month: '2026-09-01',
      total_iqd: 25000,
      deductions: [
        {
          id: ID(11),
          amount_iqd: 25000,
          deduction_date: '2026-08-30',
          dated_earlier: true,
          reason: 'Left the bar open overnight',
          status: 'approved',
          decided_at: '2026-09-02T08:00:00Z',
        },
        {
          id: ID(12),
          amount_iqd: 10000,
          deduction_date: '2026-09-03',
          dated_earlier: false,
          reason: 'Late twice',
          status: 'cancelled',
          decided_at: '2026-09-04T08:00:00Z',
        },
      ],
    };
    const screen = renderRoute(StaffDeductions, {
      locale,
      params: { view: 'mine' },
      staff: { role: 'barista' },
      queryData: [[staffKeys.myDeductions(V, 'current'), mine]],
    });
    try {
      expect(screen.queryByTestId('staff-deductions.propose')).toBeNull();
      expect(screen.queryByTestId('staff-deductions.view')).toBeNull();
      expect(screen.getByText(month('2026-09-01'))).toBeTruthy();
      expect(
        screen.getByText(t('staff.deductions.mine.total', { month: month('2026-09-01') })),
      ).toBeTruthy();
      expect(screen.getAllByText(formatIQD(25000, locale)).length).toBe(2);
      expect(
        screen.getByText(
          t('staff.deductions.mine.datedEarlier', {
            happened: month('2026-08-01'),
            counted: month('2026-09-01'),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('staff.deductions.mine.cancelled'))).toBeTruthy();
      // The current month is the last one: Next goes nowhere, Previous steps back.
      expect(
        screen.getByTestId('staff-deductions.month.next').props.accessibilityState.disabled,
      ).toBe(true);
      fireEvent.press(screen.getByTestId('staff-deductions.month.prev'));
      expect(screen.getByText(month('2026-08-01'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('opens the head’s form on Propose, and says what is missing before anything is sent', () => {
    const screen = renderRoute(StaffDeductions, {
      locale,
      staff: { role: 'head_barista' },
      queryData: [
        [staffKeys.myDeductionProposals(V), { proposals: [] }],
        [
          staffKeys.deductionTargets(V),
          { staff: [{ id: ID(40), display_name: 'Yusuf', role: 'barista' }] },
        ],
      ],
    });
    try {
      // A head is no manager: no waiting count.
      expect(screen.queryByText(t('staff.deductions.waiting', { count: 1 }))).toBeNull();
      fireEvent.press(screen.getByTestId('staff-deductions.propose'));
      expect(screen.getByTestId(`staff-deductions.target.${ID(40)}`)).toBeTruthy();
      expect(screen.getByText(t('staff.deductions.propose.consequenceAnyone'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-deductions.submit'));
      expect(screen.getByText(t('staff.deductions.propose.errors.who'))).toBeTruthy();
      expect(screen.getByText(t('staff.deductions.propose.errors.amount'))).toBeTruthy();
      expect(screen.getByText(t('staff.deductions.propose.errors.reason'))).toBeTruthy();
      // Choosing the person names them in what happens next.
      fireEvent.press(screen.getByTestId(`staff-deductions.target.${ID(40)}`));
      expect(
        screen.getByText(t('staff.deductions.propose.consequence', { name: isolate('Yusuf') })),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('tells management how many wait, sends them to the operator, and lets them withdraw their own', () => {
    const screen = renderRoute(StaffDeductions, {
      locale,
      staff: { role: 'manager' },
      queryData: [
        [staffKeys.deductionsWaiting(V), { waiting_count: 2 }],
        [
          staffKeys.myDeductionProposals(V),
          {
            proposals: [
              proposal({ id: ID(13) }),
              proposal({
                id: ID(14),
                status: 'declined',
                decision_note: 'Talk to him first',
                decided_at: '2026-09-22T08:00:00Z',
              }),
            ],
          },
        ],
      ],
    });
    try {
      expect(screen.getByText(t('staff.deductions.waiting', { count: 2 }))).toBeTruthy();
      expect(screen.getByTestId('staff-deductions.view.mine')).toBeTruthy();
      expect(screen.getByTestId(`staff-deductions.withdraw.${ID(13)}`)).toBeTruthy();
      expect(screen.queryByTestId(`staff-deductions.withdraw.${ID(14)}`)).toBeNull();
      expect(screen.getByText(t('work.deduction.status.declined'))).toBeTruthy();
      expect(
        screen.getByText(
          t('staff.deductions.proposals.note', { note: isolate('Talk to him first') }),
        ),
      ).toBeTruthy();
      // Nothing on the phone decides a deduction (§8 Q8).
      expect(screen.queryByText(t('work.content.decision.approve'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});

describe.each(LOCALES)('incident reports by role in %s', (locale) => {
  const t = makeT(locale);

  it('asks the reporter what, where and which court before sending, with the privacy line', () => {
    const screen = renderRoute(StaffIncidents, {
      locale,
      staff: { role: 'court_desk' },
      queryData: [
        [
          staffKeys.myIncidents(V),
          {
            incidents: [
              incident({
                id: ID(21),
                redacted: true,
                description: '[deleted by the owner]',
                // Kept until protocol-action's next tick (0198), never shown meanwhile.
                photos: ['v1/incidents/a.jpg'],
              }),
            ],
          },
        ],
        [staffKeys.courts(V), [{ id: ID(90), name_en: 'Court 2', name_ar: 'الملعب 2' }]],
      ],
    });
    try {
      // Not a reviewer: no switch, no review list.
      expect(screen.queryByTestId('staff-incidents.view')).toBeNull();
      expect(screen.getByText(t('staff.incidents.form.privacyHint'))).toBeTruthy();
      expect(screen.getByText(t('staff.incidents.form.whoSees'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-incidents.submit'));
      expect(screen.getByText(t('staff.incidents.form.errors.kind'))).toBeTruthy();
      expect(screen.getByText(t('staff.incidents.form.errors.place'))).toBeTruthy();
      expect(screen.getByText(t('staff.incidents.form.errors.description'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-incidents.place.court'));
      expect(screen.getByTestId(`staff-incidents.court.${ID(90)}`)).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-incidents.submit'));
      expect(screen.getByText(t('staff.incidents.form.errors.court'))).toBeTruthy();
      // A redacted report shows that it was, never the stored marker, and never its photos.
      expect(screen.getByText(t('staff.incidents.list.redacted'))).toBeTruthy();
      expect(screen.queryByText('[deleted by the owner]')).toBeNull();
      expect(screen.queryByLabelText(t('staff.media.photo', { n: 1 }))).toBeNull();
      expect(screen.getByText(t('staff.incidents.list.photosGoing'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('opens management on the reports to review, and a review needs a note', () => {
    const page: IncidentsPage = {
      incidents: [
        incident({
          id: ID(22),
          reported_by_name: 'Hussein',
          reported_by_role: 'court_desk',
          can_review: true,
        }),
        incident({
          id: ID(23),
          kind: 'damage',
          place: 'cafe',
          court_id: null,
          reported_by_name: 'Test Staff',
          reported_by_role: 'manager',
          can_review: false,
        }),
      ],
      open_count: 2,
      total: 2,
    };
    const screen = renderRoute(StaffIncidents, {
      locale,
      staff: { role: 'manager' },
      queryData: [[staffKeys.incidents(V, 'open'), page]],
    });
    try {
      // Two open, one of them the manager's own: one is his to review.
      expect(
        within(screen.getByTestId('staff-incidents.view')).getByText(
          t('staff.incidents.views.review', { count: 1 }),
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId('staff-incidents.submit')).toBeNull();
      // One's own report is reviewed by someone else.
      expect(screen.queryByTestId(`staff-incidents.review.${ID(23)}`)).toBeNull();
      expect(screen.getByText(t('staff.incidents.review.own'))).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-incidents.review.${ID(22)}`));
      expect(screen.getByText(t('staff.incidents.review.noteHint'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-incidents.review.confirm'));
      expect(screen.getByText(t('staff.incidents.review.errors.note'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

describe.each(LOCALES)('content for approval by role in %s', (locale) => {
  const t = makeT(locale);

  it('gives the owner the waiting queue and no form, and opens an item', () => {
    const screen = renderRoute(StaffContent, {
      locale,
      staff: { role: 'owner' },
      queryData: [
        [
          staffKeys.content(V, 'waiting'),
          { content: [contentRow({})], waiting_count: 1, total: 1 },
        ],
      ],
    });
    try {
      expect(screen.queryByTestId('staff-content.submit')).toBeNull();
      expect(screen.getByText(t('staff.content.ownerLead'))).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-content.item.${ID(30)}`));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-content', params: { id: ID(30) } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('lets the owner decide the current version, and a decline asks why', () => {
    const screen = renderRoute(StaffContent, {
      locale,
      params: { id: ID(30) },
      staff: { role: 'owner' },
      queryData: [[staffKeys.contentDetail(ID(30)), contentDetail({ can_decide: true })]],
    });
    try {
      // The post as it stands comes before the decision about it: text and
      // testIDs in the order the screen draws them.
      const order: string[] = [];
      const walk = (n: unknown): void => {
        if (typeof n === 'string') order.push(n);
        else if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') {
          const node = n as { props?: { testID?: unknown }; children?: unknown[] | null };
          if (typeof node.props?.testID === 'string') order.push(`#${node.props.testID}`);
          (node.children ?? []).forEach(walk);
        }
      };
      walk(screen.toJSON());
      const caption = order.indexOf('Friday is latte day. Come early.');
      expect(caption).toBeGreaterThan(-1);
      expect(caption).toBeLessThan(order.indexOf('#staff-content.decide.approve'));
      fireEvent.press(screen.getByTestId('staff-content.decide.approve'));
      expect(
        within(screen.getByTestId('staff-content.decide.confirm')).getByText(
          t('staff.content.decide.confirmApprove', { version: 2 }),
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-content.decide.decline'));
      fireEvent.press(screen.getByTestId('staff-content.decide.confirm'));
      expect(screen.getByText(t('staff.content.decide.errors.reason'))).toBeTruthy();
      // Every round shows, with the owner's earlier reason; the link is text.
      expect(screen.getByText(t('staff.content.item.version', { version: 1 }))).toBeTruthy();
      expect(screen.getByText('https://example.com/reel')).toBeTruthy();
      expect(screen.queryByTestId('staff-content.revise')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('lets marketing send the next version while changes are asked', async () => {
    const screen = renderRoute(StaffContent, {
      locale,
      params: { id: ID(30) },
      staff: { role: 'marketing' },
      queryData: [
        [
          staffKeys.contentDetail(ID(30)),
          contentDetail({
            content: { ...contentDetail({}).content, status: 'changes' },
            versions: [
              {
                ...contentDetail({}).versions[0]!,
                decision: 'changes',
                decided_by_name: 'Majed',
                decided_at: '2026-09-25T20:00:00Z',
                decision_note: 'Shorter, please',
              },
              ...contentDetail({}).versions.slice(1),
            ],
            can_revise: true,
            can_withdraw: true,
          }),
        ],
      ],
    });
    try {
      expect(screen.getByText(t('staff.content.item.changesAsked'))).toBeTruthy();
      // The owner's reason sits with what was asked, not in a version row below.
      expect(
        screen.getByText(t('staff.content.item.ownerSaid', { note: isolate('Shorter, please') })),
      ).toBeTruthy();
      expect(screen.getByTestId('staff-content.withdraw')).toBeTruthy();
      expect(screen.queryByTestId('staff-content.decide.approve')).toBeNull();
      fireEvent.press(screen.getByTestId('staff-content.revise'));
      const send = await screen.findByTestId('staff-content.revise.send');
      expect(
        within(send).getByText(t('staff.content.form.sendVersion', { version: 3 })),
      ).toBeTruthy();
      expect(screen.getByTestId('staff-content.body').props.value).toBe(
        'Friday is latte day. Come early.',
      );
    } finally {
      screen.unmount();
    }
  });

  it('keeps a manager out (§8 Q14)', () => {
    const screen = renderRoute(StaffContent, { locale, staff: { role: 'manager' } });
    try {
      expect(screen.queryByTestId('staff-content.submit')).toBeNull();
      expect(screen.queryByTestId('staff-content.filter.waiting')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('never lets a guest in', () => {
    for (const Component of [StaffDeductions, StaffIncidents, StaffContent]) {
      const screen = renderRoute(Component, { locale, session: 'in' });
      try {
        expect(screen.queryByTestId('staff-deductions.propose')).toBeNull();
        expect(screen.queryByTestId('staff-incidents.submit')).toBeNull();
        expect(screen.queryByTestId('staff-content.submit')).toBeNull();
      } finally {
        screen.unmount();
      }
    }
  });
});
