import { describe, it, expect } from 'vitest';
import { formatDate, makeT } from '@touch/i18n';
import {
  EMPTY_DRAFT,
  countByLifecycle,
  describePromotion,
  filterPromotions,
  fromRow,
  hasScope,
  hoursText,
  howText,
  isDirty,
  isPromotionFilter,
  isoToDateInput,
  lifecycle,
  minEndOn,
  minStartOn,
  saveBlocker,
  scheduleText,
  scopeText,
  sortPromotions,
  statusText,
  timeToInput,
  toRpcArgs,
  toggleId,
  toggleWeekday,
  validateDraft,
  weekdaysText,
} from './promotionLogic';
import type { PromotionRow } from './promotionsApi';

const row: PromotionRow = {
  id: 'p1',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  type: 'percent',
  value: 20,
  starts_at: '2026-09-01T00:00:00+03:00',
  ends_at: '2026-09-30T23:59:59+03:00',
  weekdays: [4, 1, 2],
  hour_from: '16:00:00',
  hour_to: '19:00:00',
  scope: { categoryIds: ['c1'] },
  limits: { total: 100 },
  auto: true,
  public_code: null,
  code_single_use: false,
  enabled: true,
};

describe('fromRow / toRpcArgs', () => {
  it('maps a row into an editable draft with the contract defaults filled', () => {
    const d = fromRow(row);
    expect(d.name).toEqual({ en: 'Happy hour', ar: 'ساعة السعادة' });
    expect(d.weekdays).toEqual([1, 2, 4]);
    expect(d.hourFrom).toBe('16:00');
    expect(d.hourTo).toBe('19:00');
    expect(d.scope).toEqual({ courtIds: [], categoryIds: ['c1'], itemIds: [] });
    expect(d.limits).toEqual({ total: 100, perCustomer: null, minSpendIqd: null });
  });

  it('sends p_ + the 0067 column names', () => {
    const args = toRpcArgs(fromRow(row), 'p1');
    expect(Object.keys(args).sort()).toEqual(
      [
        'p_auto', 'p_code_single_use', 'p_enabled', 'p_ends_at', 'p_hour_from', 'p_hour_to', 'p_id', 'p_limits',
        'p_name_ar', 'p_name_en', 'p_public_code', 'p_scope', 'p_starts_at', 'p_type', 'p_value', 'p_weekdays',
      ].sort(),
    );
    expect(args.p_id).toBe('p1');
    expect(args.p_weekdays).toEqual([1, 2, 4]);
    expect(args.p_scope).toEqual({ courtIds: [], categoryIds: ['c1'], itemIds: [] });
  });

  it('sends null for blank dates and hours, and null id for a new promotion', () => {
    const args = toRpcArgs(EMPTY_DRAFT, null);
    expect(args.p_id).toBeNull();
    expect(args.p_starts_at).toBeNull();
    expect(args.p_ends_at).toBeNull();
    expect(args.p_hour_from).toBeNull();
    expect(args.p_hour_to).toBeNull();
  });

  it('makes an end date inclusive of its whole day', () => {
    const args = toRpcArgs({ ...EMPTY_DRAFT, endsOn: '2026-09-12' }, null);
    const ends = new Date(args.p_ends_at as string);
    expect(ends.getDate()).toBe(12);
    expect(ends.getHours()).toBe(23);
  });
});

describe('date and time inputs', () => {
  it('formats to the input value types and treats null as blank', () => {
    expect(isoToDateInput(null)).toBe('');
    expect(isoToDateInput('garbage')).toBe('');
    expect(isoToDateInput(new Date(2026, 8, 3, 12).toISOString())).toBe('2026-09-03');
    expect(timeToInput('16:00:00')).toBe('16:00');
    expect(timeToInput(null)).toBe('');
  });
});

