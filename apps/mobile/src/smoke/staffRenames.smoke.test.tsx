/**
 * Size and add-on renames through a price change on the staff phone
 * (wave5-addendum-2026-09-25 §2.2, #9, §5.3), in EN and AR: marketing's price
 * start folds its "New names" behind one button, each box shows today's name
 * in its own language, and the numbers step shows the owner "Small (4,000 IQD)
 * → Large" in both languages. staff-start and staff-step keep their own route
 * cases in staffProtocols.smoke.test.tsx; this suite names no route.
 *
 * Every read is seeded under its `staffKeys` key, so no case reaches the
 * (stubbed) client.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { formatIQD, isolate, makeT, type Locale } from '@touch/i18n';
import type { Can, RunRow, StepRow } from '@touch/core';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { staffKeys } from '../features/staff/keys';
import type { PriceNumbers, PriceTargets } from '../features/staff/protocols/types';
import StaffStart from '../../app/staff-start';
import StaffStep from '../../app/staff-step';

const V = TEST_VENUE_ID;
const ITEM = 'e0000000-0000-4000-8000-00000000e0a1';
const SMALL = 'e0000000-0000-4000-8000-00000000e0b1';
const LARGE = 'e0000000-0000-4000-8000-00000000e0b2';
const RUN = 'a0000000-0000-4000-8000-00000000a0c1';
const PROPOSE = 'b0000000-0000-4000-8000-00000000b0c1';
const NUMBERS = 'b0000000-0000-4000-8000-00000000b0c2';

const TARGETS: PriceTargets = {
  items: [
    {
      menu_item_id: ITEM,
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_kind: 'cafe',
      is_active: true,
      sizes: [
        { variant_id: SMALL, name_en: 'Small', name_ar: 'صغير', price_iqd: 4000 },
        { variant_id: LARGE, name_en: 'Large', name_ar: 'كبير', price_iqd: 5500 },
      ],
    },
  ],
  featured_item_id: null,
  featured_discount_pct: null,
  addons: [],
  promotions: [],
  rules: [],
};

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

const RUN_ROW: RunRow = {
  id: RUN,
  kind: 'price_promo',
  variant: null,
  title_en: 'Cup sizes',
  title_ar: null,
  status: 'active',
  started_by: 'c0000000-0000-4000-8000-0000000000c1',
  started_by_name: 'Marketing',
  started_at: '2026-09-25T08:00:00Z',
  finished_at: null,
  scheduled_for: null,
  live_at: null,
  menu_item_id: ITEM,
  promotion_id: null,
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
  waiting_on_me: false,
};

function stepRow(over: Partial<StepRow>): StepRow {
  return {
    id: NUMBERS,
    position: 2,
    step_key: 'numbers',
    name_en: 'Numbers',
    name_ar: 'Numbers',
    status: 'open',
    round: 1,
    actor_roles: ['manager'],
    assigned_to: null,
    assigned_to_name: null,
    needs_owner_ok: false,
    optional: false,
    after_keys: [],
    opened_at: '2026-09-25T09:00:00Z',
    passed_at: null,
    skip_note: null,
    skipped_by_name: null,
    skipped_at: null,
    items: [],
    submissions: [],
    ...over,
  };
}

const PROPOSE_ROW = stepRow({
  id: PROPOSE,
  position: 1,
  step_key: 'propose',
  name_en: 'Propose',
  name_ar: 'Propose',
  status: 'passed',
  actor_roles: ['marketing'],
  submissions: [
    {
      id: 'd0000000-0000-4000-8000-00000000d0c1',
      round: 1,
      submitted_by: 'c0000000-0000-4000-8000-0000000000c1',
      submitted_by_name: 'Marketing',
      submitted_at: '2026-09-25T08:00:00Z',
      record: {
        change: 'price',
        menu_item_id: ITEM,
        prices: [],
        renames: [
          {
            variant_id: SMALL,
            name_en: 'Large',
            name_ar: 'كبير',
            before_en: 'Small',
            before_ar: 'صغير',
          },
        ],
        reason: 'r',
        expected_effect: 'e',
      },
      photos: [],
      withdrawn_at: null,
      superseded_at: null,
      decision: 'approve',
      decided_by: null,
      decided_by_name: null,
      decided_at: null,
      decision_note: null,
      send_back_to: null,
    },
  ],
});
const NUMBERS_ROW = stepRow({});

const NUMBERS_DATA: PriceNumbers & { renames: unknown[] } = {
  change: 'price',
  sizes: [],
  addons: [],
  promotion: null,
  rate: null,
  featured: null,
  renames: [
    {
      target: 'size',
      id: SMALL,
      from_en: 'Small',
      from_ar: 'صغير',
      to_en: 'Large',
      to_ar: 'كبير',
      price_iqd: 4000,
    },
  ],
};

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('renames through a price change in %s', (locale) => {
  const t = makeT(locale);

  it('folds New names on marketing’s price start, then shows a box per size with today’s name in it', () => {
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'marketing' },
      params: { kind: 'price_promo', change: 'price', itemId: ITEM },
      queryData: [[staffKeys.priceTargets(V, 'price'), TARGETS]],
    });
    try {
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      const open = screen.getByTestId('staff-start.field.renames.open');
      expect(within(open).getByText(`+ ${t('staff.protocols.field.renames')}`)).toBeTruthy();
      expect(screen.queryByTestId('staff-start.field.renames.0.name_en')).toBeNull();
      fireEvent.press(open);
      const en = screen.getByTestId('staff-start.field.renames.0.name_en');
      const ar = screen.getByTestId('staff-start.field.renames.0.name_ar');
      expect(en.props.placeholder).toBe('Small');
      expect(ar.props.placeholder).toBe('صغير');
      expect(screen.getByTestId('staff-start.field.renames.1.name_en').props.placeholder).toBe(
        'Large',
      );
      expect(screen.getByText(t('staff.protocols.start.renamesHint'))).toBeTruthy();
      expect(screen.getAllByText(t('staff.protocols.field.renamesNameEn')).length).toBe(2);
    } finally {
      screen.unmount();
    }
  });

  it('shows the owner each rename on the numbers step, at its price, in both languages', () => {
    const screen = renderRoute(StaffStep, {
      locale,
      staff: { role: 'owner' },
      params: { id: NUMBERS },
      queryData: [
        [
          staffKeys.step(NUMBERS),
          { run: { ...RUN_ROW, data: null }, step: NUMBERS_ROW, can: NO_CAN, def: null },
        ],
        [
          staffKeys.run(RUN),
          {
            run: { ...RUN_ROW, template_name_en: 'Price', template_name_ar: 'سعر', data: null },
            steps: [PROPOSE_ROW, NUMBERS_ROW],
            can: NO_CAN,
          },
        ],
        [staffKeys.context('numbers', RUN), NUMBERS_DATA],
      ],
    });
    try {
      const box = within(screen.getByTestId('staff-step.renames'));
      const [from, to] = locale === 'ar' ? ['صغير', 'كبير'] : ['Small', 'Large'];
      const [otherFrom, otherTo] = locale === 'ar' ? ['Small', 'Large'] : ['صغير', 'كبير'];
      expect(
        box.getByText(
          t('staff.protocols.context.renameLine', {
            from: isolate(from),
            price: formatIQD(4000, locale),
            to: isolate(to),
          }),
        ),
      ).toBeTruthy();
      expect(
        box.getByText(
          t('staff.protocols.renamedFrom', { from: isolate(otherFrom), to: isolate(otherTo) }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('staff.protocols.context.renamesTitle'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});
