import { describe, expect, it } from 'vitest';
import type { StepRow, SubmissionRow } from '@touch/core/protocols';
import {
  addStepAfterChoices,
  canMoveStep,
  decidesStep,
  defaultStep,
  draftFromTemplate,
  draftProblems,
  firstStepNeedsOk,
  hasDraftProblems,
  insertOwnerStep,
  isPurged,
  launchPhotoChoices,
  newOwnerStep,
  orderHolds,
  pickText,
  protocolCards,
  readOverview,
  readRunDetail,
  readStepDetail,
  readTemplateDetail,
  resubmitPrefill,
  standingRecord,
  startTemplateId,
  submissionRounds,
  templateChanged,
  templatePayload,
  titlesInBoth,
  waitsFor,
  type StepDef,
} from './protocolLogic';

const sub = (over: Partial<SubmissionRow>): SubmissionRow => ({
  id: 's',
  round: 1,
  submitted_by: 'u1',
  submitted_by_name: 'Rusul',
  submitted_at: '2026-09-25T09:00:00Z',
  record: {},
  photos: [],
  withdrawn_at: null,
  superseded_at: null,
  decision: null,
  decided_by: null,
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
  send_back_to: null,
  ...over,
});

const step = (over: Partial<StepRow>): StepRow => ({
  id: 'st',
  position: 1,
  step_key: null,
  name_en: 'Step',
  name_ar: 'خطوة',
  status: 'waiting',
  round: 1,
  actor_roles: ['manager'],
  assigned_to: null,
  assigned_to_name: null,
  needs_owner_ok: false,
  optional: false,
  after_keys: [],
  opened_at: null,
  passed_at: null,
  skip_note: null,
  skipped_by_name: null,
  skipped_at: null,
  items: [],
  submissions: [],
  ...over,
});

// The release defs as app.protocol_step_defs returns them (§2.8).
const RELEASE_DEFS: StepDef[] = [
  { step_key: 'propose', after: [], fixed: 'first', ok_fixed: false },
  { step_key: 'test', after: ['propose'], fixed: null, ok_fixed: false },
  { step_key: 'analysis', after: ['test'], fixed: null, ok_fixed: true },
  { step_key: 'marketing', after: ['test'], fixed: null, ok_fixed: false },
  { step_key: 'launch', after: ['analysis', 'marketing'], fixed: 'last', ok_fixed: true },
].map((d) => ({
  name_en: d.step_key,
  name_ar: d.step_key,
  actor_roles: ['manager'],
  assign_to_starter: false,
  needs_owner_ok: false,
  optional: false,
  photo_folder: null,
  photos_min: 0,
  photos_max: 0,
  record_visibility: 'run',
  ...d,
})) as StepDef[];

describe('reading the engine', () => {
  it('reads the overview and folds a tournament’s three types into one card', () => {
    const t = (kind: string, variant: string | null, running: number, waiting: number) => ({
      template_id: `${kind}${variant ?? ''}`,
      kind,
      variant,
      name_en: kind,
      name_ar: kind,
      version: 1,
      running,
      waiting_on_me: waiting,
      finished_30d: 1,
    });
    const templates = readOverview({
      templates: [t('product_release', null, 2, 1), t('tournament', 'type2', 1, 0), t('tournament', 'type1', 3, 2), t('tournament', 'type3', 0, 1), t('hiring', null, 0, 0)],
    });
    const cards = protocolCards(templates);
    expect(cards.map((c) => c.kind)).toEqual(['product_release', 'tournament', 'hiring', 'price_promo']);
    const tournament = cards[1]!;
    expect(tournament.templates.map((x) => x.variant)).toEqual(['type1', 'type2', 'type3']);
    expect([tournament.running, tournament.waiting, tournament.finished30d]).toEqual([4, 3, 3]);
    // A kind this venue has no template for still has its card, at zero.
    expect(cards[3]).toMatchObject({ kind: 'price_promo', templates: [], running: 0, waiting: 0 });
  });

  it('reads a run and a step defensively: junk becomes nothing, never a throw', () => {
    const d = readRunDetail({
      run: { id: 'r1', kind: 'price_promo', status: 'active', title_en: null, title_ar: 'تغيير', current_steps: [{ id: 'a', status: 'open' }], data: [] },
      steps: [
        { id: 'b', position: 2, status: 'waiting', actor_roles: ['manager', 'wizard'], submissions: 'nope' },
        { id: 'a', position: 1, status: 'open', items: [{ id: 'i', text_en: 'x', text_ar: 'س', done_at: null }] },
      ],
      can: { submit: true, send_back_targets: ['a', 7] },
    });
    expect(d.run.kind).toBe('price_promo');
    expect(d.run.data).toBeNull();
    expect(d.steps.map((s) => s.id)).toEqual(['a', 'b']);
    expect(d.steps[1]!.actor_roles).toEqual(['manager']);
    expect(d.steps[1]!.submissions).toEqual([]);
    expect(d.can).toMatchObject({ submit: true, stop: false, send_back_targets: ['a'] });
    expect(readStepDetail(null).can.submit).toBe(false);
    expect(readStepDetail({ def: { step_key: 'plan', fixed: 'first', record_visibility: 'mgmt' } }).def).toMatchObject({ fixed: 'first', record_visibility: 'mgmt' });
  });

  it('shows a title in the reader’s language, falling back to the other (Q10)', () => {
    expect(pickText('en', 'Summer Cup', 'كأس الصيف')).toBe('Summer Cup');
    expect(pickText('ar', 'Summer Cup', 'كأس الصيف')).toBe('كأس الصيف');
    expect(pickText('en', '  ', 'كأس الصيف')).toBe('كأس الصيف');
    expect(pickText('ar', null, null)).toBe('');
    expect(isPurged('[deleted after 90 days]')).toBe(true);
    expect(isPurged('fine')).toBe(false);
  });
});