describe('validateDraft', () => {
  const ok = fromRow(row);
  it('accepts a complete draft', () => {
    expect(validateDraft(ok, ok.startsOn, ok.endsOn)).toEqual([]);
  });
  it('requires both names', () => {
    expect(validateDraft({ ...ok, name: { en: 'x', ar: '' } }, ok.startsOn, ok.endsOn)).toContain('name');
  });
  it('requires a positive value and a sane percent', () => {
    expect(validateDraft({ ...ok, value: 0 }, ok.startsOn, ok.endsOn)).toContain('value');
    expect(validateDraft({ ...ok, type: 'percent', value: 150 }, ok.startsOn, ok.endsOn)).toContain('percent');
    expect(validateDraft({ ...ok, type: 'amount', value: 150 }, ok.startsOn, ok.endsOn)).toEqual([]);
  });
  it('refuses an end date before the start date', () => {
    // Dates ahead of the fixture's "now", so only the ordering is under test:
    // a past start or end is its own error now.
    const now = new Date('2026-09-23T12:00:00');
    expect(validateDraft({ ...ok, startsOn: '2026-10-10', endsOn: '2026-10-01' }, ok.startsOn, ok.endsOn, now)).toContain('dates');
    expect(validateDraft({ ...ok, startsOn: '2026-10-10', endsOn: '2026-10-10' }, ok.startsOn, ok.endsOn, now)).toEqual([]);
  });
  it('matches upsert_promotion on hours: both or neither, never equal, overnight allowed', () => {
    expect(validateDraft({ ...ok, hourFrom: '16:00', hourTo: '' }, ok.startsOn, ok.endsOn)).toContain('hours');
    expect(validateDraft({ ...ok, hourFrom: '', hourTo: '19:00' }, ok.startsOn, ok.endsOn)).toContain('hours');
    expect(validateDraft({ ...ok, hourFrom: '16:00', hourTo: '16:00' }, ok.startsOn, ok.endsOn)).toContain('hours');
    expect(validateDraft({ ...ok, hourFrom: '22:00', hourTo: '02:00' }, ok.startsOn, ok.endsOn)).toEqual([]);
    expect(validateDraft({ ...ok, hourFrom: '', hourTo: '' }, ok.startsOn, ok.endsOn)).toEqual([]);
  });
  it('refuses a start before today, and offers today as the floor', () => {
    const now = new Date('2026-09-23T12:00:00');
    expect(validateDraft({ ...ok, startsOn: '2026-09-22' }, '', '', now)).toContain('startsPast');
    expect(validateDraft({ ...ok, startsOn: '2026-09-23' }, '', '', now)).not.toContain('startsPast');
    expect(validateDraft({ ...ok, startsOn: '2026-09-24' }, '', '', now)).not.toContain('startsPast');
    expect(validateDraft({ ...ok, startsOn: '' }, '', '', now)).not.toContain('startsPast');
    expect(minStartOn('', now)).toBe('2026-09-23');
  });
  it('lets a promotion that already began keep its own start', () => {
    const now = new Date('2026-09-23T12:00:00');
    // Editing a promotion that started in June: its start is history, so it
    // stays allowed — but it still cannot be pushed further back.
    expect(validateDraft({ ...ok, startsOn: '2026-06-01' }, '2026-06-01', '', now)).not.toContain('startsPast');
    expect(validateDraft({ ...ok, startsOn: '2026-05-31' }, '2026-06-01', '', now)).toContain('startsPast');
    expect(minStartOn('2026-06-01', now)).toBe('2026-06-01');
  });
  it('refuses an end before today, and floors the picker at the start when later', () => {
    const now = new Date('2026-09-23T12:00:00');
    const base = { ...ok, startsOn: '' };
    expect(validateDraft({ ...base, endsOn: '2026-09-22' }, '', '', now)).toContain('endsPast');
    expect(validateDraft({ ...base, endsOn: '2026-09-23' }, '', '', now)).not.toContain('endsPast');
    expect(validateDraft({ ...base, endsOn: '' }, '', '', now)).not.toContain('endsPast');
    expect(minEndOn('', '', now)).toBe('2026-09-23');
    // A start further out drags the end's floor with it.
    expect(minEndOn('', '2026-10-05', now)).toBe('2026-10-05');
    expect(minEndOn('', '2026-06-01', now)).toBe('2026-09-23');
  });
  it('lets a promotion that already ended keep its own end', () => {
    const now = new Date('2026-09-23T12:00:00');
    expect(validateDraft({ ...ok, startsOn: '', endsOn: '2026-06-30' }, '', '2026-06-30', now)).not.toContain('endsPast');
    expect(validateDraft({ ...ok, startsOn: '', endsOn: '2026-06-29' }, '', '2026-06-30', now)).toContain('endsPast');
    expect(minEndOn('2026-06-30', '', now)).toBe('2026-06-30');
  });
  it('names one save blocker, in the order the form reads', () => {
    expect(saveBlocker([])).toBeNull();
    expect(saveBlocker(['hours', 'name'])).toBe('name');
    expect(saveBlocker(validateDraft(EMPTY_DRAFT))).toBe('name');
  });
});

