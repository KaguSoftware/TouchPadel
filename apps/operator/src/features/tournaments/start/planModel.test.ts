import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT_VARIANTS,
  startForm,
  validateStart,
  type FieldDef,
} from '@touch/core/protocols';
import {
  cellKey,
  emptyPlan,
  hourColumns,
  planProgress,
  planRecord,
  sectionDone,
  sectionOfIssue,
  planSections,
  slotsOf,
  type PlanState,
} from './planModel';

const TZ = 'Asia/Baghdad'; // UTC+3, no DST
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';

function picks(date: string, court: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let m = from; m < to; m += 60) out.push(cellKey(date, court, m));
  return out;
}

describe('hourColumns', () => {
  it('covers the opening hours in whole hours, past midnight too', () => {
    expect(hourColumns(14 * 60, 18 * 60)).toEqual([840, 900, 960, 1020]);
    expect(hourColumns(22 * 60 + 30, 25 * 60)).toEqual([1320, 1380, 1440]);
    expect(hourColumns(600, 600)).toEqual([]);
  });
});

describe('slotsOf', () => {
  it('joins each court’s unbroken hours, and courts on the same stretch, into one slot', () => {
    const slots = slotsOf(
      [
        ...picks('2026-11-06', C2, 1080, 1320),
        ...picks('2026-11-06', C1, 1080, 1320),
        ...picks('2026-11-06', C3, 1080, 1200),
      ],
      [C1, C2, C3],
    );
    expect(slots.map((s) => [s.date, s.startMin, s.endMin, s.courtIds])).toEqual([
      ['2026-11-06', 1080, 1200, [C3]],
      ['2026-11-06', 1080, 1320, [C1, C2]],
    ]);
  });

  it('splits a gap in the hours, and keeps days apart', () => {
    const slots = slotsOf([
      ...picks('2026-11-07', C1, 1020, 1140),
      ...picks('2026-11-06', C1, 1080, 1140),
      ...picks('2026-11-06', C1, 1200, 1260),
    ]);
    expect(slots.map((s) => [s.date, s.startMin, s.endMin])).toEqual([
      ['2026-11-06', 1080, 1140],
      ['2026-11-06', 1200, 1260],
      ['2026-11-07', 1020, 1140],
    ]);
    expect(slots[2]!.keys).toEqual(picks('2026-11-07', C1, 1020, 1140));
  });
});

function filled(over: Partial<PlanState> = {}): PlanState {
  return {
    ...emptyPlan('type1'),
    cls: 'A',
    nameEn: ' Friday Night Americano ',
    nameAr: 'أمريكانو ليلة الجمعة',
    format: 'americano',
    picks: [...picks('2026-11-06', C1, 1080, 1320), ...picks('2026-11-06', C2, 1080, 1320)],
    count: '16',
    fee: '15,000',
    ...over,
  };
}