describe('the timeline', () => {
  const s = step({
    round: 2,
    submissions: [
      sub({ id: 'a', round: 1, submitted_at: '2026-09-25T09:00:00Z', decision: 'send_back', decision_note: 'too sweet', record: { notes: 'first' }, photos: ['p1'] }),
      sub({ id: 'b', round: 2, submitted_at: '2026-09-25T11:00:00Z', withdrawn_at: '2026-09-25T11:05:00Z', record: { notes: 'second' } }),
      sub({ id: 'c', round: 2, submitted_at: '2026-09-25T12:00:00Z', record: { notes: 'third' }, photos: ['p2'] }),
    ],
  });

  it('groups by round, latest round first, each round in order', () => {
    expect(submissionRounds(s).map((r) => [r.round, r.submissions.map((x) => x.id)])).toEqual([
      [2, ['b', 'c']],
      [1, ['a']],
    ]);
  });

  it('prefills a resubmission from the newest record the caller can see, photos included', () => {
    expect(resubmitPrefill(s)).toEqual({ record: { notes: 'third' }, photos: ['p2'] });
    expect(resubmitPrefill(step({ submissions: [sub({ record: null })] }))).toBeNull();
  });

  it('reads another step’s standing record, never a withdrawn or sent-back one', () => {
    const steps = [
      step({ id: 'p', step_key: 'propose', submissions: [sub({ id: 'x', round: 1, decision: 'send_back', record: { change: 'rate' } }), sub({ id: 'y', round: 2, decision: 'auto', record: { change: 'price' } })] }),
    ];
    expect(standingRecord(steps, 'propose')).toEqual({ change: 'price' });
    expect(standingRecord(steps, 'numbers')).toBeNull();
  });

  it('offers the launch only photos of the test and marketing steps that still stand', () => {
    const steps = [
      step({ step_key: 'propose', submissions: [sub({ photos: ['proposal.jpg'] })] }),
      step({ step_key: 'test', submissions: [sub({ photos: ['old.jpg'], decision: 'send_back' }), sub({ photos: ['t1.jpg', 't2.jpg'], decision: 'approve' })] }),
      step({ step_key: 'marketing', submissions: [sub({ photos: ['m1.jpg', 't1.jpg'] }), sub({ photos: ['gone.jpg'], withdrawn_at: 'x' })] }),
    ];
    expect(launchPhotoChoices(steps)).toEqual(['t1.jpg', 't2.jpg', 'm1.jpg']);
  });

  it('opens a run on the step moving, else on the last that moved, so a finished run shows how it ended', () => {
    const at = (status: StepRow['status'][]) => status.map((st, i) => ({ id: `s${i + 1}`, position: i + 1, status: st }));
    expect(defaultStep(at(['passed', 'submitted', 'open', 'waiting']))).toBe('s2');
    expect(defaultStep(at(['passed', 'passed', 'passed', 'passed']))).toBe('s4');
    expect(defaultStep(at(['passed', 'stopped', 'waiting', 'waiting']))).toBe('s2');
    expect(defaultStep(at(['waiting', 'waiting']))).toBe('s1');
    expect(defaultStep([])).toBeNull();
  });

  it('names what a waiting step opens after', () => {
    const steps = [step({ id: 'a', step_key: 'analysis' }), step({ id: 'm', step_key: 'marketing' })];
    expect(waitsFor(step({ after_keys: ['analysis', 'marketing', 'gone'] }), steps).map((x) => x.id)).toEqual(['a', 'm']);
  });
});

