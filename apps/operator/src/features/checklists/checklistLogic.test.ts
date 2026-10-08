import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import {
  CHECKLIST_ROLES,
  LAST_DAY,
  MAX_LINES,
  MAX_PEOPLE,
  WEEKDAYS,
  awayIds,
  blankDraft,
  cardRows,
  clockText,
  dayListKey,
  daySummary,
  draftChanged,
  draftFromTemplate,
  draftIsValid,
  draftProblems,
  draftSchedule,
  draftSummary,
  dueLabel,
  dueRule,
  findTemplate,
  moveLine,
  photoLineCount,
  planSummary,
  presetOf,
  readBoard,
  readDayState,
  readStaffOptions,
  repeatSummary,
  savePayloadItems,
  sortTemplates,
  specFromDraft,
  templateLines,
  toggleWeekday,
  whoSummary,
  withPreset,
  type ChecklistDraft,
} from './checklistLogic';

const en = makeT('en');
const ar = makeT('ar');

const list = (role: string | null, slot: string, done: number, total: number, extra: Record<string, unknown> = {}) => ({
  role,
  slot,
  name_en: `${role} ${slot}`,
  name_ar: 'قائمة',
  done,
  total,
  open_items: [{ text_en: 'Wipe the bar', text_ar: 'امسح البار' }],
  ...extra,
});

describe('readDayState', () => {
  it('reads the 0188 payload as it comes, with the 0323 fields empty', () => {
    const s = readDayState({ business_date: '2026-09-25', lists: [list('barista', 'open', 2, 5)] });
    expect(s.business_date).toBe('2026-09-25');
    expect(s.lists).toEqual([
      {
        role: 'barista',
        slot: 'open',
        name_en: 'barista open',
        name_ar: 'قائمة',
        done: 2,
        total: 5,
        open_items: [{ text_en: 'Wipe the bar', text_ar: 'امسح البار' }],
        template_id: null,
        assignee_name: null,
        due_at: null,
        overdue: false,
        period_start: null,
        period_end: null,
        assignee_id: null,
        run_id: null,
      },
    ]);
    expect(dayListKey(s.lists[0]!)).toBe('barista:open');
  });

  it('reads a person’s copy of a people list (no role) with its due time and overdue flag', () => {
    const s = readDayState({
      lists: [
        list(null, 'open', 0, 3, {
          template_id: 't9',
          assignee_name: 'Bareq',
          due_at: '2026-10-11T06:00:00Z',
          overdue: true,
          period_start: '2026-10-11',
          period_end: '2026-10-17',
        }),
      ],
    });
    expect(s.lists[0]).toMatchObject({ role: null, template_id: 't9', assignee_name: 'Bareq', overdue: true, period_end: '2026-10-17' });
    expect(dayListKey(s.lists[0]!)).toBe('t9:Bareq');
  });

  it('keys two people of one name on one list apart, by their copy (the 0323 review)', () => {
    const ali = (run: string, who: string) =>
      list('barista', 'open', 0, 2, { template_id: 't5', assignee_name: 'Ali', assignee_id: who, run_id: run });
    const s = readDayState({ lists: [ali('r1', 'p1'), ali('r2', 'p2'), list('barista', 'open', 0, 2, { template_id: 't6' })] });
    expect(s.lists.map((l) => [l.assignee_id, l.run_id])).toEqual([['p1', 'r1'], ['p2', 'r2'], [null, null]]);
    const keys = s.lists.map(dayListKey);
    expect(keys).toEqual(['t5:r1', 't5:r2', 't6:']);
    expect(new Set(keys).size).toBe(3);
    // No run yet, but a person's id: still apart from a namesake.
    expect(dayListKey({ template_id: 't5', assignee_name: 'Ali', assignee_id: 'p9', role: 'barista', slot: 'open' })).toBe('t5:p9');
  });

  it('reads anything else as nothing to show, never a crash', () => {
    for (const bad of [null, undefined, 'x', [], { lists: 'no' }, { lists: [null, { role: 'barista', slot: 'lunch' }, { role: null, slot: 'open' }] }]) {
      expect(readDayState(bad).lists).toEqual([]);
    }
  });
});