describe('planRecord', () => {
  it('builds the full plan the server validates, with times in the venue’s zone', () => {
    const record = planRecord(filled({ prizeText: 'Rackets', expected: '14' }), TZ, [C1, C2]);
    expect(record).toEqual({
      class: 'A',
      name_en: 'Friday Night Americano',
      name_ar: 'أمريكانو ليلة الجمعة',
      format: 'americano',
      ranges: [
        { court_ids: [C1, C2], from: '2026-11-06T15:00:00.000Z', to: '2026-11-06T19:00:00.000Z' },
      ],
      capacity: { unit: 'players', count: 16 },
      entry_fee_iqd: 15000,
      prize: { text: 'Rackets' },
      expected_entries: 14,
    });
    expect(
      validateStart({
        kind: 'tournament',
        variant: 'type1',
        change: null,
        titleEn: 'x',
        titleAr: 'y',
        record,
        byOwner: false,
      }),
    ).toEqual([]);
  });

  it('leaves the full plan’s fields out of a type 2 plan', () => {
    const record = planRecord(filled({ variant: 'type2', risks: 'Rain', budget: '5' }), TZ);
    expect(Object.keys(record).sort()).toEqual([
      'capacity',
      'class',
      'name_ar',
      'name_en',
      'ranges',
    ]);
    expect(
      validateStart({
        kind: 'tournament',
        variant: 'type2',
        change: null,
        titleEn: 'x',
        titleAr: 'y',
        record,
        byOwner: false,
      }),
    ).toEqual([]);
  });

  it('sends a type 3 sponsor, and the validator asks for one when it is missing', () => {
    const none = planRecord(filled({ variant: 'type3' }), TZ);
    const issues = validateStart({
      kind: 'tournament',
      variant: 'type3',
      change: null,
      titleEn: 'x',
      titleAr: 'y',
      record: none,
      byOwner: false,
    });
    expect(issues.map((i) => [i.field, i.code])).toContainEqual([
      'sponsor',
      'SPONSOR_DETAILS_REQUIRED',
    ]);
    const withSponsor = planRecord(
      filled({
        variant: 'type3',
        sponsor: {
          name: 'Zain',
          contact: '0770',
          contribution: '500,000',
          branding: '',
          invoice: true,
        },
      }),
      TZ,
    );
    expect(withSponsor.sponsor).toEqual({
      name: 'Zain',
      contact: '0770',
      contribution_iqd: 500000,
      invoice: true,
    });
  });

  it('passes a mistyped number on as not valid rather than dropping it', () => {
    expect(planRecord(filled({ count: '1a' }), TZ).capacity).toEqual({
      unit: 'players',
      count: Number.NaN,
    });
  });
});

describe('sections', () => {
  it('maps the server’s field paths onto the menu', () => {
    expect(sectionOfIssue({ field: 'name_ar' })).toBe('name');
    expect(sectionOfIssue({ field: 'ranges' })).toBe('courts');
    expect(sectionOfIssue({ field: 'capacity.count' })).toBe('players');
    expect(sectionOfIssue({ field: 'prize.iqd' })).toBe('players');
    expect(sectionOfIssue({ field: 'sponsor.name' })).toBe('sponsor');
    expect(sectionOfIssue({ field: 'variant' })).toBe('type');
  });

  it('ticks what is filled, and shows the sponsor only on a type 3 plan', () => {
    const p = filled();
    expect(sectionDone(p, 'name')).toBe(true);
    expect(sectionDone({ ...p, format: null }, 'name')).toBe(false);
    expect(sectionDone({ ...p, variant: 'type2', format: null }, 'name')).toBe(true);
    expect(sectionDone(p, 'courts')).toBe(true);
    expect(sectionDone({ ...p, count: '1' }, 'players')).toBe(false);
    expect(planSections('type1')).not.toContain('sponsor');
    expect(planSections('type3')).toContain('sponsor');
    // Every step shown counts, the optional notes too.
    expect(planProgress(p)).toEqual({ done: 4, total: 5 });
    expect(planProgress({ ...p, notes: 'Lights' })).toEqual({ done: 5, total: 5 });
    expect(planProgress({ ...p, variant: 'type3' })).toEqual({ done: 4, total: 6 });
    expect(planProgress(emptyPlan())).toEqual({ done: 1, total: 5 });
  });
});

// The sheet never reads the venue's template for submitterDecides (the
// generic form did): that is sound only while the plan has no decider-only
// field. Adding one fails here; wire the template read back in with it.
describe('the plan form', () => {
  const deciderOnly = (fields: readonly FieldDef[]): string[] =>
    fields.flatMap((f) => [
      ...(f.deciderOnly ? [f.name] : []),
      ...(f.fields ? deciderOnly(f.fields) : []),
    ]);

  it('has no decider-only field in any variant', () => {
    for (const variant of TOURNAMENT_VARIANTS) {
      expect(deciderOnly(startForm('tournament', { variant }).fields)).toEqual([]);
    }
  });
});
