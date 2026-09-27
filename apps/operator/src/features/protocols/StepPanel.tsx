/**
 * One step of a run (build-contracts-2026-09-23 §5.4 "The step sheet"): who
 * does it and who decides it, its context read, its checklist, everything sent
 * on it round by round, and — where the engine's `can` says so — the form, the
 * decision, a withdrawal and a skip.
 *
 * Buttons follow `can` and nothing else (no role check here): the engine
 * answers for the caller, whether a manager covering a step, the owner, or a
 * head role opening the same panel from /tasks (Q2: everything works in both
 * apps). The RPCs check again.
 *
 * `StepSheet` is the same panel in a dialog, for a screen that opens a single
 * step (/tasks).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatIQD, formatNumber, isolate } from '@touch/i18n';
import { stepForm, validateStep, type FieldIssue, type PriceChangeKind, type StepRow, type SubmissionRow } from '@touch/core/protocols';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { callEdge } from '../../lib/edge';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, Modal } from '../../components/ui';
import { AsyncStateWrapper, MessagePresenter, StatusBadge, asyncStatus } from '../../components/kit';
import { invalidateProtocols, useRunDetail, useStepDetail, useTargets } from './api';
import { CandidatesPanel, useCandidates } from './CandidatesPanel';
import { analysisPrefill, finalizeRecord, interviewsRecord, numbersAddons, numbersPrefill, numbersSizes } from './contextLogic';
import { DecisionDialog, ReasonDialog } from './DecisionDialog';
import { protocolErrorKey } from './errors';
import { cleanRecord, initialValue, mintKey, type Obj } from './formModel';
import { PhotoField, PhotoStrip } from './PhotoField';
import {
  decidesStep,
  decisionTone,
  isPurged,
  launchPhotoChoices,
  pickText,
  resubmitPrefill,
  standingRecord,
  stepStatusTone,
  submissionRounds,
  waitsFor,
  type RunDetail,
  type StepDetail,
} from './protocolLogic';
import { RecordView, type NameBook } from './RecordView';
import { StepContextPanel, useStepContexts, type StepContexts } from './StepContext';
import { RecordForm, type FormEnv, type SizeRow } from './StepForm';
import type { Targets } from './priceTargets';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function StepPanel({ stepId, run }: { stepId: string; run?: RunDetail | null }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const mgmt = canAccess(staff?.role, '/protocols');
  const q = useStepDetail(stepId);
  const d = q.data;
  const runQ = useRunDetail(run ? null : d?.run.id ?? null);
  const runDetail = run ?? runQ.data ?? null;
  const ctx = useStepContexts(d?.run.kind ?? 'product_release', d?.step.step_key ?? null, d?.run.id ?? '', d?.step.id ?? '', mgmt);
  return (
    <AsyncStateWrapper status={asyncStatus(q, () => false)} error={q.error} onRetry={() => void q.refetch()}>
      {d ? <StepBody d={d} runDetail={runDetail} ctx={ctx} mgmt={mgmt} /> : <p>{tr('common.loading')}</p>}
    </AsyncStateWrapper>
  );
}

export function StepSheet({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const q = useStepDetail(stepId);
  const title = q.data ? pickText(locale, q.data.step.name_en, q.data.step.name_ar) : tr('ws.protocols.step.title');
  return (
    <Modal title={title} onClose={onClose} size="lg">
      <StepPanel stepId={stepId} />
    </Modal>
  );
}

function StepBody({ d, runDetail, ctx, mgmt }: { d: StepDetail; runDetail: RunDetail | null; ctx: StepContexts; mgmt: boolean }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { run, step, can } = d;
  const [deciding, setDeciding] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The checklist's own refusal shows under the checklist, and a line being
  // ticked is held until the server answers, so a double click is one tick.
  const [ticking, setTicking] = useState<string | null>(null);
  const [tickError, setTickError] = useState<unknown>(null);
  const steps = runDetail?.steps ?? [];

  const pending = step.submissions.find((s) => s.id === can.decide_submission_id) ?? null;
  const targets = can.send_back_targets
    .map((id) => steps.find((s) => s.id === id) ?? (id === step.id ? step : null))
    .filter((s): s is StepRow => s !== null);
  const deps = waitsFor(step, steps);
  // The owner's own steps (the launch, adding the new person) pass when the owner sends them (Q12).
  const ownersOwn = step.actor_roles.length > 0 && step.actor_roles.every((r) => r === 'owner');
  const decider = tr(ownersOwn ? 'ws.protocols.step.decider.self' : step.needs_owner_ok ? 'ws.protocols.step.decider.owner' : 'ws.protocols.step.decider.manager');

  async function tick(itemId: string, done: boolean) {
    setTicking(itemId);
    setTickError(null);
    try {
      await appRpc('tick_run_item', { p_item_id: itemId, p_done: done });
      await invalidateProtocols(qc);
    } catch (e) {
      setTickError(e);
    } finally {
      setTicking(null);
    }
  }

  async function withdraw() {
    if (!can.withdraw_submission_id) return;
    setWithdrawing(true);
    setError(null);
    try {
      await appRpc('withdraw_step', { p_submission_id: can.withdraw_submission_id });
      toast.ok(tr('ws.protocols.step.withdrawn'));
      await invalidateProtocols(qc);
    } catch (e) {
      setError(e);
    } finally {
      setWithdrawing(false);
    }
  }

  const proposedChange = run.kind === 'price_promo' ? standingRecord(steps, 'propose')?.change : null;
  const targetsQ = useTargets(typeof proposedChange === 'string' && proposedChange !== 'promotion' ? (proposedChange as PriceChangeKind) : null);
  const names = useNameBook(ctx, steps, targetsQ.data ?? null);

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="step-panel" data-step={step.step_key ?? 'own'}>
      <header style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>{pickText(locale, step.name_en, step.name_ar)}</h3>
          <StatusBadge tone={stepStatusTone(step.status)} label={tr(`work.protocol.stepStatus.${step.status}`)} />
          {step.round > 1 && <StatusBadge tone="neutral" dot={false} label={tr('work.protocol.round', { round: formatNumber(step.round, locale) })} />}
          {step.needs_owner_ok && <StatusBadge tone="info" dot={false} label={tr('work.protocol.needsOwnerOk')} />}
          {step.optional && <StatusBadge tone="neutral" dot={false} label={tr('work.protocol.optional')} />}
        </div>
        <p style={{ ...muted, margin: 0 }}>
          {step.assigned_to_name
            ? tr('ws.protocols.step.assigned', { name: isolate(step.assigned_to_name) })
            : tr('ws.protocols.step.actors', { roles: step.actor_roles.map((r) => tr(`op.roles.${r}`)).join(tr('ws.protocols.view.listJoin')) })}
          {' · '}
          {decider}
        </p>
        {step.status === 'waiting' && deps.length > 0 && (
          <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.step.opensAfter', { steps: deps.map((s) => pickText(locale, s.name_en, s.name_ar)).join(tr('ws.protocols.view.listJoin')) })}</p>
        )}
      </header>

      <StepContextPanel ctx={ctx} />

      {run.kind === 'hiring' && step.step_key === 'interviews' && mgmt && <CandidatesPanel runId={run.id} editable={can.submit} />}

      {step.items.length > 0 && (
        <section style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <h4 style={{ margin: 0 }}>{tr('ws.protocols.step.checklist')}</h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {step.items.map((i) => (
              <li key={i.id} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* The line's text is the box's label, so the whole line ticks it, as on /tasks. */}
                <label style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flex: 1, minInlineSize: 0, cursor: can.tick ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={i.done_at !== null}
                    disabled={!can.tick || ticking === i.id}
                    onChange={(e) => void tick(i.id, e.target.checked)}
                  />
                  <bdi>{pickText(locale, i.text_en, i.text_ar)}</bdi>
                </label>
                {i.done_at && (
                  <span style={muted}>{tr('ws.protocols.step.tickedBy', { name: isolate(i.done_by_name ?? '—'), date: formatDateTime(new Date(i.done_at), locale) })}</span>
                )}
              </li>
            ))}
          </ul>
          {tickError != null && (
            <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr(protocolErrorKey(tickError))}
            </p>
          )}
        </section>
      )}

      {can.submit && runDetail && <StepSubmit d={d} runDetail={runDetail} ctx={ctx} />}
      {!can.submit && step.status === 'open' && (
        <MessagePresenter tone="info" message={tr('ws.protocols.step.forSomeoneElse', { roles: step.actor_roles.map((r) => tr(`op.roles.${r}`)).join(tr('ws.protocols.view.listJoin')) })} />
      )}
      {step.status === 'submitted' && !pending && (
        <MessagePresenter tone="info" message={tr('ws.protocols.step.awaitingDecision', { decider })} />
      )}

      <History d={d} steps={steps} names={names} />

      {/* After what was sent, so a decider reads the record before deciding
          it, and a sender sees what they would take back. */}
      {(pending || can.withdraw_submission_id || can.skip) && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {pending && (
            <Button kind="primary" icon="check" onClick={() => setDeciding(true)} data-testid="decide">
              {tr('ws.protocols.step.decide')}
            </Button>
          )}
          {can.withdraw_submission_id && (
            <Button kind="ghost" icon="undo" busy={withdrawing} onClick={() => void withdraw()}>
              {tr('ws.protocols.step.withdraw')}
            </Button>
          )}
          {can.skip && (
            <Button onClick={() => setSkipping(true)}>
              {tr('ws.protocols.step.skip')}
            </Button>
          )}
        </div>
      )}
      {error != null && (
        <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr(protocolErrorKey(error))}
        </p>
      )}

      {deciding && pending && (
        <DecisionDialog
          kind={run.kind}
          step={step}
          submissionId={pending.id}
          submittedBy={pending.submitted_by_name}
          submittedAt={pending.submitted_at}
          targets={targets}
          proposedCategory={typeof pending.record?.category_id === 'string' ? pending.record.category_id : null}
          onClose={() => setDeciding(false)}
        />
      )}
      {skipping && (
        <ReasonDialog
          title={tr('ws.protocols.step.skipTitle', { step: pickText(locale, step.name_en, step.name_ar) })}
          body={tr('ws.protocols.step.skipBody')}
          confirm={tr('work.protocol.action.skip')}
          onClose={() => setSkipping(false)}
          onSubmit={async (reason) => {
            await appRpc('skip_step', { p_run_step_id: step.id, p_note: reason });
            toast.ok(tr('ws.protocols.step.skipped'));
            await invalidateProtocols(qc);
          }}
        />
      )}
    </div>
  );
}

