import { describe, expect, it } from 'vitest';
import { formatTime } from '@touch/i18n';
import {
  applyMark,
  checklistTodos,
  dueText,
  isClosedError,
  isOverdue,
  localName,
  localText,
  markArgs,
  orderLists,
  repeatText,
  showsSlotLabel,
  sortForToday,
  tickBlock,
  type ChecklistItem,
  type ChecklistList,
  type ChecklistsToday,
} from '../logic';

const item = (over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: 'i1',
  position: 1,
  text_en: 'Wipe the counter',
  text_ar: 'امسح الطاولة',
  done_by_name: null,
  done_at: null,
  note: null,
  photo_required: false,
  photo_path: null,
  ...over,
});

const list = (over: Partial<ChecklistList> = {}): ChecklistList => ({
  run_id: 'r1',
  role: 'barista',
  slot: 'open',
  name_en: 'Opening',
  name_ar: 'الافتتاح',
  done: 0,
  total: 2,
  items: [item(), item({ id: 'i2', position: 2 })],
  ...over,
});

describe('the photo rule (#69)', () => {
  it('blocks a bare tick of a line that needs a photo, and nothing else', () => {
    expect(tickBlock({ photo_required: true, photo_path: null }, null)).toBe('needs-photo');
    expect(tickBlock({ photo_required: true, photo_path: null }, 'v/checklists/a.jpg')).toBeNull();
    expect(tickBlock({ photo_required: true, photo_path: 'v/checklists/old.jpg' }, null)).toBeNull();
    expect(tickBlock({ photo_required: false, photo_path: null }, null)).toBeNull();
  });

  it('never builds a tick without the photo, and sends the photo it has', () => {
    const needs = item({ photo_required: true });
    expect(markArgs(needs, true)).toBeNull();
    expect(markArgs(needs, true, '')).toBeNull();
    expect(markArgs(needs, true, 'v/checklists/a.jpg')).toEqual({
      p_item_id: 'i1',
      p_done: true,
      p_photo_path: 'v/checklists/a.jpg',
    });
  });

  it('ticks a line that already carries its photo without sending it again', () => {
    expect(markArgs(item({ photo_required: true, photo_path: 'v/checklists/old.jpg' }), true)).toEqual({
      p_item_id: 'i1',
      p_done: true,
    });
  });

  it('unticks with no photo, whatever the line needs', () => {
    expect(markArgs(item({ photo_required: true, photo_path: 'p' }), false, 'q')).toEqual({
      p_item_id: 'i1',
      p_done: false,
    });
    expect(markArgs(item(), true)).toEqual({ p_item_id: 'i1', p_done: true });
  });
});

describe('applyMark', () => {
  it('replaces the line and recounts only its own list', () => {
    const data: ChecklistsToday = {
      business_date: '2026-09-25',
      lists: [list(), list({ run_id: 'r2', slot: 'close', items: [item({ id: 'c1' })], total: 1 })],
    };
    const next = applyMark(data, item({ done_at: '2026-09-25T06:00:00Z', done_by_name: 'Yusuf' }));
    expect(next.lists[0]!.done).toBe(1);
    expect(next.lists[0]!.items[0]!.done_by_name).toBe('Yusuf');
    expect(next.lists[1]).toBe(data.lists[1]);
    // An untick brings the count back down.
    expect(applyMark(next, item()).lists[0]!.done).toBe(0);
  });
});

describe('ordering and Today', () => {
  it('shows the named list first and keeps the rest in the server’s order', () => {
    const lists = [list({ run_id: 'a' }), list({ run_id: 'b' }), list({ run_id: 'c' })];
    expect(orderLists(lists, 'b').map((l) => l.run_id)).toEqual(['b', 'a', 'c']);
    expect(orderLists(lists, 'zzz').map((l) => l.run_id)).toEqual(['a', 'b', 'c']);
    expect(orderLists(lists, undefined).map((l) => l.run_id)).toEqual(['a', 'b', 'c']);
  });

  it('puts only the unfinished lists on Today’s To do', () => {
    const data: ChecklistsToday = {
      business_date: '2026-09-25',
      lists: [
        list({ run_id: 'a', done: 1, total: 2 }),
        list({ run_id: 'b', done: 2, total: 2 }),
        list({ run_id: 'c', done: 0, total: 0, items: [] }),
      ],
    };
    expect(checklistTodos(data)).toEqual([
      {
        runId: 'a',
        slot: 'open',
        name_en: 'Opening',
        name_ar: 'الافتتاح',
        done: 1,
        total: 2,
        due_at: null,
        period_start: null,
        overdue: false,
      },
    ]);
    expect(checklistTodos(undefined)).toEqual([]);
  });
});

