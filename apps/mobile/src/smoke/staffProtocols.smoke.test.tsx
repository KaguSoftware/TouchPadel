/**
 * The protocol pages of the staff phone (build-contracts-2026-09-23 §6.1-§6.3):
 * start, runs, a run, a step, ideas and the notes on new items, each rendered
 * as a staff session in EN and AR. See `src/smoke/auth.smoke.test.tsx` for
 * what a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * Every read a screen makes on its first render is seeded under its
 * `staffKeys` key, so no case reaches the (stubbed) client: a screen renders
 * its loaded state, and its primary action is on screen.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent } from '@testing-library/react-native';
import { formatIQD, formatPercent, makeT, type Locale } from '@touch/i18n';
import type { Can, RunRow, StepRow } from '@touch/core';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { headerAdd } from '../test/headerAdd';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import { availabilityKeys } from '../features/availability/keys';
import { addDays, listBookableDates } from '../features/availability/assemble';
import { venueSettingsFixture } from '../test/fixtures';
import { WorkList } from '../features/staff/protocols/WorkList';
import { updateHiringDraft } from '../features/staff/protocols/hiringDraft';
import StaffStart from '../../app/(staff)/staff-start';
import StaffRuns from '../../app/(staff)/staff-runs';
import StaffRun from '../../app/(staff)/staff-run';
import StaffStep from '../../app/(staff)/staff-step';
import StaffIdeas from '../../app/(staff)/staff-ideas';
import StaffNotes from '../../app/(staff)/staff-notes';

const V = TEST_VENUE_ID;
const RUN = 'a0000000-0000-4000-8000-0000000000a1';
const STEP = 'b0000000-0000-4000-8000-0000000000b1';
const SUB = 'd0000000-0000-4000-8000-0000000000d1';
const ITEM = 'e0000000-0000-4000-8000-0000000000e1';
const IDEA = 'f0000000-0000-4000-8000-0000000000f1';
const RELEASE = 'a0000000-0000-4000-8000-0000000000a2';
const HIRE = 'a0000000-0000-4000-8000-0000000000a3';
const POSITION = 'b0000000-0000-4000-8000-0000000000b2';
const ADD_STAFF = 'b0000000-0000-4000-8000-0000000000b3';
const NEW_HIRE = 'c0000000-0000-4000-8000-0000000000c2';

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

// Step names are the same in both languages so one label param serves EN and AR.
const RUN_ROW: RunRow = {
  id: RUN,
  kind: 'tournament',
  variant: 'type2',
  title_en: 'Friday social',
  title_ar: null,
  status: 'active',
  started_by: 'c0000000-0000-4000-8000-0000000000c1',
  started_by_name: 'Hussein',
  started_at: '2026-09-25T08:00:00Z',
  finished_at: null,
  scheduled_for: null,
  live_at: null,
  menu_item_id: null,
  promotion_id: null,
  current_steps: [{ id: STEP, position: 2, step_key: null, name_en: 'Check', name_ar: 'Check', status: 'open', round: 1 }],
  waiting_on_me: true,
};

const STEP_ROW: StepRow = {
  id: STEP,
  position: 2,
  step_key: null,
  name_en: 'Check',
  name_ar: 'Check',
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
};

const RUN_DETAIL = {
  run: { ...RUN_ROW, template_name_en: 'Tournament', template_name_ar: 'بطولة', data: null },
  steps: [STEP_ROW],
  can: NO_CAN,
};

const STEP_DETAIL = {
  run: { ...RUN_ROW, data: null },
  step: STEP_ROW,
  can: { ...NO_CAN, submit: true },
  def: null,
};

const future = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();

runSmokeCases('staff protocols', [
  {
    route: 'staff-start',
    Component: StaffStart,
    labelKey: 'staff.protocols.start.submit',
    options: {
      staff: { role: 'head_chef' },
      params: { kind: 'product_release' },
      queryData: [[staffKeys.ingredients(V), { ingredients: [] }]],
    },
  },
  {
    route: 'staff-runs',
    Component: StaffRuns,
    labelKey: 'staff.protocols.runs.filter.waiting',
    options: {
      staff: { role: 'barista' },
      queryData: [[staffKeys.runs(V, 'waiting'), { runs: [RUN_ROW], total: 1 }]],
    },
  },
  {
    route: 'staff-run',
    Component: StaffRun,
    labelKey: 'staff.protocols.run.openStep',
    labelParams: { name: 'Check' },
    options: {
      staff: { role: 'court_desk' },
      params: { id: RUN },
      queryData: [[staffKeys.run(RUN), RUN_DETAIL]],
    },
  },
  {
    route: 'staff-step',
    Component: StaffStep,
    labelKey: 'staff.protocols.step.submit',
    options: {
      staff: { role: 'manager' },
      params: { id: STEP },
      queryData: [
        [staffKeys.step(STEP), STEP_DETAIL],
        [staffKeys.run(RUN), RUN_DETAIL],
      ],
    },
  },
  {
    route: 'staff-ideas',
    Component: StaffIdeas,
    labelKey: 'staff.protocols.ideas.submit',
    options: {
      staff: { role: 'barista' },
      queryData: [
        [staffKeys.ideas(V), []],
        [staffKeys.ingredients(V), { ingredients: [] }],
      ],
    },
  },
  {
    route: 'staff-notes',
    Component: StaffNotes,
    labelKey: 'staff.notes.add',
    options: {
      staff: { role: 'cashier' },
      params: { itemId: ITEM },
      queryData: [
        [
          staffKeys.notes(V),
          [
            {
              menu_item_id: ITEM,
              name_en: 'Pistachio latte',
              name_ar: 'لاتيه الفستق',
              launched_at: '2026-09-20T08:00:00Z',
              window_ends_at: future,
              run_id: RUN,
              notes: 0,
              my_notes: 0,
            },
          ],
        ],
        [
          staffKeys.itemNotes(ITEM),
          {
            item: { id: ITEM, name_en: 'Pistachio latte', name_ar: 'لاتيه الفستق', window_ends_at: future, open: true },
            notes: [],
          },
        ],
      ],
    },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('the protocol pages’ other states in %s', (locale) => {
  const t = makeT(locale);

  // Sait, 2026-10-17: the person's own part of a run comes first, with its
  // button; the run's current step stays below for the rest.
  it('puts the person’s own step at the top of the run, opening that step', () => {
    const screen = renderRoute(StaffRun, {
      locale,
      staff: { role: 'court_desk' },
      params: { id: RUN },
      queryData: [
        [staffKeys.run(RUN), RUN_DETAIL],
        [
          staffKeys.work(V),
          {
            todo: [
              {
                run_step_id: STEP,
                run_id: RUN,
                kind: 'price_change',
                variant: null,
                title_en: null,
                title_ar: null,
                step_key: null,
                name_en: 'Check',
                name_ar: 'Check',
                opened_at: null,
                round: 1,
              },
            ],
            waiting: [],
            decided: [],
            to_decide: [],
            counts: { todo: 1, waiting: 0, to_decide: 0 },
          },
        ],
      ],
    });
    try {
      expect(screen.getByText(t('staff.protocols.run.yourTodo', { name: 'Check' }))).toBeTruthy();
      // The same step is not offered twice.
      expect(screen.queryByTestId('staff-run.current-step')).toBeNull();
      fireEvent.press(screen.getByTestId('staff-run.my-step'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-step', params: { id: STEP } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('gives a decider the three answers, and no form', () => {
    const screen = renderRoute(StaffStep, {
      locale,
      staff: { role: 'owner' },
      params: { id: STEP },
      queryData: [
        [
          staffKeys.step(STEP),
          {
            ...STEP_DETAIL,
            step: {
              ...STEP_ROW,
              status: 'submitted',
              submissions: [
                {
                  id: SUB,
                  round: 1,
                  submitted_by: 'c0000000-0000-4000-8000-0000000000c1',
                  submitted_by_name: 'Maha',
                  submitted_at: '2026-09-25T10:00:00Z',
                  record: { note: 'All set' },
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
            },
            can: { ...NO_CAN, decide_submission_id: SUB, send_back_targets: [STEP] },
          },
        ],
        [staffKeys.run(RUN), RUN_DETAIL],
      ],
    });
    try {
      expect(screen.getByTestId('staff-step.decide.approve')).toBeTruthy();
      expect(screen.getByTestId('staff-step.decide.send-back')).toBeTruthy();
      expect(screen.getByTestId('staff-step.decide.stop')).toBeTruthy();
      expect(screen.getByText(t('staff.protocols.step.decide.title'))).toBeTruthy();
      expect(screen.queryByTestId('staff-step.submit')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows a head their team’s ideas with Start and Decline, and no idea form', () => {
    const screen = renderRoute(StaffIdeas, {
      locale,
      staff: { role: 'head_barista' },
      queryData: [
        [
          staffKeys.ideasToReview(V),
          {
            ideas: [
              {
                id: IDEA,
                team: 'bar',
                author_name: 'Yusuf',
                submitted_at: '2026-09-25T09:00:00Z',
                record: { name_en: 'Rose latte', item_kind: 'drink', lines: [], sizes: [{ name_en: 'Regular' }] },
                photos: [],
              },
            ],
            count: 1,
          },
        ],
        [staffKeys.ingredients(V), { ingredients: [] }],
      ],
    });
    try {
      expect(screen.getByTestId(`staff-ideas.start.${IDEA}`)).toBeTruthy();
      expect(screen.getByTestId(`staff-ideas.decline.${IDEA}`)).toBeTruthy();
      expect(screen.getByText(t('staff.protocols.ideas.toReview'))).toBeTruthy();
      expect(screen.queryByTestId('staff-ideas.submit')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows management the day-30 review with its shares as percentages', () => {
    const run = {
      ...RUN_ROW,
      id: RELEASE,
      kind: 'product_release' as const,
      variant: null,
      title_en: 'Pistachio latte',
      status: 'live' as const,
      menu_item_id: ITEM,
      live_at: '2026-08-20T08:00:00Z',
      current_steps: [],
      waiting_on_me: false,
    };
    const screen = renderRoute(StaffRun, {
      locale,
      staff: { role: 'manager' },
      params: { id: RELEASE },
      queryData: [
        [staffKeys.run(RELEASE), { run: { ...run, template_name_en: 'New item', template_name_ar: 'صنف جديد', data: null }, steps: [], can: NO_CAN }],
        [
          staffKeys.review(RELEASE),
          {
            status: 'written',
            numbers: { units: 120, revenue_iqd: 600000, margin_iqd: 255000, margin_pct: 42.5, category_share_pct: 12.3, days_sold: 28, bought_with: [] },
            write_up: { en: 'Sold steadily.', ar: 'بيع بثبات.' },
            model: null,
            written_at: '2026-09-19T08:00:00Z',
          },
        ],
        [staffKeys.context('marketing_notes', RELEASE), []],
      ],
    });
    try {
      const pct = (v: number) => t('staff.protocols.run.review.percent', { pct: formatPercent(v, locale) });
      expect(pct(12.3)).toContain('%');
      // Each figure is a label at the start and the server's number at the end.
      expect(screen.getByText(t('staff.protocols.run.review.margin'))).toBeTruthy();
      expect(screen.getByText(`${formatIQD(255000, locale)} (${pct(42.5)})`)).toBeTruthy();
      expect(screen.getByText(t('staff.protocols.run.review.categoryShare'))).toBeTruthy();
      expect(screen.getByText(pct(12.3))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lets the owner send an account already made for the hire, and never asks to make it twice', () => {
    const hireRun = {
      ...RUN_ROW,
      id: HIRE,
      kind: 'hiring' as const,
      variant: null,
      title_en: 'A second barista',
      current_steps: [{ id: ADD_STAFF, position: 4, step_key: 'add_staff', name_en: 'Add', name_ar: 'Add', status: 'open' as const, round: 1 }],
    };
    const position: StepRow = {
      ...STEP_ROW,
      id: POSITION,
      position: 1,
      step_key: 'open_position',
      status: 'passed',
      submissions: [
        {
          id: SUB,
          round: 1,
          submitted_by: 'c0000000-0000-4000-8000-0000000000c1',
          submitted_by_name: 'Hussein',
          submitted_at: '2026-09-25T08:00:00Z',
          record: { role: 'barista', why: 'Weekends', hours: 'Fri and Sat' },
          photos: [],
          withdrawn_at: null,
          superseded_at: null,
          decision: 'approve',
          decided_by: null,
          decided_by_name: 'Owner',
          decided_at: '2026-09-25T09:00:00Z',
          decision_note: null,
          send_back_to: null,
        },
      ],
    };
    const addStaff: StepRow = { ...STEP_ROW, id: ADD_STAFF, position: 4, step_key: 'add_staff', name_en: 'Add', name_ar: 'Add', actor_roles: ['owner'] };
    const screen = renderRoute(StaffStep, {
      locale,
      staff: { role: 'owner' },
      params: { id: ADD_STAFF },
      queryData: [
        [staffKeys.step(ADD_STAFF), { run: { ...hireRun, data: null }, step: addStaff, can: { ...NO_CAN, submit: true }, def: null }],
        [staffKeys.run(HIRE), { run: { ...hireRun, template_name_en: 'Hiring', template_name_ar: 'توظيف', data: null }, steps: [position, addStaff], can: NO_CAN }],
        [staffKeys.newHires(HIRE), [{ id: NEW_HIRE, display_name: 'Yusuf', created_at: '2026-09-25T10:00:00Z' }]],
      ],
    });
    try {
      expect(screen.getByTestId('staff-step.submit').props.accessibilityState.disabled).toBe(true);
      fireEvent.press(screen.getByTestId(`staff-step.hire.${NEW_HIRE}`));
      expect(screen.getByText(t('staff.protocols.addStaff.chosen', { name: 'Yusuf' }))).toBeTruthy();
      // The account is taken as it is: no second create form.
      expect(screen.queryByTestId('staff-step.create')).toBeNull();
      expect(screen.getByTestId('staff-step.submit').props.accessibilityState.disabled).toBe(false);
    } finally {
      screen.unmount();
    }
  });

  it('offers a role that may start nothing no start page', () => {
    const screen = renderRoute(StaffRuns, {
      locale,
      staff: { role: 'driver' },
      queryData: [[staffKeys.runs(V, 'waiting'), { runs: [], total: 0 }]],
    });
    try {
      expect(headerAdd(screen)).toBeNull();
      expect(screen.getByText(t('staff.protocols.runs.empty.waiting'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives a role that may start something a + that opens the start page', () => {
    const screen = renderRoute(StaffRuns, {
      locale,
      staff: { role: 'marketing' },
      queryData: [[staffKeys.runs(V, 'waiting'), { runs: [], total: 0 }]],
    });
    try {
      const add = headerAdd(screen);
      expect(add?.label).toBe(t('staff.protocols.runs.start'));
      add?.onPress();
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-start' });
    } finally {
      screen.unmount();
    }
  });

  it('lists Today’s work, each row opening its step', () => {
    function Today() {
      return <WorkList venueId={V} />;
    }
    const screen = renderRoute(Today, {
      locale,
      staff: { role: 'head_chef' },
      queryData: [
        [
          staffKeys.work(V),
          {
            todo: [
              {
                run_step_id: STEP,
                run_id: RUN,
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
          },
        ],
      ],
    });
    try {
      expect(screen.getByTestId(`staff.todo.${STEP}`)).toBeTruthy();
      expect(screen.getByText(`${t('staff.protocols.work.todo')} · 1`)).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  // The tournament start, a page a plan section (owner, 2026-10-16).
  const COURT_A = 'c1000000-0000-4000-8000-0000000000c1';
  const COURT_B = 'c1000000-0000-4000-8000-0000000000c2';
  const settings = venueSettingsFixture();
  const firstDay = listBookableDates(new Date(), 'Asia/Baghdad', 60, settings)[0]!;
  const laterDay = addDays(firstDay, 2);
  const planSeeds: [readonly unknown[], unknown][] = [
    [availabilityKeys.settings(V), settings],
    [
      staffKeys.courts(V),
      [
        { id: COURT_A, name_en: 'Court 1', name_ar: 'ملعب 1' },
        { id: COURT_B, name_en: 'Court 2', name_ar: 'ملعب 2' },
      ],
    ],
    [staffKeys.courtBookings(V, firstDay), []],
    [
      staffKeys.courtBookings(V, laterDay),
      // 18:00–19:00 Baghdad on court 1 is booked.
      [{ court_id: COURT_A, start_at: `${laterDay}T15:00:00Z`, end_at: `${laterDay}T16:00:00Z`, kind: 'booking' }],
    ],
  ];

  it('opens a tournament type on the plan’s first step, the type’s pill on its card', () => {
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'manager' },
      params: { kind: 'tournament' },
    });
    try {
      expect(screen.getAllByText(t('ws.tournaments.start.typeTag.type3')).length).toBeGreaterThan(0);
      fireEvent.press(screen.getByTestId('staff-start.field.variant.type3'));
      const push = routerState.calls.find((c) => c.method === 'push');
      expect(push?.arg).toMatchObject({
        pathname: '/staff-start',
        params: { kind: 'tournament', variant: 'type3', step: 'name', depth: '1' },
      });
    } finally {
      screen.unmount();
    }
  });

  it('holds the name step until it is filled, then opens courts & time', () => {
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'court_desk' },
      params: { kind: 'tournament', variant: 'type1', plan: `name-${locale}`, step: 'name', depth: '1' },
      queryData: planSeeds,
    });
    try {
      expect(screen.getByText(t('staff.protocols.start.tournament.stepOf', { n: '1', total: '4' }))).toBeTruthy();
      const next = screen.getByTestId('staff-start.plan.next');
      fireEvent.press(next);
      expect(routerState.calls.some((c) => c.method === 'push')).toBe(false);
      expect(screen.getAllByText(t('staff.protocols.form.required')).length).toBeGreaterThan(0);

      fireEvent.changeText(screen.getByTestId('staff-start.plan.name_en'), 'Friday Cup');
      fireEvent.changeText(screen.getByTestId('staff-start.plan.name_ar'), 'كأس الجمعة');
      fireEvent.press(screen.getByTestId('staff-start.plan.class.B'));
      fireEvent.press(screen.getByTestId('staff-start.plan.years.one_to_three'));
      fireEvent.press(screen.getByTestId('staff-start.plan.format.americano'));
      fireEvent.press(screen.getByTestId('staff-start.plan.next'));
      const push = routerState.calls.find((c) => c.method === 'push');
      expect(push?.arg).toMatchObject({
        params: { kind: 'tournament', variant: 'type1', plan: `name-${locale}`, step: 'courts', depth: '2' },
      });
    } finally {
      screen.unmount();
    }
  });

  it('picks court hours on the courts step, and will not pick a booked one', () => {
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'manager' },
      params: { kind: 'tournament', variant: 'type2', plan: `courts-${locale}`, step: 'courts', depth: '2' },
      queryData: planSeeds,
    });
    try {
      fireEvent.press(screen.getByTestId(`staff-start.plan.day.${laterDay}`));
      expect(screen.getByText(t('ws.tournaments.start.courts.none'))).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-start.plan.cell.${COURT_A}-${18 * 60}`));
      expect(screen.getByText(t('ws.tournaments.start.courts.none'))).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-start.plan.cell.${COURT_B}-${18 * 60}`));
      fireEvent.press(screen.getByTestId(`staff-start.plan.cell.${COURT_B}-${19 * 60}`));
      expect(screen.queryByText(t('ws.tournaments.start.courts.none'))).toBeNull();
      const slot = screen.getByTestId(`staff-start.plan.slot.${laterDay}-${18 * 60}-${20 * 60}`);
      expect(slot).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-start.plan.slot.${laterDay}-${18 * 60}-${20 * 60}.remove`));
      expect(screen.getByText(t('ws.tournaments.start.courts.none'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('ends a plan on its last step with the start', () => {
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'manager' },
      params: { kind: 'tournament', variant: 'type3', plan: `last-${locale}`, step: 'sponsor', depth: '5' },
      queryData: planSeeds,
    });
    try {
      expect(screen.getByText(t('staff.protocols.start.tournament.stepOf', { n: '5', total: '5' }))).toBeTruthy();
      expect(screen.queryByTestId('staff-start.plan.next')).toBeNull();
      expect(screen.getByTestId('staff-start.submit')).toBeTruthy();
      // An empty plan goes back to its first step, the name.
      fireEvent.press(screen.getByTestId('staff-start.submit'));
      expect(routerState.calls).toContainEqual({ method: 'dismiss', arg: 4 });
    } finally {
      screen.unmount();
    }
  });

  // The hiring start, a page a step (Sait, 2026-10-17).
  it('opens a hire on its role page, and holds it there until a role is picked', () => {
    const kinds = renderRoute(StaffStart, { locale, staff: { role: 'manager' }, params: {} });
    try {
      fireEvent.press(kinds.getByTestId('staff-start.kind.hiring'));
      const push = routerState.calls.find((c) => c.method === 'push');
      expect(push?.arg).toMatchObject({ pathname: '/staff-start', params: { kind: 'hiring', step: 'role', depth: '1' } });
    } finally {
      kinds.unmount();
    }
    routerState.calls.length = 0;
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'manager' },
      params: { kind: 'hiring', plan: `role-${locale}`, step: 'role', depth: '1' },
    });
    try {
      expect(screen.getByText(t('staff.protocols.start.hiring.questions.role'))).toBeTruthy();
      expect(screen.getByText(t('staff.protocols.start.flow.stepOf', { n: '1', total: '4' }))).toBeTruthy();
      const next = screen.getByTestId('staff-start.hiring.next');
      fireEvent.press(next);
      expect(routerState.calls.some((c) => c.method === 'push')).toBe(false);
      expect(screen.getByText(t('staff.protocols.form.required'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-start.hiring.role.barista'));
      fireEvent.press(screen.getByTestId('staff-start.hiring.next'));
      const push = routerState.calls.find((c) => c.method === 'push');
      expect(push?.arg).toMatchObject({ params: { kind: 'hiring', plan: `role-${locale}`, step: 'job', depth: '2' } });
    } finally {
      screen.unmount();
    }
  });

  it('names the run from the role on the Check page, and opens a step again from Change', () => {
    const plan = `check-${locale}`;
    updateHiringDraft(plan, {
      answers: { role: 'barista', why: 'Evenings are one short', hours: '4 pm to midnight', startDate: '2026-11-01' },
    });
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'manager' },
      params: { kind: 'hiring', plan, step: 'check', depth: '4' },
    });
    try {
      expect(screen.getByTestId('staff-start.hiring.title-en').props.value).toBe('Hiring: Barista');
      expect(screen.getByTestId('staff-start.hiring.title-ar').props.value).toBe('توظيف: باريستا');
      expect(screen.getByTestId('staff-start.submit')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-start.hiring.change.hours'));
      const push = routerState.calls.find((c) => c.method === 'push');
      expect(push?.arg).toMatchObject({ params: { kind: 'hiring', plan, step: 'job', ret: 'check', depth: '5' } });
    } finally {
      screen.unmount();
    }
  });

  it('goes back to Check from a step opened by Change', () => {
    const plan = `back-${locale}`;
    updateHiringDraft(plan, {
      answers: { role: 'driver', why: 'Two runs a day', hours: 'Mornings', startDate: '2026-11-01' },
    });
    const screen = renderRoute(StaffStart, {
      locale,
      staff: { role: 'manager' },
      params: { kind: 'hiring', plan, step: 'job', ret: 'check', depth: '5' },
    });
    try {
      const button = screen.getByTestId('staff-start.hiring.next');
      expect(screen.getByText(t('staff.protocols.start.flow.backTo', { step: t('staff.protocols.start.hiring.steps.check') }))).toBeTruthy();
      fireEvent.press(button);
      // useBack: the page under it on a phone; the mock router has none, so Today.
      expect(routerState.calls).toContainEqual({ method: 'replace', arg: '/staff' });
      expect(routerState.calls.some((c) => c.method === 'push')).toBe(false);
    } finally {
      screen.unmount();
    }
  });
});
