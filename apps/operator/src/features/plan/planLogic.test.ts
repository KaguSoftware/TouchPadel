import { describe, expect, it } from 'vitest';
import {
  canCancelIdea,
  canSendResult,
  ideaStage,
  isDriveLink,
  madeCount,
  monthFirst,
  monthLast,
  planToDoCount,
  readPlan,
  resultDay,
  saveIdeaArgs,
  validateIdea,
  weeklyDays,
  EMPTY_IDEA,
  type PlanIdea,
} from './planLogic';
import { validatePlanSearch, validatePostsSearch } from './search';

const idea = (over: Partial<PlanIdea>): PlanIdea => ({
  id: 'i',
  day: '2026-11-10',
  title: 'Friday reel',
  kind: 'reel',
  channel: 'instagram',
  details: null,
  status: 'approved',
  dropNote: null,
  createdByName: null,
  result: null,
  ...over,
});

describe('readPlan', () => {
  it('reads app.marketing_plan and drops what it cannot use', () => {
    const p = readPlan({
      month: '2026-11-01',
      today: '2026-11-05',
      plan: { id: 'p', status: 'waiting', sent_by_name: 'Rusul', sent_at: '2026-11-01T09:00:00Z', decision_note: null },
      ideas: [
        { id: 'a', day: '2026-11-06', title: 'Reel', kind: 'reel', channel: 'tiktok', status: 'proposed', result: null },
        { id: 'b', day: '2026-11-07', title: 'Odd', kind: 'billboard', channel: 'myspace', status: 'approved', result: { id: 'c', status: 'changes', version: 2 } },
        { title: 'no id' },
      ],
      waiting_months: ['2026-11-01', 7],
      can_send: false,
      can_decide: true,
    });
    expect(p.plan).toMatchObject({ id: 'p', status: 'waiting', sentByName: 'Rusul' });
    expect(p.ideas.map((i) => i.id)).toEqual(['a', 'b']);
    expect(p.ideas[1]).toMatchObject({ kind: 'other', channel: 'other', result: { id: 'c', status: 'changes', version: 2 } });
    expect(p.waitingMonths).toEqual(['2026-11-01']);
    expect(p).toMatchObject({ canDecide: true, canSend: false, canEdit: false });
  });
  it('reads an empty month as no plan', () => {
    expect(readPlan({ month: '2026-12-01', today: '2026-11-05', plan: null, ideas: [] })).toMatchObject({ plan: null, ideas: [] });
    expect(readPlan(null).ideas).toEqual([]);
  });
});

describe('ideaStage', () => {
  const today = '2026-11-10';
  it('keeps the owner’s word on an undecided or refused idea', () => {
    expect(ideaStage(idea({ status: 'proposed' }), today)).toBe('proposed');
    expect(ideaStage(idea({ status: 'dropped' }), today)).toBe('dropped');
    expect(ideaStage(idea({ status: 'cancelled' }), today)).toBe('cancelled');
  });
  it('follows the result of an approved idea', () => {
    expect(ideaStage(idea({}), today)).toBe('toMake');
    expect(ideaStage(idea({ day: '2026-11-09' }), today)).toBe('late');
    expect(ideaStage(idea({ result: { id: 'c', status: 'waiting', version: 1 } }), today)).toBe('sent');
    expect(ideaStage(idea({ result: { id: 'c', status: 'changes', version: 1 } }), today)).toBe('changes');
    expect(ideaStage(idea({ result: { id: 'c', status: 'approved', version: 1 } }), today)).toBe('done');
    expect(ideaStage(idea({ result: { id: 'c', status: 'declined', version: 1 } }), today)).toBe('declined');
    // A withdrawn result leaves the idea to make again.
    expect(ideaStage(idea({ result: { id: 'c', status: 'withdrawn', version: 1 } }), today)).toBe('toMake');
  });
  it('offers a result only where one can go', () => {
    expect(['toMake', 'late', 'declined'].every((s) => canSendResult(s as never))).toBe(true);
    expect(['proposed', 'sent', 'changes', 'done', 'dropped'].some((s) => canSendResult(s as never))).toBe(false);
  });
  it('takes an approved idea off only while nothing live was sent', () => {
    expect(canCancelIdea(idea({}))).toBe(true);
    expect(canCancelIdea(idea({ result: { id: 'c', status: 'declined', version: 1 } }))).toBe(true);
    expect(canCancelIdea(idea({ result: { id: 'c', status: 'waiting', version: 1 } }))).toBe(false);
    expect(canCancelIdea(idea({ status: 'proposed' }))).toBe(false);
  });
});

