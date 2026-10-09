import { describe, expect, it } from 'vitest';
import type { LiveCoachRow } from '../../coaching/lessonPayloads';
import { averagePerLesson, liveTotals, orderLive, shareOfTotal, topEarner } from './liveLogic';

function row(over: Partial<LiveCoachRow> = {}): LiveCoachRow {
  return {
    coach_id: 'c1',
    coach_name_en: 'Sara',
    coach_name_ar: 'سارة',
    venue_id: 'v1',
    venue_name_en: 'Mansour',
    venue_name_ar: 'المنصور',
    lessons_count: 4,
    private_count: 1,
    group_count: 3,
    course_count: 0,
    minutes: 240,
    collected_iqd: 200000,
    court_share_iqd: 40000,
    coach_iqd: 96000,
    statement_id: null,
    statement_status: null,
    statement_total_iqd: null,
    ...over,
  };
}

describe('liveTotals', () => {
  it('adds the server figures and counts a coach at two branches once', () => {
    const t = liveTotals([row(), row({ venue_id: 'v2', lessons_count: 1, private_count: 1, group_count: 0, coach_iqd: 4000, court_share_iqd: 1000 }), row({ coach_id: 'c2', coach_iqd: 0 })]);
    expect(t.coaches).toBe(2);
    expect(t.lessons).toBe(9);
    expect(t.coachIqd).toBe(100000);
    expect(t.courtShare).toBe(81000);
    expect(t.privateLessons).toBe(3);
    expect(t.groupLessons).toBe(6);
  });
  it('reads a missing figure as nothing, never NaN', () => {
    const t = liveTotals([row({ lessons_count: null, coach_iqd: null, collected_iqd: null, court_share_iqd: null })]);
    expect(t).toMatchObject({ lessons: 0, coachIqd: 0, collected: 0, courtShare: 0 });
  });
});

describe('averagePerLesson and shareOfTotal', () => {
  it('rounds to a whole dinar and is null with no lessons', () => {
    expect(averagePerLesson({ lessons: 3, coachIqd: 100000 })).toBe(33333);
    expect(averagePerLesson({ lessons: 0, coachIqd: 0 })).toBeNull();
  });
  it('is a whole percent of the total and null before anything is earned', () => {
    expect(shareOfTotal(row({ coach_iqd: 96000 }), 120000)).toBe(80);
    expect(shareOfTotal(row({ coach_iqd: 0 }), 0)).toBeNull();
  });
});

describe('topEarner and orderLive', () => {
  it('names nobody before anything is earned', () => {
    expect(topEarner([row({ coach_iqd: 0 })])).toBeNull();
  });
  it('picks the largest share', () => {
    expect(topEarner([row({ coach_id: 'a', coach_iqd: 10 }), row({ coach_id: 'b', coach_iqd: 30 })])?.coach_id).toBe('b');
  });
  it('lists the rail branch first, then the larger share, then the name', () => {
    const rows = [
      row({ coach_id: 'o', venue_id: 'v2', coach_iqd: 999999, coach_name_en: 'Other' }),
      row({ coach_id: 'z', coach_iqd: 10, coach_name_en: 'Zed' }),
      row({ coach_id: 'a', coach_iqd: 10, coach_name_en: 'Amal' }),
      row({ coach_id: 'big', coach_iqd: 50, coach_name_en: 'Big' }),
    ];
    expect(orderLive(rows, 'en', 'v1').map((r) => r.coach_id)).toEqual(['big', 'a', 'z', 'o']);
  });
});
