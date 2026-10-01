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
import type { PriceTargets } from '../features/staff/protocols/types';
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