describe('daySummary and cardRows', () => {
  const state = readDayState({
    lists: [
      list('barista', 'open', 5, 5),
      list('barista', 'close', 1, 4),
      list('driver', 'open', 0, 3),
      list('chef', 'open', 3, 3),
      list('cashier', 'open', 3, 4, { template_id: 'c', overdue: true }),
      // A finished copy is never overdue, whatever the flag says.
      list('waiter', 'open', 2, 2, { template_id: 'w', overdue: true }),
    ],
  });

  it('counts finished copies out of the copies current today', () => {
    expect(daySummary(state)).toEqual({ finished: 3, total: 6 });
  });

  it('puts overdue first, then the least done, then the finished ones in the server order', () => {
    expect(cardRows(state).map((l) => `${l.role}.${l.slot}`)).toEqual(['cashier.open', 'driver.open', 'barista.close', 'barista.open', 'chef.open', 'waiter.open']);
  });
});

const boardPayload = {
  business_date: '2026-10-11',
  templates: [
    {
      template_id: 't1',
      role: 'barista',
      slot: 'close',
      name_en: 'Close',
      name_ar: 'إغلاق',
      version: 3,
      items: [
        { position: 2, text_en: 'B', text_ar: 'ب' },
        { position: 1, text_en: 'A', text_ar: 'أ', photo_required: true },
      ],
      today: null,
    },
    {
      template_id: 't2',
      role: null,
      slot: 'open',
      name_en: 'Deep clean',
      name_ar: 'تنظيف عميق',
      version: 1,
      items: [{ position: 1, text_en: 'Fridge', text_ar: 'الثلاجة' }],
      audience: 'people',
      copy_mode: 'each',
      repeat_kind: 'monthdays',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      month_days: [15, 1],
      due_time: '09:30',
      assignees: [
        { id: 's1', display_name: 'Bareq', role: 'barista' },
        { id: 's2', display_name: 'Maha', role: 'cashier' },
      ],
      runs: [
        {
          run_id: 'r1',
          assignee_id: 's1',
          assignee_name: 'Bareq',
          period_start: '2026-10-01',
          period_end: '2026-10-14',
          due_at: '2026-10-01T06:30:00Z',
          overdue: true,
          done: 0,
          total: 1,
          items: [{ id: 'i', position: 1, text_en: 'Fridge', text_ar: 'الثلاجة', done_by_name: null, done_at: null, note: null, photo_required: false, photo_path: ' ' }],
        },
      ],
      today: { run_id: 'r1' },
    },
  ],
};