describe('bilingual rows', () => {
  it('reads the reader’s language and falls back to the other', () => {
    expect(localName({ name_en: 'Opening', name_ar: 'الافتتاح' }, 'ar')).toBe('الافتتاح');
    expect(localName({ name_en: 'Opening', name_ar: ' ' }, 'ar')).toBe('Opening');
    expect(localText({ text_en: '', text_ar: 'امسح' }, 'en')).toBe('امسح');
  });
});

// 0323: scheduled lists (scheduled-checklists-2026-10-08.md §5).
const NOW = new Date('2026-10-08T09:30:00Z'); // 12:30 in Baghdad, a Thursday
const DUE_PAST = '2026-10-08T06:00:00Z'; // 9:00 AM Baghdad
const DUE_LATER = '2026-10-08T11:00:00Z'; // 2:00 PM Baghdad

describe('overdue and Today’s order', () => {
  it('is overdue only while unfinished and past due, or when the server says so', () => {
    expect(isOverdue(list({ due_at: DUE_PAST }), NOW)).toBe(true);
    expect(isOverdue(list({ due_at: DUE_LATER }), NOW)).toBe(false);
    expect(isOverdue(list({ due_at: DUE_LATER, overdue: true }), NOW)).toBe(true);
    // A finished list is never overdue, whatever the payload said before the tick.
    expect(isOverdue(list({ due_at: DUE_PAST, overdue: true, done: 2, total: 2 }), NOW)).toBe(false);
    // An old payload, or a list with no due time.
    expect(isOverdue(list(), NOW)).toBe(false);
    expect(isOverdue(list({ due_at: null }), NOW)).toBe(false);
  });

  it('puts overdue first, then by due time with no due time last, then the finished', () => {
    const lists = [
      list({ run_id: 'done', done: 2, total: 2, due_at: DUE_PAST }),
      list({ run_id: 'none' }),
      list({ run_id: 'later', due_at: DUE_LATER }),
      list({ run_id: 'late', due_at: DUE_PAST }),
      list({ run_id: 'none2' }),
      list({ run_id: 'flagged', due_at: DUE_LATER, overdue: true }),
    ];
    expect(sortForToday(lists, NOW).map((l) => l.run_id)).toEqual([
      'late',
      'flagged',
      'later',
      'none',
      'none2',
      'done',
    ]);
  });

  it('gives Today the overdue person list first, with its due fields', () => {
    const data: ChecklistsToday = {
      business_date: '2026-10-08',
      lists: [
        list({ run_id: 'shared', due_at: DUE_LATER, period_start: '2026-10-08' }),
        list({
          run_id: 'mine',
          role: null,
          audience: 'people',
          copy_mode: 'each',
          assignee_id: 'me',
          due_at: DUE_PAST,
          period_start: '2026-10-08',
          overdue: true,
        }),
      ],
    };
    const todos = checklistTodos(data, NOW);
    expect(todos.map((x) => x.runId)).toEqual(['mine', 'shared']);
    expect(todos[0]).toMatchObject({ due_at: DUE_PAST, period_start: '2026-10-08', overdue: true });
    expect(todos[1]!.overdue).toBe(false);
  });
});