describe('lifecycle', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  it('is live inside its window when enabled', () => {
    expect(lifecycle(row, now)).toBe('live');
  });
  it('is scheduled before it starts', () => {
    expect(lifecycle({ ...row, starts_at: '2026-10-01T00:00:00Z' }, now)).toBe('scheduled');
  });
  it('is expired after its end even when enabled — automatic expiry', () => {
    expect(lifecycle({ ...row, ends_at: '2026-09-01T00:00:00Z' }, now)).toBe('expired');
  });
  it('is off when disabled, unless it already expired', () => {
    expect(lifecycle({ ...row, enabled: false }, now)).toBe('disabled');
    expect(lifecycle({ ...row, enabled: false, ends_at: '2026-09-01T00:00:00Z' }, now)).toBe('expired');
  });
  it('is live with no dates at all', () => {
    expect(lifecycle({ enabled: true, starts_at: null, ends_at: null }, now)).toBe('live');
  });
});

describe('small helpers', () => {
  it('detects a narrowed scope', () => {
    expect(hasScope({ courtIds: [], categoryIds: [], itemIds: [] })).toBe(false);
    expect(hasScope({ courtIds: ['c'], categoryIds: [], itemIds: [] })).toBe(true);
  });
  it('toggles ids and weekdays (sorted)', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleWeekday([5], 1)).toEqual([1, 5]);
    expect(toggleWeekday([1, 5], 5)).toEqual([1]);
  });
  it('compares drafts structurally', () => {
    expect(isDirty(EMPTY_DRAFT, { ...EMPTY_DRAFT })).toBe(false);
    expect(isDirty(EMPTY_DRAFT, { ...EMPTY_DRAFT, value: 5 })).toBe(true);
  });
});

const en = makeT('en');
const ar = makeT('ar');

describe('the list: order, filter, status word', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const base = { ...row, starts_at: null, ends_at: null };
  const rows = [
    { ...base, id: 'off', name_en: 'Alpha', enabled: false },
    { ...base, id: 'ended', name_en: 'Beta', ends_at: '2026-09-03T20:59:59Z' },
    { ...base, id: 'later', name_en: 'Gamma', starts_at: '2026-09-20T00:00:00Z' },
    { ...base, id: 'live2', name_en: 'Zulu' },
    { ...base, id: 'live1', name_en: 'Delta', public_code: 'SUMMER5' },
  ];

  it('sorts live first, then starting later, off, ended; by name inside each', () => {
    expect(sortPromotions(rows, 'en', now).map((r) => r.id)).toEqual(['live1', 'live2', 'later', 'off', 'ended']);
  });

  it('counts each lifecycle and the total', () => {
    expect(countByLifecycle(rows, now)).toEqual({ all: 5, live: 2, scheduled: 1, disabled: 1, expired: 1 });
  });

  it('filters by lifecycle and by name or code, case-insensitively', () => {
    expect(filterPromotions(rows, 'live', '', now).map((r) => r.id)).toEqual(['live2', 'live1']);
    expect(filterPromotions(rows, 'all', 'summer', now).map((r) => r.id)).toEqual(['live1']);
    expect(filterPromotions(rows, 'expired', 'zulu', now)).toEqual([]);
  });

  it('accepts only known filter values from the URL', () => {
    expect(isPromotionFilter('live')).toBe(true);
    expect(isPromotionFilter('all')).toBe(true);
    expect(isPromotionFilter('deleted')).toBe(false);
    expect(isPromotionFilter(undefined)).toBe(false);
  });

  it('prints one word, with the date when it starts later or has ended', () => {
    expect(statusText(rows[3]!, en, 'en', now)).toBe('Live');
    expect(statusText(rows[0]!, en, 'en', now)).toBe('Off');
    // Dates go through the shared formatter; compare against it, not an ICU build's spelling.
    expect(statusText(rows[2]!, en, 'en', now)).toBe(`Starts ${formatDate(new Date('2026-09-20T00:00:00Z'), 'en')}`);
    expect(statusText(rows[1]!, en, 'en', now)).toBe(`Ended ${formatDate(new Date('2026-09-03T20:59:59Z'), 'en')}`);
  });
});

