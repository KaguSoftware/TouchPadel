/**
 * A lesson price change on the staff phone (coaching operator.md §5.14.3,
 * build contracts R80): started on the operator, decided here. The owner opens
 * the proposal's step and reads the lesson type by its name, never its id,
 * with the three answers under it, in EN and AR. staff-step keeps its own
 * route case in staffProtocols.smoke.test.tsx; this suite names no route.
 *
 * Every read is seeded under its `staffKeys` key, so no case reaches the
 * (stubbed) client.
 */
import { describe, expect, it } from '@jest/globals';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import type { Can, RunRow, StepRow } from '@touch/core';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { staffKeys } from '../features/staff/keys';
import type { PriceNumbers, PriceTargets } from '../features/staff/protocols/types';
import StaffStep from '../../app/staff-step';

const V = TEST_VENUE_ID;
const RUN = 'a0000000-0000-4000-8000-00000000a0d1';
const PROPOSE = 'b0000000-0000-4000-8000-00000000b0d1';
const SUB = 'd0000000-0000-4000-8000-00000000d0d1';
const LESSON_TYPE = 'e0000000-0000-4000-8000-00000000e0d1';

const NO_CAN: Can = {
  submit: false,
  withdraw_submission_id: null,
  decide_submission_id: null,
  send_back_targets: [],
  skip: false,
  tick: false,
  edit_items: false,
  add_step: false,
  stop: false,
  withdraw_run: false,
  cancel_schedule: false,
};

const TARGETS: PriceTargets = {
  lesson_types: [
    {
      lesson_type_id: LESSON_TYPE,
      kind: 'group',
      name_en: 'Beginners group',
      name_ar: 'مجموعة المبتدئين',
      duration_min: 90,
      sessions_count: null,
      max_places: null,
      price_iqd: 25000,
      court_share_iqd: 5000,
      is_active: true,
    },
  ],
};

const RUN_ROW: RunRow = {
  id: RUN,
  kind: 'price_promo',
  variant: null,
  title_en: 'Beginners price',
  title_ar: null,
  status: 'active',
  started_by: 'c0000000-0000-4000-8000-0000000000d1',
  started_by_name: 'Manager',
  started_at: '2026-10-01T08:00:00Z',
  finished_at: null,
  scheduled_for: null,
  live_at: null,
  menu_item_id: null,
  promotion_id: null,
  current_steps: [
    {
      id: PROPOSE,
      position: 1,
      step_key: 'propose',
      name_en: 'Propose',
      name_ar: 'Propose',
      status: 'submitted',
      round: 1,
    },
  ],
  waiting_on_me: true,
};