describe('the badge and progress', () => {
  const base = readPlan({ month: '2026-11-01', today: '2026-11-10', plan: { id: 'p', status: 'approved' } });
  it('counts what marketing must do now', () => {
    const plan = {
      ...base,
      ideas: [
        idea({ id: 'late', day: '2026-11-08' }),
        idea({ id: 'soon', day: '2026-11-12' }),
        idea({ id: 'later', day: '2026-11-20' }),
        idea({ id: 'changes', result: { id: 'c1', status: 'changes', version: 1 } }),
        idea({ id: 'sent', result: { id: 'c2', status: 'waiting', version: 1 } }),
        idea({ id: 'new', status: 'proposed' }),
      ],
    };
    expect(planToDoCount(plan)).toBe(3);
    expect(planToDoCount({ ...plan, plan: { ...plan.plan!, status: 'changes' } })).toBe(4);
  });
  it('counts approved results of approved ideas', () => {
    const plan = {
      ...base,
      ideas: [idea({ result: { id: 'c', status: 'approved', version: 1 } }), idea({}), idea({ status: 'dropped' })],
    };
    expect(madeCount(plan)).toEqual({ made: 1, of: 2 });
  });
});

describe('days', () => {
  it('repeats an idea weekly to the month’s end', () => {
    expect(weeklyDays('2026-11-05')).toEqual(['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26']);
    expect(weeklyDays('2026-11-30')).toEqual(['2026-11-30']);
  });
  it('knows a month’s edges', () => {
    expect(monthFirst('2026-02')).toBe('2026-02-01');
    expect(monthFirst('2026-02-17')).toBe('2026-02-01');
    expect(monthLast('2028-02')).toBe('2028-02-29');
  });
  it('plans a late result for today', () => {
    expect(resultDay('2026-11-12', '2026-11-10')).toBe('2026-11-12');
    expect(resultDay('2026-11-08', '2026-11-10')).toBe('2026-11-10');
  });
});

describe('the idea form', () => {
  it('needs a title and keeps to the limits', () => {
    expect(validateIdea(EMPTY_IDEA)).toEqual([{ field: 'title', code: 'required' }]);
    expect(validateIdea({ ...EMPTY_IDEA, title: 'x'.repeat(121) })).toEqual([{ field: 'title', code: 'tooLong' }]);
    expect(validateIdea({ ...EMPTY_IDEA, title: 'Ok', details: 'y'.repeat(2001) })).toEqual([{ field: 'details', code: 'tooLong' }]);
    expect(validateIdea({ ...EMPTY_IDEA, title: 'Ok' })).toEqual([]);
  });
  it('sends every weekly day for a new idea, one day for an edit', () => {
    const d = { ...EMPTY_IDEA, title: '  Reel ', details: '  ', weekly: true };
    expect(saveIdeaArgs(d, '2026-11-26', null, 'k')).toMatchObject({ p_id: null, p_days: ['2026-11-26'], p_title: 'Reel', p_details: null });
    expect(saveIdeaArgs(d, '2026-11-19', null, 'k').p_days).toEqual(['2026-11-19', '2026-11-26']);
    expect(saveIdeaArgs(d, '2026-11-19', 'id', null).p_days).toEqual(['2026-11-19']);
  });
});

describe('isDriveLink', () => {
  it('takes a Google Drive or Docs link over https only', () => {
    expect(isDriveLink('https://drive.google.com/file/d/abc/view?usp=sharing')).toBe(true);
    expect(isDriveLink(' https://docs.google.com/presentation/d/abc ')).toBe(true);
    expect(isDriveLink('http://drive.google.com/file/d/abc')).toBe(false);
    expect(isDriveLink('https://dropbox.com/s/abc')).toBe(false);
    expect(isDriveLink('https://drive.google.com.evil.example/x')).toBe(false);
    expect(isDriveLink('https://user:pw@drive.google.com/x')).toBe(false);
    expect(isDriveLink('drive.google.com/file')).toBe(false);
  });
});

describe('search', () => {
  it('keeps a valid month, day and view and drops the rest', () => {
    expect(validatePlanSearch({ month: '2026-11', day: '2026-11-05', view: 'list' })).toEqual({ month: '2026-11', day: '2026-11-05', view: 'list' });
    expect(validatePlanSearch({ month: '2026-13', day: 'x', view: 'grid' })).toEqual({});
    expect(validatePlanSearch({ month: '2026-11', day: '2026-12-01' })).toEqual({ month: '2026-11' });
    expect(validatePostsSearch({ open: 'A0000000-0000-4000-8000-000000000001' })).toEqual({ open: 'a0000000-0000-4000-8000-000000000001' });
    expect(validatePostsSearch({ open: 'nope' })).toEqual({});
  });
});