describe('How it works', () => {
  const detail = readTemplateDetail({
    template: { id: 't1', kind: 'product_release', name_en: 'New item', name_ar: 'صنف جديد', version: 3 },
    steps: RELEASE_DEFS.map((d, i) => ({ position: i + 1, step_key: d.step_key, name_en: d.step_key, name_ar: `ع ${d.step_key}`, actor_roles: ['manager'], needs_owner_ok: d.ok_fixed, optional: false, items: [] })),
    defs: RELEASE_DEFS,
  });

  it('keeps the order that matters: first, last, and every step after what it depends on (Q7)', () => {
    const draft = draftFromTemplate(detail);
    expect(orderHolds(draft.steps, RELEASE_DEFS)).toBe(true);
    const at = (k: string) => draft.steps.findIndex((s) => s.step_key === k);
    // The proposal is always first; the launch always last.
    expect(canMoveStep(draft.steps, RELEASE_DEFS, at('propose'), 'down')).toBe(false);
    expect(canMoveStep(draft.steps, RELEASE_DEFS, at('launch'), 'up')).toBe(false);
    // The test waits for the proposal; the price step for the test.
    expect(canMoveStep(draft.steps, RELEASE_DEFS, at('test'), 'up')).toBe(false);
    expect(canMoveStep(draft.steps, RELEASE_DEFS, at('analysis'), 'up')).toBe(false);
    // The one swap that does not matter: price and marketing.
    expect(canMoveStep(draft.steps, RELEASE_DEFS, at('analysis'), 'down')).toBe(true);
  });

  it('puts the owner’s own step above the last one, where it moves freely but never past first or last', () => {
    const draft = draftFromTemplate(detail);
    const own = { ...newOwnerStep(), name_en: 'Tasting', name_ar: 'تذوق' };
    const steps = insertOwnerStep(draft.steps, own);
    expect(steps[steps.length - 2]!.key).toBe(own.key);
    const i = steps.length - 2;
    expect(canMoveStep(steps, RELEASE_DEFS, i, 'up')).toBe(true);
    expect(canMoveStep(steps, RELEASE_DEFS, i, 'down')).toBe(false);
    expect(canMoveStep(steps, RELEASE_DEFS, 1, 'up')).toBe(false);
  });

  it('finds what save would refuse before the round trip', () => {
    const draft = draftFromTemplate(detail);
    expect(hasDraftProblems(draftProblems(draft, RELEASE_DEFS))).toBe(false);
    const own = { ...newOwnerStep(), name_en: 'Tasting', name_ar: '', actor_roles: [] };
    const bad = {
      ...draft,
      name_ar: ' ',
      steps: insertOwnerStep(
        draft.steps.map((s) => (s.step_key === 'test' ? { ...s, items: [{ key: 'i1', text_en: 'Photo', text_ar: '' }, { key: 'i2', text_en: '', text_ar: '' }] } : s)),
        own,
      ),
    };
    const p = draftProblems(bad, RELEASE_DEFS);
    expect(p.name).toBe('both');
    expect(p.steps.get(own.key)).toBe('both');
    expect(p.items.get('i1')).toBe('both');
    // A blank line is dropped at save, not a problem.
    expect(p.items.has('i2')).toBe(false);
    const noActors = draftProblems({ ...draft, steps: insertOwnerStep(draft.steps, { ...own, name_ar: 'تذوق' }) }, RELEASE_DEFS);
    expect(noActors.steps.get(own.key)).toBe('actors');
  });

  it('sends built-in steps without actors or optional, and the owner’s with them', () => {
    const draft = draftFromTemplate(detail);
    const own = { ...newOwnerStep(), name_en: ' Tasting ', name_ar: 'تذوق', optional: true, items: [{ key: 'a', text_en: 'Note', text_ar: 'ملاحظة' }, { key: 'b', text_en: ' ', text_ar: '' }] };
    const body = templatePayload({ ...draft, steps: insertOwnerStep(draft.steps, own) });
    const built = body.p_steps.find((s) => s.step_key === 'test')!;
    expect(built).not.toHaveProperty('actor_roles');
    expect(built).not.toHaveProperty('optional');
    const mine = body.p_steps.find((s) => s.step_key === null)!;
    expect(mine).toEqual({ step_key: null, name_en: 'Tasting', name_ar: 'تذوق', needs_owner_ok: false, items: [{ text_en: 'Note', text_ar: 'ملاحظة' }], actor_roles: ['manager'], optional: true });
    expect(templateChanged(draft, draftFromTemplate(detail))).toBe(false);
    expect(templateChanged({ ...draft, name_en: 'New item ' }, draft)).toBe(false);
    expect(templateChanged({ ...draft, name_en: 'A new item' }, draft)).toBe(true);
  });
});

