import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_ROLES,
  MAX_LINES,
  cardRows,
  dayLines,
  daySummary,
  draftChanged,
  draftIsValid,
  draftProblems,
  findTemplate,
  moveLine,
  photoLineCount,
  readBoard,
  readDayState,
  savePayloadItems,
  sortTemplates,
  type ChecklistDraft,
} from './checklistLogic';

const list = (role: string, slot: string, done: number, total: number) => ({
  role,
  slot,
  name_en: `${role} ${slot}`,
  name_ar: 'قائمة',
  done,
  total,
  open_items: [{ text_en: 'Wipe the bar', text_ar: 'امسح البار' }],
});

describe('readDayState', () => {
  it('reads the RPC payload as it comes', () => {
    const s = readDayState({ business_date: '2026-09-25', lists: [list('barista', 'open', 2, 5)] });
    expect(s.business_date).toBe('2026-09-25');
    expect(s.lists).toEqual([
      { role: 'barista', slot: 'open', name_en: 'barista open', name_ar: 'قائمة', done: 2, total: 5, open_items: [{ text_en: 'Wipe the bar', text_ar: 'امسح البار' }] },
    ]);
  });

  it('reads anything else as nothing to show, never a crash', () => {
    for (const bad of [null, undefined, 'x', [], { lists: 'no' }, { lists: [null, { role: 'barista', slot: 'lunch' }] }]) {
      expect(readDayState(bad).lists).toEqual([]);
    }
  });
});

describe('daySummary and cardRows', () => {
  const state = readDayState({
    lists: [list('barista', 'open', 5, 5), list('barista', 'close', 1, 4), list('driver', 'open', 0, 3), list('chef', 'open', 3, 3)],
  });

  it('counts finished lists out of the lists due today', () => {
    expect(daySummary(state)).toEqual({ finished: 2, total: 4 });
  });

  it('puts the least done first, then the finished ones in the server order', () => {
    expect(cardRows(state).map((l) => `${l.role}.${l.slot}`)).toEqual(['driver.open', 'barista.close', 'barista.open', 'chef.open']);
  });
});

describe('readBoard', () => {
  it('reads a template with no run today as not opened, and sorts its lines', () => {
    const b = readBoard({
      business_date: '2026-09-25',
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
            { position: 1, text_en: 'A', text_ar: 'أ' },
          ],
          today: null,
        },
        {
          template_id: 't2',
          role: 'barista',
          slot: 'open',
          name_en: 'Open',
          name_ar: 'فتح',
          version: 1,
          items: [],
          today: { run_id: 'r', done: 1, total: 1, items: [{ text_en: 'A', text_ar: 'أ', done_by_name: 'Yusuf', done_at: '2026-09-25T06:00:00Z', note: null }] },
        },
      ],
    });
    expect(b.templates[0]!.items.map((i) => i.text_en)).toEqual(['A', 'B']);
    expect(b.templates[0]!.today).toBeNull();
    expect(b.templates[1]!.today?.items[0]?.done_by_name).toBe('Yusuf');
    expect(findTemplate(b, 'barista', 'open')?.template_id).toBe('t2');
    expect(findTemplate(b, 'driver', 'open')).toBeNull();
    expect(sortTemplates(b.templates).map((t) => t.slot)).toEqual(['open', 'close']);
  });

  it('reads which lines need a photo, and the photo sent with a tick', () => {
    const b = readBoard({
      templates: [
        {
          template_id: 't1',
          role: 'barista',
          slot: 'close',
          name_en: 'Close',
          name_ar: 'إغلاق',
          version: 2,
          items: [
            { position: 1, text_en: 'Wipe the bar', text_ar: 'امسح البار', photo_required: true },
            { position: 2, text_en: 'Lock up', text_ar: 'اقفل' },
          ],
          today: {
            run_id: 'r',
            done: 1,
            total: 2,
            items: [
              { text_en: 'Wipe the bar', text_ar: 'امسح البار', done_by_name: 'Yusuf', done_at: '2026-09-25T20:00:00Z', note: null, photo_required: true, photo_path: 'v/checklists/s/a.jpg' },
              { text_en: 'Lock up', text_ar: 'اقفل', done_by_name: null, done_at: null, note: null, photo_required: 'yes', photo_path: ' ' },
            ],
          },
        },
      ],
    });
    const t = b.templates[0]!;
    expect(t.items.map((i) => i.photo_required)).toEqual([true, false]);
    // Only a real true counts, and a blank path is no photo.
    expect(t.today!.items.map((i) => [i.photo_required, i.photo_path])).toEqual([
      [true, 'v/checklists/s/a.jpg'],
      [false, null],
    ]);
    expect(dayLines(t)).toBe(t.today!.items);
  });

  it('shows a list nobody opened today as its template lines, the photo flag kept', () => {
    const [t] = readBoard({
      templates: [{ template_id: 't', role: 'driver', slot: 'open', name_en: 'O', name_ar: 'ف', version: 1, items: [{ position: 1, text_en: 'Van', text_ar: 'سيارة', photo_required: true }], today: null }],
    }).templates;
    expect(dayLines(t!)).toEqual([{ text_en: 'Van', text_ar: 'سيارة', done_by_name: null, done_at: null, note: null, photo_required: true, photo_path: null }]);
  });

  it('drops a malformed template rather than failing the sheet', () => {
    expect(readBoard({ templates: [{ role: 'barista', slot: 'open' }, 7] }).templates).toEqual([]);
    expect(readBoard(null).templates).toEqual([]);
  });
});

describe('the roles a list can be written for', () => {
  it('never offers prep, which the server refuses, nor the owner', () => {
    expect(CHECKLIST_ROLES).not.toContain('prep');
    expect(CHECKLIST_ROLES).not.toContain('owner');
    expect(CHECKLIST_ROLES).toContain('driver');
  });
});

describe('the owner draft', () => {
  const line = (key: string, en: string, ar: string, photo_required = false) => ({ key, text_en: en, text_ar: ar, photo_required });
  const draft = (over: Partial<ChecklistDraft> = {}): ChecklistDraft => ({
    name_en: 'Barista: Opening',
    name_ar: 'باريستا: الافتتاح',
    lines: [line('a', 'Turn on the machine', 'شغّل الماكينة'), line('b', '', '')],
    ...over,
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

  it('sees a change only in what the save would send', () => {
    const saved = draft();
    expect(draftChanged(draft({ lines: [...saved.lines, line('c', '', '')] }), saved)).toBe(false);
    expect(draftChanged(draft({ name_en: 'Barista: Opening ' }), saved)).toBe(false);
    expect(draftChanged(draft({ lines: [line('a', 'Turn on the grinder', 'شغّل المطحنة')] }), saved)).toBe(true);
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