/**
 * Names the history can put to ids: the sizes and add-ons this step's context
 * read, and a price or promo change's targets with today's price beside each
 * size and add-on, so a decider reads "Large (now 5,000 IQD): 5,500 IQD".
 */
function useNameBook(ctx: StepContexts, steps: readonly StepRow[], targets: Targets | null): NameBook {
  const { tr, locale } = useLocale();
  return useMemo(() => {
    const book: NameBook = {};
    const withPrice = (en: string, ar: string, price: number) => {
      const text = tr('ws.protocols.view.nowPrice', { name: pickText(locale, en, ar), price: formatIQD(price, locale) });
      return { en: text, ar: text };
    };
    for (const i of targets?.items ?? []) {
      book[i.menu_item_id] = { en: i.name_en, ar: i.name_ar };
      for (const v of i.sizes) book[v.variant_id] = withPrice(v.name_en, v.name_ar, v.price_iqd);
    }
    for (const a of targets?.addons ?? []) book[a.modifier_id] = withPrice(`${a.group_name_en} · ${a.name_en}`, `${a.group_name_ar} · ${a.name_ar}`, a.price_delta_iqd);
    for (const p of targets?.promotions ?? []) book[p.promotion_id] = { en: p.name_en, ar: p.name_ar };
    for (const r of targets?.rules ?? []) book[r.rule_id] = { en: r.name, ar: r.name };
    for (const s of ctx.test?.sizes ?? []) book[s.variant_id] = { en: s.name_en, ar: s.name_ar };
    for (const s of ctx.cost?.sizes ?? []) book[s.variant_id] = { en: s.name_en, ar: s.name_ar };
    for (const s of ctx.numbers?.sizes ?? []) if (s.variant_id) book[s.variant_id] = { en: s.name_en, ar: s.name_ar };
    for (const a of ctx.numbers?.addons ?? []) book[a.modifier_id] = { en: `${a.group_name_en} · ${a.name_en}`, ar: `${a.group_name_ar} · ${a.name_ar}` };
    for (const s of steps) book[s.id] = { en: s.name_en, ar: s.name_ar };
    return book;
  }, [ctx, steps, targets, tr, locale]);
}