describe('dueText', () => {
  const nine = (locale: 'en' | 'ar') => formatTime(new Date(DUE_PAST), locale);
  const two = (locale: 'en' | 'ar') => formatTime(new Date(DUE_LATER), locale);

  it('says when it is due, or since when it is late, on today’s list', () => {
    const today = { period_start: '2026-10-08' };
    expect(dueText(list({ ...today, due_at: DUE_LATER }), NOW, 'en', '2026-10-08')).toBe(`Due ${two('en')}`);
    expect(dueText(list({ ...today, due_at: DUE_PAST }), NOW, 'en', '2026-10-08')).toBe(
      `Overdue since ${nine('en')}`,
    );
    expect(dueText(list({ ...today, due_at: DUE_LATER }), NOW, 'ar', '2026-10-08')).toBe(`موعدها ${two('ar')}`);
    expect(dueText(list({ ...today, due_at: DUE_PAST }), NOW, 'ar', '2026-10-08')).toBe(
      `متأخرة منذ ${nine('ar')}`,
    );
  });

  it('names the day the list started when that was not today', () => {
    // A Sunday-only list, still open on Thursday.
    const weekly = list({ period_start: '2026-10-04', due_at: '2026-10-04T06:00:00Z' });
    expect(dueText(weekly, NOW, 'en', '2026-10-08')).toBe('Overdue since Sunday');
    expect(dueText(weekly, NOW, 'ar', '2026-10-08')).toBe('متأخرة منذ الأحد');
    // Without the business date the time is shown.
    expect(dueText(weekly, NOW, 'en')).toBe(`Overdue since ${nine('en')}`);
    // Flagged by the server but not yet late by the phone's clock: still named by its day.
    expect(
      dueText(list({ period_start: '2026-10-07', due_at: DUE_LATER, overdue: false }), NOW, 'en', '2026-10-08'),
    ).toBe('Due Wednesday');
  });

  it('says nothing for a finished list, an old payload, or a list with no due time', () => {
    expect(dueText(list({ due_at: DUE_PAST, done: 2, total: 2 }), NOW, 'en', '2026-10-08')).toBeNull();
    expect(dueText(list(), NOW, 'en', '2026-10-08')).toBeNull();
    expect(dueText(list({ due_at: null }), NOW, 'en')).toBeNull();
    expect(dueText(list({ due_at: 'not a time' }), NOW, 'en')).toBeNull();
  });
});

describe('repeatText', () => {
  it('reads the weekday rules', () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: all }, 'en')).toBe('Every day');
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: all }, 'ar')).toBe('كل يوم');
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: [0] }, 'en')).toBe('Every Sunday');
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: [0] }, 'ar')).toBe('كل يوم الأحد');
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: [4, 0] }, 'en')).toBe('Every Sunday and Thursday');
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: [4, 0, 2] }, 'en')).toBe(
      'Every Sunday, Tuesday and Thursday',
    );
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: [4, 0, 2] }, 'ar')).toBe(
      'أيام الأحد والثلاثاء والخميس',
    );
  });

  it('reads the dates of the month, 31 as its last day', () => {
    expect(repeatText({ repeat_kind: 'monthdays', month_days: [15, 1] }, 'en')).toBe(
      'On the 1st and the 15th of each month',
    );
    expect(repeatText({ repeat_kind: 'monthdays', month_days: [15, 1] }, 'ar')).toBe('يوم 1 ويوم 15 من كل شهر');
    expect(repeatText({ repeat_kind: 'monthdays', month_days: [31] }, 'en')).toBe('On the last day of each month');
    expect(repeatText({ repeat_kind: 'monthdays', month_days: [31] }, 'ar')).toBe('آخر يوم من كل شهر');
    expect(repeatText({ repeat_kind: 'monthdays', month_days: [2, 3, 11, 22] }, 'en')).toBe(
      'On the 2nd, the 3rd, the 11th and the 22nd of each month',
    );
  });

  it('says nothing for an old payload or an empty rule', () => {
    expect(repeatText({}, 'en')).toBeNull();
    expect(repeatText({ repeat_kind: 'weekdays', weekdays: [] }, 'en')).toBeNull();
    expect(repeatText({ repeat_kind: 'monthdays', month_days: null }, 'en')).toBeNull();
  });
});

describe('the slot label (0323 review)', () => {
  it('labels an opening or closing list, and not one due by a typed time', () => {
    expect(showsSlotLabel({})).toBe(true);
    expect(showsSlotLabel({ due_time: null })).toBe(true);
    expect(showsSlotLabel({ due_time: '13:30' })).toBe(false);
    expect(showsSlotLabel({ due_time: '' })).toBe(true);
  });
});

describe('CHECKLIST_CLOSED', () => {
  it('recognises the refusal of a tick on an ended list, and nothing else', () => {
    expect(isClosedError({ code: 'P0001', message: 'CHECKLIST_CLOSED' })).toBe(true);
    expect(isClosedError({ code: 'P0001', message: 'CHECKLIST_NOT_FOUND' })).toBe(false);
    expect(isClosedError(new Error('network down'))).toBe(false);
  });
});
