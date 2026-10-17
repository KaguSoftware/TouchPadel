import { describe, expect, it } from 'vitest';
import { cellKey, emptyPlan, type PlanState } from '@touch/core';
import {
  bookedHours,
  issueAt,
  issuesOnStep,
  parsePlanStep,
  phoneSteps,
  planIssues,
  stepCount,
  stepOfIssue,
} from '../tournamentSteps';

const TZ = 'Asia/Baghdad'; // UTC+3, no DST
const C1 = '11111111-1111-4111-8111-111111111111';

function filled(variant: PlanState['variant']): PlanState {
  return {
    ...emptyPlan(variant),
    cls: 'B',
    playYears: 'one_to_three',
    nameEn: 'Friday Cup',
    nameAr: 'كأس الجمعة',
    format: 'americano',
    picks: [cellKey('2099-01-02', C1, 18 * 60), cellKey('2099-01-02', C1, 19 * 60)],
    count: '16',
    sponsor: { name: 'Acme', contact: '0770', contribution: '100000', branding: '', invoice: false },
  };
}

describe('phoneSteps', () => {
  it('leaves the type out (it has its own page) and keeps the sponsor for type 3 only', () => {
    expect(phoneSteps('type1')).toEqual(['name', 'courts', 'players', 'notes']);
    expect(phoneSteps('type2')).toEqual(['name', 'courts', 'players', 'notes']);
    expect(phoneSteps('type3')).toEqual(['name', 'courts', 'players', 'notes', 'sponsor']);
  });

  it('reads the step param, falling back to the first page', () => {
    expect(parsePlanStep('courts', 'type1')).toBe('courts');
    expect(parsePlanStep('sponsor', 'type1')).toBe('name');
    expect(parsePlanStep(undefined, 'type3')).toBe('name');
    expect(parsePlanStep('type', 'type2')).toBe('name');
  });
});

describe('planIssues', () => {
  it('passes a filled plan of each type', () => {
    for (const v of ['type1', 'type2', 'type3'] as const) {
      expect(planIssues(filled(v), TZ, [C1], false)).toEqual([]);
    }
  });

  it('puts each issue on its own page, and none on the name for a missing title', () => {
    const issues = planIssues(emptyPlan('type1'), TZ, [C1], false);
    expect(issues.some((i) => i.field === 'title')).toBe(false);
    expect(issuesOnStep(issues, 'name', 'type1').length).toBeGreaterThan(0);
    expect(issuesOnStep(issues, 'courts', 'type1').length).toBeGreaterThan(0);
    expect(issuesOnStep(issues, 'players', 'type1').length).toBeGreaterThan(0);
    expect(issuesOnStep(issues, 'notes', 'type1')).toEqual([]);
  });

  it('shows a type issue on the first page', () => {
    expect(stepOfIssue({ field: 'variant' }, 'type1')).toBe('name');
    expect(stepOfIssue({ field: 'sponsor.name' }, 'type3')).toBe('sponsor');
  });

  it('finds an issue under a path', () => {
    const issues = [{ field: 'sponsor.contact', code: 'RECORD_INVALID' as const }];
    expect(issueAt(issues, 'sponsor')).toBe(issues[0]);
    expect(issueAt(issues, 'sponsor.contact')).toBe(issues[0]);
    expect(issueAt(issues, 'sponsor.name')).toBeUndefined();
  });
});

describe('bookedHours', () => {
  it('marks every hour a booking overlaps, and only those', () => {
    // 18:30–20:00 Baghdad = 15:30–17:00 UTC: the 18, 19 hours, not 17 or 20.
    const booked = bookedHours(
      [{ court_id: C1, start_at: '2099-01-02T15:30:00Z', end_at: '2099-01-02T17:00:00Z', kind: 'booking' }],
      '2099-01-02',
      [17 * 60, 18 * 60, 19 * 60, 20 * 60],
      TZ,
    );
    expect([...booked.keys()]).toEqual([`${C1}|${18 * 60}`, `${C1}|${19 * 60}`]);
  });
});

describe('stepCount', () => {
  it('steps up and down, never under 2', () => {
    expect(stepCount('', 1)).toBe('2');
    expect(stepCount('', -1)).toBe('2');
    expect(stepCount('16', 1)).toBe('17');
    expect(stepCount('2', -1)).toBe('2');
    expect(stepCount('1,000', -1)).toBe('999');
  });
});