describe('readBoard', () => {
  const b = readBoard(boardPayload);

  it('reads a 0184 template as a shared role list, every day, and its lines in order', () => {
    const t = findTemplate(b, 't1')!;
    expect(t.items.map((i) => i.text_en)).toEqual(['A', 'B']);
    expect(t).toMatchObject({ audience: 'role', copy_mode: 'shared', repeat_kind: 'weekdays', weekdays: WEEKDAYS, month_days: [], due_time: null, assignees: [], runs: [] });
    expect(templateLines(t)[0]).toEqual({ text_en: 'A', text_ar: 'أ', done_by_name: null, done_at: null, note: null, photo_required: true, photo_path: null });
  });

  it('reads a people list with its schedule, its people and each person’s copy', () => {
    const t = findTemplate(b, 't2')!;
    expect(t).toMatchObject({ role: null, audience: 'people', copy_mode: 'each', repeat_kind: 'monthdays', month_days: [1, 15], due_time: '09:30' });
    expect(t.assignees.map((p) => p.display_name)).toEqual(['Bareq', 'Maha']);
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ run_id: 'r1', assignee_name: 'Bareq', overdue: true, done: 0, total: 1, period_end: '2026-10-14' });
    // A blank photo path is no photo.
    expect(t.runs[0]!.items[0]!.photo_path).toBeNull();
  });

  it('reads a 0184 board’s `today` as the one shared copy', () => {
    const [t] = readBoard({
      templates: [
        {
          template_id: 't',
          role: 'driver',
          slot: 'open',
          name_en: 'O',
          name_ar: 'ف',
          version: 1,
          items: [{ position: 1, text_en: 'Van', text_ar: 'سيارة' }],
          today: { run_id: 'r', done: 1, total: 1, items: [{ text_en: 'Van', text_ar: 'سيارة', done_by_name: 'Yusuf', done_at: '2026-09-25T06:00:00Z', note: null }] },
        },
      ],
    }).templates;
    expect(t!.runs).toEqual([
      {
        run_id: 'r',
        assignee_id: null,
        assignee_name: null,
        period_start: null,
        period_end: null,
        due_at: null,
        overdue: false,
        done: 1,
        total: 1,
        items: [{ text_en: 'Van', text_ar: 'سيارة', done_by_name: 'Yusuf', done_at: '2026-09-25T06:00:00Z', note: null, photo_required: false, photo_path: null }],
      },
    ]);
  });

  it('drops a malformed template rather than failing the sheet', () => {
    expect(readBoard({ templates: [{ role: 'barista', slot: 'open' }, { template_id: 'x', role: null, slot: 'open' }, 7] }).templates).toEqual([]);
    expect(readBoard(null).templates).toEqual([]);
  });

  it('sorts role lists by role and slot, people lists last', () => {
    expect(sortTemplates(b.templates).map((t) => t.template_id)).toEqual(['t1', 't2']);
    expect(sortTemplates([...b.templates].reverse()).map((t) => t.template_id)).toEqual(['t1', 't2']);
  });

  it('reads the staff options', () => {
    expect(readStaffOptions([{ id: 'a', display_name: 'Ali', role: 'owner' }, { display_name: 'no id' }, null])).toEqual([{ id: 'a', display_name: 'Ali', role: 'owner' }]);
    expect(readStaffOptions(null)).toEqual([]);
  });
});

describe('the roles a list can be written for', () => {
  it('never offers prep, which the server refuses; the owner and the manager can have a list', () => {
    expect(CHECKLIST_ROLES).not.toContain('prep');
    expect(CHECKLIST_ROLES).toContain('owner');
    expect(CHECKLIST_ROLES).toContain('manager');
    expect(CHECKLIST_ROLES.at(-1)).toBe('owner');
  });
});

