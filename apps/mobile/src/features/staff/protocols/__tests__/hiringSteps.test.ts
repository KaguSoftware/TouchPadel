import { describe, expect, it } from 'vitest';
import { HIREABLE_ROLES } from '@touch/core';
import {
  HIRING_STEPS,
  amountOf,
  dayAfter,
  emptyAnswers,
  groupedRoles,
  hiringIssues,
  hiringRecord,
  issuesOnStep,
  parseHiringStep,
  stepOfIssue,
  stepsDone,
  ungroupedRoles,
} from '../hiringSteps';

const filled = {
  ...emptyAnswers(),
  role: 'barista' as const,
  why: 'Evenings are one short',
  hours: '6 days, 4 pm to midnight',
  startDate: '2026-11-01',
};

describe('hiring start steps', () => {
  it('shows every hireable role in exactly one group', () => {
    expect(ungroupedRoles()).toEqual([]);
    expect(new Set(groupedRoles()).size).toBe(groupedRoles().length);
    expect(groupedRoles().sort()).toEqual([...HIREABLE_ROLES].sort());
  });

  it('reads the step param, and falls back to the first page', () => {
    expect(parseHiringStep('pay')).toBe('pay');
    expect(parseHiringStep('nope')).toBe('role');
    expect(parseHiringStep(undefined)).toBe('role');
    expect(HIRING_STEPS.map(stepsDone)).toEqual([0, 1, 2, 3]);
  });

  it('builds the open_position record, leaving an empty pay out', () => {
    expect(hiringRecord(filled)).toEqual({
      role: 'barista',
      why: 'Evenings are one short',
      hours: '6 days, 4 pm to midnight',
      start_date: '2026-11-01',
    });
    expect(hiringRecord({ ...filled, payMin: '600,000', payMax: '750000' })).toMatchObject({
      pay_min_iqd: 600000,
      pay_max_iqd: 750000,
    });
    expect(amountOf('')).toBeNull();
    expect(amountOf('1,250')).toBe(1250);
  });

  it('passes a full start, and puts each missing answer on its own page', () => {
    expect(hiringIssues(filled, 'Hiring: Barista', null, false)).toEqual([]);
    const issues = hiringIssues(emptyAnswers(), 'Hiring', null, false);
    expect(issuesOnStep(issues, 'role').map((i) => i.field)).toEqual(['role']);
    expect(issuesOnStep(issues, 'job').map((i) => i.field).sort()).toEqual(['hours', 'start_date', 'why']);
    expect(issuesOnStep(issues, 'pay')).toEqual([]);
  });

  it('asks the owner for both names on the Check page', () => {
    const issues = hiringIssues(filled, 'Hiring: Barista', null, true);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => stepOfIssue(i) === 'check')).toBe(true);
  });

  it('says so when the range is the wrong way round', () => {
    const issues = hiringIssues({ ...filled, payMin: '900000', payMax: '600000' }, 'Hiring', null, false);
    expect(issuesOnStep(issues, 'pay').map((i) => i.field)).toEqual(['pay_max_iqd']);
  });

  it('counts days forward across a month', () => {
    expect(dayAfter('2026-10-30', 3)).toBe('2026-11-02');
  });
});