// The owner turned "Needs my OK" on for the proposal, so it waits for them.
const PROPOSE_ROW: StepRow = {
  id: PROPOSE,
  position: 1,
  step_key: 'propose',
  name_en: 'Propose',
  name_ar: 'Propose',
  status: 'submitted',
  round: 1,
  actor_roles: ['manager', 'marketing'],
  assigned_to: null,
  assigned_to_name: null,
  needs_owner_ok: true,
  optional: false,
  after_keys: [],
  opened_at: '2026-10-01T08:00:00Z',
  passed_at: null,
  skip_note: null,
  skipped_by_name: null,
  skipped_at: null,
  items: [],
  submissions: [
    {
      id: SUB,
      round: 1,
      submitted_by: 'c0000000-0000-4000-8000-0000000000d1',
      submitted_by_name: 'Manager',
      submitted_at: '2026-10-01T08:00:00Z',
      // As the propose check stores it: `before` is the server's (R46), not a field.
      record: {
        change: 'lesson_price',
        lesson_type_id: LESSON_TYPE,
        price_iqd: 30000,
        reason: 'Every session is full',
        expected_effect: 'The same fill at a better price',
        before: {
          price_iqd: 25000,
          court_share_iqd: 5000,
          shape: { kind: 'group', duration_min: 90, sessions_count: null, max_places: null },
        },
      },
      photos: [],
      withdrawn_at: null,
      superseded_at: null,
      decision: null,
      decided_by: null,
      decided_by_name: null,
      decided_at: null,
      decision_note: null,
      send_back_to: null,
    },
  ],
};

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('a lesson price change on the phone in %s', (locale) => {
  const t = makeT(locale);

  it('shows the owner the proposal’s lesson type by name, with the three answers', () => {
    const screen = renderRoute(StaffStep, {
      locale,
      staff: { role: 'owner' },
      params: { id: PROPOSE },
      queryData: [
        [
          staffKeys.step(PROPOSE),
          {
            run: { ...RUN_ROW, data: null },
            step: PROPOSE_ROW,
            can: { ...NO_CAN, decide_submission_id: SUB, send_back_targets: [PROPOSE] },
            def: null,
          },
        ],
        [
          staffKeys.run(RUN),
          {
            run: { ...RUN_ROW, template_name_en: 'Price', template_name_ar: 'سعر', data: null },
            steps: [PROPOSE_ROW],
            can: NO_CAN,
          },
        ],
        [staffKeys.priceTargets(V, 'lesson_price'), TARGETS],
      ],
    });
    try {
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(screen.getByText(t('staff.protocols.field.lessonTypeId'))).toBeTruthy();
      expect(
        screen.getByText(locale === 'ar' ? 'مجموعة المبتدئين' : 'Beginners group'),
      ).toBeTruthy();
      // The id itself is never shown, nor the server's `before`.
      expect(screen.queryByText(LESSON_TYPE)).toBeNull();
      expect(screen.getByText(t('work.protocol.change.lesson_price'))).toBeTruthy();
      expect(screen.getByText(formatIQD(30000, locale))).toBeTruthy();
      expect(screen.getByTestId('staff-step.decide.approve')).toBeTruthy();
      expect(screen.getByTestId('staff-step.decide.send-back')).toBeTruthy();
      expect(screen.getByTestId('staff-step.decide.stop')).toBeTruthy();
      expect(screen.queryByTestId('staff-step.submit')).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});

// A coach price's numbers step (operator.md §5.14.3): the manager's form opens
// on the figure the proposal carries, as the operator's prefill does; a
// removal (no figure) asks for none. `numbers` alone cannot tell the two apart.
const COACH = 'f0000000-0000-4000-8000-00000000f0d1';
const NUMBERS = 'b0000000-0000-4000-8000-00000000b0d2';

const COACH_TARGETS: PriceTargets = {
  coaches: [
    {
      coach_id: COACH,
      display_name_en: 'Sara',
      display_name_ar: 'سارة',
      lesson_types: [
        {
          lesson_type_id: LESSON_TYPE,
          name_en: 'Beginners group',
          name_ar: 'مجموعة المبتدئين',
          kind: 'group',
          sessions_count: null,
          type_price_iqd: 25000,
          coach_price_iqd: 35000,
        },
      ],
    },
  ],
};

const COACH_NUMBERS: PriceNumbers = {
  change: 'coach_price',
  sizes: [],
  addons: [],
  promotion: null,
  rate: null,
  featured: null,
  lesson: {
    lesson_type_id: LESSON_TYPE,
    coach_id: COACH,
    kind: 'group',
    name_en: 'Beginners group',
    name_ar: 'مجموعة المبتدئين',
    current_price_iqd: 35000,
    new_price_iqd: 40000,
    current_court_share_iqd: 5000,
    new_court_share_iqd: 5000,
    places_30d: 12,
    owed_30d_iqd: 0,
  },
};

function coachPriceRun(priceIqd: number | null) {
  const propose: StepRow = {
    ...PROPOSE_ROW,
    status: 'passed',
    submissions: [
      {
        ...PROPOSE_ROW.submissions[0]!,
        decision: 'approve',
        record: {
          change: 'coach_price',
          coach_id: COACH,
          lesson_type_id: LESSON_TYPE,
          price_iqd: priceIqd,
          reason: 'Her sessions fill first',
          expected_effect: 'The same fill at a better price',
        },
      },
    ],
  };
  const numbers: StepRow = {
    ...PROPOSE_ROW,
    id: NUMBERS,
    position: 2,
    step_key: 'numbers',
    name_en: 'Numbers',
    name_ar: 'Numbers',
    status: 'open',
    actor_roles: ['manager'],
    needs_owner_ok: false,
    submissions: [],
  };
  const run: RunRow = {
    ...RUN_ROW,
    title_en: 'Sara’s price',
    current_steps: [
      {
        id: NUMBERS,
        position: 2,
        step_key: 'numbers',
        name_en: 'Numbers',
        name_ar: 'Numbers',
        status: 'open',
        round: 1,
      },
    ],
  };
  return { propose, numbers, run };
}

describe.each(LOCALES)('a coach price’s numbers on the phone in %s', (locale) => {
  const t = makeT(locale);
  const render = (priceIqd: number | null) => {
    const { propose, numbers, run } = coachPriceRun(priceIqd);
    return renderRoute(StaffStep, {
      locale,
      staff: { role: 'manager' },
      params: { id: NUMBERS },
      queryData: [
        [
          staffKeys.step(NUMBERS),
          {
            run: { ...run, data: null },
            step: numbers,
            can: { ...NO_CAN, submit: true },
            def: null,
          },
        ],
        [
          staffKeys.run(RUN),
          {
            run: { ...run, template_name_en: 'Price', template_name_ar: 'سعر', data: null },
            steps: [propose, numbers],
            can: NO_CAN,
          },
        ],
        [staffKeys.context('numbers', RUN), COACH_NUMBERS],
        [staffKeys.priceTargets(V, 'coach_price'), COACH_TARGETS],
      ],
    });
  };

  it('opens on the standing figure the proposal carries, so “go” is one tap', () => {
    const screen = render(40000);
    try {
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(screen.getByTestId('staff-step.field.price_iqd').props.value).toBe('40000');
      expect(screen.queryByTestId('staff-step.field.court_share_iqd')).toBeNull();
      expect(screen.getByTestId('staff-step.submit')).toBeTruthy();
      // MB-20: the lesson's figures beside the form; no court share for a coach price, no coach pay.
      expect(
        screen.getByText(
          t('staff.protocols.context.lessonPrice', {
            current: formatIQD(35000, locale),
            next: formatIQD(40000, locale),
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          t('staff.protocols.context.lessonSold', { places: '12', amount: formatIQD(0, locale) }),
        ),
      ).toBeTruthy();
      expect(
        screen.queryByText(
          t('staff.protocols.context.lessonCourtShare', {
            current: formatIQD(5000, locale),
            next: formatIQD(5000, locale),
          }),
        ),
      ).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('asks for no figure when the proposal removes the coach’s own price', () => {
    const screen = render(null);
    try {
      expect(screen.queryByTestId('staff-step.field.price_iqd')).toBeNull();
      expect(screen.getByTestId('staff-step.submit')).toBeTruthy();
      // MB-20: the removal is said in words, not left as a price that moves.
      expect(
        screen.getByText(
          t('staff.protocols.context.coachPriceRemoved', { next: formatIQD(40000, locale) }),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('reads a proposal that removes the coach’s own price as a removal (MB-20)', () => {
    const { propose, run } = coachPriceRun(null);
    const waiting: StepRow = {
      ...propose,
      status: 'submitted',
      submissions: [{ ...propose.submissions[0]!, decision: null }],
    };
    const screen = renderRoute(StaffStep, {
      locale,
      staff: { role: 'owner' },
      params: { id: PROPOSE },
      queryData: [
        [
          staffKeys.step(PROPOSE),
          {
            run: { ...run, data: null },
            step: waiting,
            can: { ...NO_CAN, decide_submission_id: SUB, send_back_targets: [PROPOSE] },
            def: null,
          },
        ],
        [
          staffKeys.run(RUN),
          {
            run: { ...run, template_name_en: 'Price', template_name_ar: 'سعر', data: null },
            steps: [waiting],
            can: NO_CAN,
          },
        ],
        [staffKeys.priceTargets(V, 'coach_price'), COACH_TARGETS],
      ],
    });
    try {
      expect(screen.getByText(t('staff.protocols.context.coachPriceRemovedRecord'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});