describe('plain-language labels', () => {
  it('says how a list repeats, in both languages', () => {
    const w = (weekdays: number[]) => ({ repeat_kind: 'weekdays' as const, weekdays, month_days: [] });
    const m = (month_days: number[]) => ({ repeat_kind: 'monthdays' as const, weekdays: [], month_days });
    expect(repeatSummary(w([...WEEKDAYS]), en, 'en')).toBe('Every day');
    expect(repeatSummary(w([0]), en, 'en')).toBe('Every Sunday');
    expect(repeatSummary(w([3, 0, 5]), en, 'en')).toBe('Every Sunday, Wednesday and Friday');
    expect(repeatSummary(m([1]), en, 'en')).toBe('Every month on the 1st');
    expect(repeatSummary(m([15, 2]), en, 'en')).toBe('Every month on the 2nd and the 15th');
    expect(repeatSummary(m([22, 31]), en, 'en')).toBe('Every month on the 22nd and the last day');
    expect(repeatSummary(m([11, 12, 13, 23]), en, 'en')).toBe('Every month on the 11th, the 12th, the 13th and the 23rd');
    expect(repeatSummary(w([0]), ar, 'ar')).toBe('كل أسبوع يوم الأحد');
    expect(repeatSummary(w([0, 3]), ar, 'ar')).toBe('كل أسبوع أيام الأحد والأربعاء');
    expect(repeatSummary(m([1, 15]), ar, 'ar')).toBe('كل شهر في يوم 1 ويوم 15');
    expect(repeatSummary(m([LAST_DAY]), ar, 'ar')).toBe('كل شهر في آخر يوم');
  });

  it('says when a list is due, and who it is for', () => {
    expect(dueRule({ slot: 'open', due_time: null }, en, 'en')).toBe('before opening');
    expect(dueRule({ slot: 'close', due_time: null }, en, 'en')).toBe('before closing');
    expect(dueRule({ slot: 'close', due_time: '14:30' }, en, 'en')).toBe(`by ${clockText('14:30', 'en')}`);
    expect(clockText('14:30', 'en')).toMatch(/^2:30\sPM$/);
    expect(whoSummary({ audience: 'role', role: 'barista', copy_mode: 'shared' }, [], en, 'en')).toBe('Barista: one shared list');
    expect(whoSummary({ audience: 'role', role: 'barista', copy_mode: 'each' }, [], en, 'en')).toBe('Barista: everyone their own copy');
    expect(whoSummary({ audience: 'people', role: null, copy_mode: 'each' }, ['Bareq', 'Maha', 'Ali', 'Hasan', 'Tiba'], en, 'en')).toBe('Bareq, Maha, Ali +2');
    expect(whoSummary({ audience: 'people', role: null, copy_mode: 'each' }, [], en, 'en')).toBe('Nobody chosen');
  });

  it('puts the plan in one line', () => {
    const t = findTemplate(readBoard(boardPayload), 't2')!;
    expect(planSummary({ ...t, repeat_kind: 'weekdays', weekdays: [0], due_time: null }, ['Bareq', 'Maha'], en, 'en')).toBe('Every Sunday, before opening · Bareq, Maha');
    expect(planSummary({ ...t, repeat_kind: 'weekdays', weekdays: [0], due_time: null }, ['Bareq', 'Maha'], ar, 'ar')).toBe('كل أسبوع يوم الأحد، قبل الافتتاح · Bareq، Maha');
  });

  it('labels a copy’s due time by the day it falls on', () => {
    const now = new Date('2026-10-11T08:00:00Z'); // Sunday 11:00 in Baghdad
    expect(dueLabel(null, now, en, 'en')).toBeNull();
    expect(dueLabel('nonsense', now, en, 'en')).toBeNull();
    expect(dueLabel('2026-10-11T15:00:00Z', now, en, 'en')).toMatch(/^Due 6:00\sPM$/);
    expect(dueLabel('2026-10-12T06:00:00Z', now, en, 'en')).toMatch(/^Due Mon, 9:00\sAM$/);
    expect(dueLabel('2026-09-01T06:00:00Z', now, en, 'en')).toMatch(/^Due Sep 1, 2026, 9:00\sAM$/);
  });
});

