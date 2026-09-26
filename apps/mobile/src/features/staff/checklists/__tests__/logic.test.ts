import { describe, expect, it } from 'vitest';
import {
  applyMark,
  checklistTodos,
  localName,
  localText,
  markArgs,
  orderLists,
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
      { runId: 'a', slot: 'open', name_en: 'Opening', name_ar: 'الافتتاح', done: 1, total: 2 },
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