describe('plain-language pieces', () => {
  it('folds three or more weekdays in a row into a range, across the week end too', () => {
    expect(weekdaysText([], en)).toBeNull();
    expect(weekdaysText([0, 1, 2, 3, 4, 5, 6], en)).toBeNull();
    expect(weekdaysText([5, 6], en)).toBe('Fri, Sat');
    expect(weekdaysText([0, 1, 2, 3, 4], en)).toBe('Sun–Thu');
    expect(weekdaysText([4, 5, 6, 0], en)).toBe('Thu–Sun');
    expect(weekdaysText([1, 3, 5], en)).toBe('Mon, Wed, Fri');
    expect(weekdaysText([5, 6], ar)).toContain('، ');
  });

  it('marks an hour window that crosses midnight', () => {
    expect(hoursText('16:00', '19:00', en)).toBe('16:00–19:00');
    expect(hoursText('22:00', '02:00', en)).toBe('22:00–02:00 (overnight)');
    expect(hoursText('', '', en)).toBeNull();
  });

  it('puts dates, weekdays and hours on one line, or says it is always on', () => {
    expect(scheduleText(EMPTY_DRAFT, en, 'en')).toBe('Any day, any time');
    expect(scheduleText({ ...EMPTY_DRAFT, weekdays: [5, 6], hourFrom: '16:00', hourTo: '19:00' }, en, 'en')).toBe('Fri, Sat · 16:00–19:00');
    const day = (ymd: string) => formatDate(new Date(`${ymd}T12:00:00`), 'en');
    expect(scheduleText({ ...EMPTY_DRAFT, startsOn: '2026-09-01', endsOn: '2026-09-30' }, en, 'en')).toBe(`${day('2026-09-01')} – ${day('2026-09-30')}`);
    expect(scheduleText({ ...EMPTY_DRAFT, endsOn: '2026-09-30' }, en, 'en')).toBe(`Until ${day('2026-09-30')}`);
  });

  it('says how a bill gets it, and flags code-only with no code', () => {
    expect(howText({ auto: true, publicCode: null, codeSingleUse: false }, en)).toBe('');
    expect(howText({ auto: false, publicCode: 'SUMMER5', codeSingleUse: true }, en)).toBe('Code SUMMER5 · single use');
    expect(howText({ auto: false, publicCode: null, codeSingleUse: false }, en)).toBe('Needs a code, none yet');
  });

  it('says what it covers with a label and a number, never a plural', () => {
    expect(scopeText({ courtIds: [], categoryIds: [], itemIds: [] }, en, 'en')).toBe('All cafe items');
    expect(scopeText({ courtIds: ['a', 'b'], categoryIds: ['c'], itemIds: ['x', 'y', 'z'] }, en, 'en')).toBe('Courts: 2 · Categories: 1 · Items: 3');
  });
});

describe('describePromotion', () => {
  it('reads a happy hour back in one line', () => {
    const d = { ...EMPTY_DRAFT, type: 'percent' as const, value: 10, weekdays: [5, 6], hourFrom: '16:00', hourTo: '19:00' };
    expect(describePromotion(d, en, 'en')).toBe('10% off everything from the cafe · Fri, Sat · 16:00–19:00');
  });

  it('includes scope, limits and the code when set', () => {
    const d = {
      ...EMPTY_DRAFT,
      type: 'amount' as const,
      value: 5000,
      scope: { courtIds: ['c'], categoryIds: [], itemIds: ['i'] },
      limits: { total: 100, perCustomer: 1, minSpendIqd: 20000 },
      auto: false,
      publicCode: 'SUMMER5',
    };
    const text = describePromotion(d, en, 'en');
    expect(text).toMatch(/^5,000 IQD off the chosen menu items · Only bills for bookings on the chosen courts · Any day, any time · /);
    expect(text).toContain('Total uses: 100');
    expect(text).toContain('Uses per guest: 1');
    expect(text).toContain('Code SUMMER5');
  });

  it('has an Arabic sentence, not English fallbacks', () => {
    const text = describePromotion(EMPTY_DRAFT, ar, 'ar');
    expect(text).toContain('خصم');
    expect(text).not.toMatch(/off|cafe/);
  });
});