function History({ d, steps, names }: { d: StepDetail; steps: readonly StepRow[]; names: NameBook }) {
  const { tr, locale } = useLocale();
  const { step, run } = d;
  const rounds = submissionRounds(step);
  const candidates = useCandidates(run.id, run.kind === 'hiring' && step.step_key === 'interviews' && step.submissions.some((s) => s.record !== null));
  const book: NameBook = { ...names };
  for (const c of candidates.data?.candidates ?? []) book[c.id] = { en: c.candidate_name, ar: c.candidate_name };

  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <h4 style={{ margin: 0 }}>{tr('ws.protocols.step.history')}</h4>
      {step.status === 'skipped' && (
        <p style={{ margin: 0 }}>
          {tr('ws.protocols.step.skippedBy', {
            name: isolate(step.skipped_by_name ?? '—'),
            note: isPurged(step.skip_note) ? tr('work.protocol.noteDeleted') : isolate(step.skip_note ?? '—'),
          })}
        </p>
      )}
      {rounds.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.step.nothingSent')}</p>
      ) : (
        rounds.map((r) => (
          <div key={r.round} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
            {rounds.length > 1 && <span style={{ ...muted, fontWeight: 600 }}>{tr('work.protocol.round', { round: formatNumber(r.round, locale) })}</span>}
            {r.submissions.map((s) => (
              <SubmissionCard key={s.id} s={s} d={d} steps={steps} names={book} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function SubmissionCard({ s, d, steps, names }: { s: SubmissionRow; d: StepDetail; steps: readonly StepRow[]; names: NameBook }) {
  const { tr, locale } = useLocale();
  const { step, run } = d;
  const struck = s.withdrawn_at !== null || s.superseded_at !== null;
  let state: ReactNode = null;
  if (s.withdrawn_at) state = <StatusBadge tone="neutral" label={tr('ws.protocols.step.state.withdrawn')} />;
  else if (s.superseded_at) state = <StatusBadge tone="neutral" label={tr('ws.protocols.step.state.superseded')} />;
  else if (s.decision) state = <StatusBadge tone={decisionTone(s.decision)} label={tr(`work.protocol.decision.${s.decision}`)} />;
  else state = <StatusBadge tone="warn" label={tr('ws.protocols.step.state.pending')} />;
  const target = s.send_back_to ? steps.find((x) => x.id === s.send_back_to) : null;

  return (
    <article
      data-testid="submission"
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        padding: 'var(--tp-sp-2-5)',
        borderRadius: 'var(--tp-radius-ctl)',
        // A withdrawn or replaced send keeps full-contrast text (its badge says
        // it no longer counts); only its outline steps back.
        border: `1px ${struck ? 'dashed' : 'solid'} var(--tp-border)`,
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>
          {tr('ws.protocols.step.sentBy', { name: isolate(s.submitted_by_name ?? '—'), date: formatDateTime(new Date(s.submitted_at), locale) })}
        </span>
        {state}
      </div>
      {s.record ? (
        <RecordView kind={run.kind} stepKey={step.step_key} variant={run.variant} record={s.record} names={names} />
      ) : (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.step.hiddenRecord')}</p>
      )}
      {s.photos && s.photos.length > 0 && <PhotoStrip paths={s.photos} title={pickText(locale, step.name_en, step.name_ar)} />}
      {s.decision && s.decision !== 'auto' && (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.protocols.step.decidedBy', {
            decision: tr(`work.protocol.decision.${s.decision}`),
            name: isolate(s.decided_by_name ?? '—'),
            date: s.decided_at ? formatDateTime(new Date(s.decided_at), locale) : '—',
          })}
          {target && target.id !== step.id && ` · ${tr('ws.protocols.step.sentBackTo', { step: pickText(locale, target.name_en, target.name_ar) })}`}
        </p>
      )}
      {s.decision === 'auto' && <p style={{ ...muted, margin: 0 }}>{tr('work.protocol.autoPassed')}</p>}
      {s.decision_note && (
        <blockquote style={{ margin: 0, paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
          <bdi dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
            {isPurged(s.decision_note) ? tr('work.protocol.noteDeleted') : s.decision_note}
          </bdi>
        </blockquote>
      )}
    </article>
  );
}

// ── Sending the step ─────────────────────────────────────────────────────────

function StepSubmit({ d, runDetail, ctx }: { d: StepDetail; runDetail: RunDetail; ctx: StepContexts }) {
  const { run, step } = d;
  if (run.kind === 'tournament' && step.step_key === 'courts') return <ElsewhereAction kind="courts" runId={run.id} stepId={step.id} />;
  if (run.kind === 'hiring' && step.step_key === 'add_staff') return <ElsewhereAction kind="hire" runId={run.id} stepId={step.id} />;
  return <StepSubmitForm d={d} runDetail={runDetail} ctx={ctx} />;
}

/** Two steps are sent from the screen that does the work: the court blocks, and the new account. */
function ElsewhereAction({ kind, runId, stepId }: { kind: 'courts' | 'hire'; runId: string; stepId: string }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const route = kind === 'courts' ? '/desk/block' : '/admin/staff';
  const allowed = canAccess(staff?.role, route);
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <p style={{ margin: 0 }}>{tr(`ws.protocols.elsewhere.${kind}.body`)}</p>
      <div>
        <Button
          kind="primary"
          iconEnd="arrowUpRight"
          disabled={!allowed}
          disabledReason={allowed ? undefined : tr(`ws.protocols.elsewhere.${kind}.notYours`)}
          onClick={() =>
            void (kind === 'courts'
              ? navigate({ to: '/desk/block', search: { run: runId, step: stepId } })
              : navigate({ to: '/admin/staff', search: { hire: stepId } }))
          }
        >
          {tr(`ws.protocols.elsewhere.${kind}.go`)}
        </Button>
      </div>
    </section>
  );
}

function StepSubmitForm({ d, runDetail, ctx }: { d: StepDetail; runDetail: RunDetail; ctx: StepContexts }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { run, step } = d;
  const stepKey = step.step_key;
  const proposal = run.kind === 'price_promo' ? standingRecord(runDetail.steps, 'propose') : null;
  const again = resubmitPrefill(step);
  const change = (typeof again?.record.change === 'string' ? again.record.change : typeof proposal?.change === 'string' ? proposal.change : null) as PriceChangeKind | null;
  const form = stepForm(run.kind, stepKey, { variant: run.variant, change });
  const submitterDecides = decidesStep(staff?.role, step.needs_owner_ok);
  // A manager or the owner covering a step whose actors they are not (§2.7 "Who may act").
  const covering = step.assigned_to !== staff?.id && !(staff?.role && step.actor_roles.includes(staff.role));
  const targetsQ = useTargets(run.kind === 'price_promo' && stepKey === 'propose' ? change : null);
  // The interviews step sends the candidates kept beside it (CandidatesPanel), by id.
  const isInterviews = run.kind === 'hiring' && stepKey === 'interviews';
  const candidatesQ = useCandidates(run.id, isInterviews);
  const interviews = isInterviews ? interviewsRecord(candidatesQ.data?.candidates ?? []) : null;

  const [value, setValue] = useState<Obj>(() => {
    if (!form) return {};
    if (again) return initialValue(form.fields, again.record);
    if (run.kind === 'product_release' && stepKey === 'analysis') return initialValue(form.fields, analysisPrefill(standingRecord(runDetail.steps, 'propose'), []));
    if (run.kind === 'price_promo' && stepKey === 'numbers') return initialValue(form.fields, numbersPrefill(proposal));
    return initialValue(form.fields);
  });
  const [photos, setPhotos] = useState<string[]>(() => again?.photos ?? []);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [key, setKey] = useState(() => mintKey(run.kind === 'product_release' && stepKey === 'launch' ? 'protocol.launch' : 'protocol.submit'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!form) return null;

  const sizes: SizeRow[] | undefined =
    run.kind === 'product_release' && stepKey === 'analysis'
      ? ctx.cost?.sizes.map((s) => ({ variant_id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: null }))
      : run.kind === 'product_release' && stepKey === 'test'
        ? ctx.test?.sizes.map((s) => ({ variant_id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar }))
        : run.kind === 'price_promo' && stepKey === 'numbers' && ctx.numbers
          ? numbersSizes(ctx.numbers)
          : undefined;
  const env: FormEnv = {
    kind: run.kind,
    stepKey,
    variant: run.variant,
    change,
    sizes,
    addons: run.kind === 'price_promo' && stepKey === 'numbers' && ctx.numbers ? numbersAddons(ctx.numbers) : undefined,
    targets: targetsQ.data,
    changeChoices: change ? [change] : [],
    lockTarget: true,
    submitterDecides,
    launchPhotos: launchPhotoChoices(runDetail.steps),
  };

  const current = new Map<string, number | null>((targetsQ.data?.items ?? []).flatMap((i) => i.sizes.map((s) => [s.variant_id, s.price_iqd] as const)));
  const isLaunch = run.kind === 'product_release' && stepKey === 'launch';

  async function send() {
    if (!form) return;
    const record = { ...finalizeRecord(run.kind, stepKey, cleanRecord(form.fields, value), current), ...(interviews?.record ?? {}) };
    const found = validateStep(run.kind, stepKey, record, { variant: run.variant, change }, { photos: form.photosMax > 0 ? photos.length : undefined, submitterDecides });
    // The price step prices every size of the draft (§2.8 release `analysis`).
    if (run.kind === 'product_release' && stepKey === 'analysis' && sizes && Array.isArray(record.prices) && record.prices.length < sizes.length) {
      found.push({ field: 'prices', code: 'RECORD_INVALID' });
    }
    setIssues(found);
    if (found.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = isLaunch
        ? await callEdge<Obj, { auto?: boolean }>(
            'protocol-action',
            { action: 'launch', run_step_id: step.id, when: record.when, at: record.when === 'date' ? record.at : null, photo_path: record.photo_path, idempotency_key: key },
            { ttlMs: 0 },
          )
        : await appRpc<{ auto?: boolean }>('submit_step', { p_run_step_id: step.id, p_record: record, p_photos: form.photosMax > 0 ? photos : [], p_idempotency_key: key });
      toast.ok(tr(res?.auto ? 'ws.protocols.step.sentAuto' : 'ws.protocols.step.sent'));
      setKey(mintKey(isLaunch ? 'protocol.launch' : 'protocol.submit'));
      await invalidateProtocols(qc);
    } catch (e) {
      setError(e);
      if (e instanceof AppRpcError && e.hint && (e.code === 'RECORD_INVALID' || e.code === 'TEXT_TOO_LONG')) {
        setIssues([{ field: e.hint, code: e.code }]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-3)', padding: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-ctl)', border: '1px solid var(--tp-accent)' }} data-testid="step-form">
      <div>
        <h4 style={{ margin: 0 }}>{tr('ws.protocols.step.yourPart')}</h4>
        {again && <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.step.prefilled')}</p>}
        {covering && (
          <p style={{ ...muted, margin: 0 }}>
            {tr('ws.protocols.step.covering', { roles: step.actor_roles.map((r) => tr(`op.roles.${r}`)).join(tr('ws.protocols.view.listJoin')) })}
          </p>
        )}
        {submitterDecides && !isLaunch && <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.step.youDecide')}</p>}
      </div>
      <RecordForm fields={form.fields} value={value} onChange={setValue} issues={issues} env={env} disabled={busy} />
      {interviews && (
        <p style={{ margin: 0, color: interviews.state === 'ready' ? undefined : 'var(--tp-muted-fg)' }} data-testid="interviews-state">
          {interviews.state === 'ready'
            ? tr('ws.protocols.candidates.ready', {
                count: formatNumber(candidatesQ.data?.candidates.length ?? 0, locale),
                name: isolate(candidatesQ.data?.candidates.find((c) => c.picked)?.candidate_name ?? '—'),
              })
            : tr(`ws.protocols.candidates.${interviews.state}First`)}
        </p>
      )}
      {form.photoFolder && form.photosMax > 0 && (
        <PhotoField
          folder={form.photoFolder}
          paths={photos}
          onChange={setPhotos}
          min={form.photosMin}
          max={form.photosMax}
          disabled={busy}
          invalid={issues.some((i) => i.field === 'photos')}
        />
      )}
      {issues.length > 0 && (
        <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.protocols.form.checkMarked')}
        </p>
      )}
      {error != null && (
        <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr(protocolErrorKey(error))}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)' }}>
        <Button
          kind="primary"
          icon="check"
          busy={busy}
          disabled={interviews !== null && interviews.state !== 'ready'}
          disabledReason={interviews && interviews.state !== 'ready' ? tr(`ws.protocols.candidates.${interviews.state}First`) : undefined}
          onClick={() => void send()}
          data-testid="step-send"
        >
          {isLaunch
            ? tr(value.when === 'date' ? 'work.protocol.action.launchOnDate' : 'work.protocol.action.launchNow')
            : run.kind === 'price_promo' && stepKey === 'apply'
              ? tr(value.when === 'date' ? 'work.protocol.action.applyOnDate' : 'work.protocol.action.applyNow')
              : tr('work.protocol.action.submit')}
        </Button>
      </div>
    </section>
  );
}