describe('the owner draft', () => {
  const line = (key: string, en: string, ar: string, photo_required = false) => ({ key, text_en: en, text_ar: ar, photo_required });
  let n = 0;
  const key = () => `k${n++}`;
  const draft = (over: Partial<ChecklistDraft> = {}): ChecklistDraft => ({
    ...blankDraft(key),
    name_en: 'Barista: Opening',
    name_ar: 'باريستا: الافتتاح',
    role: 'barista',
    lines: [line('a', 'Turn on the machine', 'شغّل الماكينة'), line('b', '', '')],
    ...over,
  });

  it('starts a new list as a shared role list, every day, before opening, with no role chosen', () => {
    const d = blankDraft(key);
    expect(d).toMatchObject({ audience: 'role', role: '', copy_mode: 'shared', repeat: 'daily', due: 'open' });
    expect(draftProblems(d).who).toBe('role');
  });

  it('drops a line left blank in both languages and trims the rest', () => {
    expect(savePayloadItems(draft({ lines: [line('a', '  Wipe ', ' امسح '), line('b', '', ' ', true)] }))).toEqual([{ text_en: 'Wipe', text_ar: 'امسح', photo_required: false }]);
    expect(draftIsValid(draft())).toBe(true);
  });

  it('refuses a line or a name in one language only, and a text past its limit', () => {
    const p = draftProblems(draft({ name_ar: ' ', lines: [line('a', 'Wipe', ''), line('b', 'x'.repeat(201), 'y')] }));
    expect(p.name).toBe('both');
    expect(p.lines.get('a')).toBe('both');
    expect(p.lines.get('b')).toBe('tooLong');
    expect(draftIsValid(draft({ name_en: 'x'.repeat(121) }))).toBe(false);
  });

  it(`refuses more than ${MAX_LINES} lines, blank ones not counted`, () => {
    const many = Array.from({ length: MAX_LINES }, (_, i) => line(String(i), `L${i}`, `س${i}`));
    expect(draftProblems(draft({ lines: [...many, line('blank', '', '')] })).tooMany).toBe(false);
    expect(draftProblems(draft({ lines: [...many, line('extra', 'One more', 'واحد آخر')] })).tooMany).toBe(true);
  });

  it('asks for a person on a people list, a weekday on a weekly one, two dates on a twice-monthly one, and a time for a set time', () => {
    expect(draftProblems(draft({ audience: 'people', staff_ids: [] })).who).toBe('people');
    expect(draftProblems(draft({ audience: 'people', staff_ids: Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => `s${i}`) })).who).toBe('tooManyPeople');
    expect(draftProblems(draft({ audience: 'people', staff_ids: ['s1'] })).who).toBeNull();
    expect(draftProblems(draft({ repeat: 'weekdays', weekdays: [] })).repeat).toBe('weekdays');
    expect(draftProblems(draft({ repeat: 'twiceMonthly', month_days: [5, 5] })).repeat).toBe('sameDate');
    expect(draftProblems(draft({ repeat: 'monthly', month_days: [5, 5] })).repeat).toBeNull();
    expect(draftProblems(draft({ due: 'time', due_time: '' })).due).toBe('time');
    expect(draftProblems(draft({ due: 'time', due_time: '07:45' })).due).toBeNull();
    expect(draftIsValid(draft({ due: 'time', due_time: '25:00' }))).toBe(false);
  });

  it('stops a save that names someone no longer at the branch, and says who (the 0323 review)', () => {
    const people = [
      { id: 's1', display_name: 'Bareq', role: 'barista' as const },
      { id: 's2', display_name: 'Maha', role: 'cashier' as const, away: true },
    ];
    const away = awayIds(people);
    expect([...away]).toEqual(['s2']);
    expect(draftProblems(draft({ audience: 'people', staff_ids: ['s1', 's2'] }), away).who).toBe('away');
    expect(draftIsValid(draft({ audience: 'people', staff_ids: ['s1', 's2'] }), away)).toBe(false);
    expect(draftProblems(draft({ audience: 'people', staff_ids: ['s1'] }), away).who).toBeNull();
    // A role list ignores people left over from the people tab.
    expect(draftProblems(draft({ audience: 'role', staff_ids: ['s2'] }), away).who).toBeNull();
    // Without the set (an older caller), nothing changes.
    expect(draftProblems(draft({ audience: 'people', staff_ids: ['s2'] })).who).toBeNull();
  });

  it('builds save_checklist’s spec with only the fields the list uses', () => {
    expect(specFromDraft(draft({ copy_mode: 'each', repeat: 'weekdays', weekdays: [5, 0], due: 'close', staff_ids: ['ignored'] }))).toEqual({
      name_en: 'Barista: Opening',
      name_ar: 'باريستا: الافتتاح',
      audience: 'role',
      role: 'barista',
      copy_mode: 'each',
      repeat_kind: 'weekdays',
      weekdays: [0, 5],
      slot: 'close',
      items: [{ text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', photo_required: false }],
    });
    expect(specFromDraft(draft({ audience: 'people', staff_ids: ['s1', 's2', 's1'], copy_mode: 'shared', repeat: 'twiceMonthly', month_days: [1, 31], due: 'time', due_time: '09:30' }))).toEqual({
      name_en: 'Barista: Opening',
      name_ar: 'باريستا: الافتتاح',
      audience: 'people',
      copy_mode: 'each',
      staff_ids: ['s1', 's2'],
      repeat_kind: 'monthdays',
      month_days: [1, 31],
      slot: 'time',
      due_time: '09:30',
      items: [{ text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', photo_required: false }],
    });
    expect(specFromDraft(draft()).weekdays).toEqual(WEEKDAYS);
  });

  it('moves between repeat presets without losing what was chosen', () => {
    const d0 = draft();
    const weekly = withPreset(d0, 'weekdays');
    // From every day, the weekdays start empty: the owner picks them.
    expect(weekly.weekdays).toEqual([]);
    const picked = { ...weekly, weekdays: toggleWeekday(toggleWeekday(weekly.weekdays, 3), 0) };
    expect(picked.weekdays).toEqual([0, 3]);
    expect(toggleWeekday(picked.weekdays, 3)).toEqual([0]);
    const twice = withPreset(picked, 'twiceMonthly');
    expect(twice.month_days).toEqual([1, 15]);
    expect(draftSchedule(withPreset(twice, 'monthly'))).toEqual({ repeat_kind: 'monthdays', weekdays: [], month_days: [1] });
    expect(withPreset(withPreset(twice, 'monthly'), 'weekdays').weekdays).toEqual([0, 3]);
    expect(draftSchedule(withPreset(twice, 'daily')).weekdays).toEqual(WEEKDAYS);
  });

  it('opens a saved list as a draft with its preset, people and due time', () => {
    const t = findTemplate(readBoard(boardPayload), 't2')!;
    const d = draftFromTemplate(t, key);
    expect(d).toMatchObject({ audience: 'people', role: '', staff_ids: ['s1', 's2'], repeat: 'twiceMonthly', month_days: [1, 15], due: 'time', due_time: '09:30' });
    expect(d.lines.map((l) => l.text_en)).toEqual(['Fridge']);
    expect(presetOf({ repeat_kind: 'weekdays', weekdays: [1, 2], month_days: [] })).toBe('weekdays');
    expect(presetOf({ repeat_kind: 'monthdays', weekdays: [], month_days: [9] })).toBe('monthly');
    expect(draftChanged(d, d)).toBe(false);
    expect(draftChanged({ ...d, staff_ids: ['s2', 's1'] }, d)).toBe(false);
    expect(draftChanged({ ...d, staff_ids: ['s1'] }, d)).toBe(true);
    expect(draftChanged({ ...d, due_time: '10:00' }, d)).toBe(true);
    expect(draftSummary(d, [{ id: 's1', display_name: 'Bareq', role: 'barista' }], en, 'en')).toBe(`Every month on the 1st and the 15th, by ${clockText('09:30', 'en')} · Bareq`);
  });

  it('sees a change only in what the save would send', () => {
    const saved = draft();
    expect(draftChanged(draft({ lines: [...saved.lines, line('c', '', '')] }), saved)).toBe(false);
    expect(draftChanged(draft({ name_en: 'Barista: Opening ' }), saved)).toBe(false);
    // A role list's people and a daily list's dates are not sent, so not a change.
    expect(draftChanged(draft({ staff_ids: ['x'], month_days: [9] }), saved)).toBe(false);
    expect(draftChanged(draft({ lines: [line('a', 'Turn on the grinder', 'شغّل المطحنة')] }), saved)).toBe(true);
    expect(draftChanged(draft({ copy_mode: 'each' }), saved)).toBe(true);
  });

  it('sends "Needs a photo" with each line, and counts a switch as a change', () => {
    const saved = draft();
    const withPhoto = draft({ lines: [line('a', 'Turn on the machine', 'شغّل الماكينة', true), line('b', '', '', true)] });
    expect(savePayloadItems(withPhoto)).toEqual([{ text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', photo_required: true }]);
    expect(draftChanged(withPhoto, saved)).toBe(true);
    // The blank line's switch is dropped with the line.
    expect(photoLineCount(withPhoto)).toBe(1);
    expect(photoLineCount(saved)).toBe(0);
  });

  it('moves a line up and down and ignores a move off either end', () => {
    expect(moveLine(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
    expect(moveLine(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b']);
    expect(moveLine(['a', 'b'], 0, 'up')).toEqual(['a', 'b']);
  });
});