describe('one run’s own steps (owner, Q11)', () => {
  it('offers a place only where nothing below it has started, and never after the last step', () => {
    const steps = [
      step({ id: 'p', position: 1, step_key: 'propose', status: 'passed' }),
      step({ id: 't', position: 2, step_key: 'test', status: 'open' }),
      step({ id: 'a', position: 3, step_key: 'analysis', status: 'waiting' }),
      step({ id: 'm', position: 4, step_key: 'marketing', status: 'waiting' }),
      step({ id: 'l', position: 5, step_key: 'launch', status: 'waiting' }),
    ];
    expect(addStepAfterChoices(steps, 'launch').map((s) => s.id)).toEqual(['t', 'a', 'm']);
    // With the launch step no longer waiting, nowhere.
    expect(addStepAfterChoices(steps.map((s) => (s.id === 'l' ? { ...s, status: 'open' as const } : s)), 'launch')).toEqual([]);
  });
});

describe('the server’s rules the forms mirror', () => {
  it('knows who decides a step (§2.7) and who types both titles', () => {
    expect(decidesStep('manager', false)).toBe(true);
    expect(decidesStep('owner', false)).toBe(true);
    expect(decidesStep('manager', true)).toBe(false);
    expect(decidesStep('owner', true)).toBe(true);
    expect(decidesStep('head_chef', false)).toBe(false);
    expect(decidesStep(undefined, false)).toBe(false);
    expect(titlesInBoth('owner')).toBe(true);
    expect(titlesInBoth('manager')).toBe(false);
  });

  it('takes a start’s step-1 OK from the venue’s template, not the built-in default (§2.7)', () => {
    const templates = readOverview({
      templates: [
        { template_id: 'rel', kind: 'product_release', variant: null },
        { template_id: 't1', kind: 'tournament', variant: 'type1' },
        { template_id: 't2', kind: 'tournament', variant: 'type2' },
      ],
    });
    expect(startTemplateId(templates, 'product_release', null)).toBe('rel');
    expect(startTemplateId(templates, 'tournament', 'type2')).toBe('t2');
    expect(startTemplateId(templates, 'hiring', null)).toBeNull();
    expect(startTemplateId(undefined, 'product_release', null)).toBeNull();

    const detail = readTemplateDetail({
      template: { id: 'rel', kind: 'product_release' },
      steps: [
        { position: 2, step_key: 'test', needs_owner_ok: false },
        { position: 1, step_key: 'propose', needs_owner_ok: true },
      ],
    });
    // The owner turned "Needs my OK" on for the proposal: the manager no longer decides it.
    expect(firstStepNeedsOk(detail, 'rel', 'propose')).toBe(true);
    expect(decidesStep('manager', firstStepNeedsOk(detail, 'rel', 'propose')!)).toBe(false);
    // Not read yet, or another template's answer still in hand: unknown.
    expect(firstStepNeedsOk(undefined, 'rel', 'propose')).toBeNull();
    expect(firstStepNeedsOk(detail, 't1', 'propose')).toBeNull();
    expect(firstStepNeedsOk(detail, 'rel', 'plan')).toBeNull();
  });
});
