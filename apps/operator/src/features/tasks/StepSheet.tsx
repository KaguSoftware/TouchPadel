/**
 * One of my protocol steps, opened from My tasks (build-contracts-2026-09-23
 * §5.4): what the step asks for, what I sent before and what was said about
 * it, its checklist, and the form. The same step the phone's staff-step page
 * shows (§6.1), from the same read (app.protocol_step_detail) and the same
 * field list, so a step half-done on one can be finished on the other.
 *
 * Every button follows the step's `can` answer from the server; nothing here
 * compares roles. Non-management staff never decide a step, so the sheet has
 * no decision dialog: they send, withdraw what they sent, tick the checklist,
 * and a starter may withdraw a run no one has decided on yet.
 *
 * The court desk's courts step is not a form here: the blocks are placed on
 * the desk's own screen (/desk/block?run=&step=, F's event mode), which sends
 * the step and comes back to My tasks.
 *
 * Above the form sits the step's context read, the same panel /protocols
 * shows (§5.4 "its context read", §2.9-§2.13): the tournament plan for the
 * desk's courts and marketing's steps (`tournament_context`; the plan record
 * itself is management's), and the draft's recipe for a head's test
 * (`release_test_context`). The management-only reads stay off here, since
 * no management role opens /tasks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import {
  PRICE_CHANGE_KINDS,
  stepForm,
  validateStep,
  type FieldIssue,
  type PriceChangeKind,
  type ProtocolKind,
  type TournamentVariant,
} from '@touch/core/protocols';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter, StatusBadge, type Tone } from '../../components/kit';
import { PhotoViewer, StaffPhotoThumb } from '../checklists/StaffPhoto';
import { StepContextPanel, useStepContexts } from '../protocols/StepContext';
import { bilingual, isObject, list, num, str } from '../roleExtras/roleExtrasLogic';
import { TK } from './keys';
import { StepFormFields } from './StepFormFields';
import { emptyDraft, fromRecord, toRecord, type Draft } from './formModel';
import { withServerIssue } from './StartSheet';

interface Submission {
  id: string;
  round: number;
  submittedByName: string | null;
  submittedAt: string;
  record: Record<string, unknown> | null;
  photos: string[];
  withdrawnAt: string | null;
  supersededAt: string | null;
  decision: 'approve' | 'auto' | 'send_back' | 'stop' | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface StepView {
  runId: string;
  runStatus: string;
  kind: ProtocolKind;
  variant: TournamentVariant | null;
  titleEn: string | null;
  titleAr: string | null;
  stepId: string;
  stepKey: string | null;
  stepEn: string;
  stepAr: string;
  status: string;
  round: number;
  assignedToName: string | null;
  items: { id: string; textEn: string; textAr: string; doneByName: string | null; doneAt: string | null }[];
  submissions: Submission[];
  can: { submit: boolean; withdrawSubmissionId: string | null; tick: boolean; withdrawRun: boolean };
}

const KINDS = ['product_release', 'tournament', 'hiring', 'price_promo'] as const;
const DECISIONS = ['approve', 'auto', 'send_back', 'stop'] as const;

export function readStepDetail(payload: unknown): StepView | null {
  if (!isObject(payload) || !isObject(payload.run) || !isObject(payload.step)) return null;
  const run = payload.run;
  const step = payload.step;
  const can = isObject(payload.can) ? payload.can : {};
  const variant = run.variant;
  return {
    runId: str(run.id) ?? '',
    runStatus: str(run.status) ?? 'active',
    kind: (KINDS as readonly unknown[]).includes(run.kind) ? (run.kind as ProtocolKind) : 'product_release',
    variant: variant === 'type1' || variant === 'type2' || variant === 'type3' ? variant : null,
    titleEn: str(run.title_en),
    titleAr: str(run.title_ar),
    stepId: str(step.id) ?? '',
    stepKey: str(step.step_key),
    stepEn: str(step.name_en) ?? '',
    stepAr: str(step.name_ar) ?? '',
    status: str(step.status) ?? 'waiting',
    round: num(step.round) ?? 1,
    assignedToName: str(step.assigned_to_name),
    items: list(step.items).map((i) => ({
      id: str(i.id) ?? '',
      textEn: str(i.text_en) ?? '',
      textAr: str(i.text_ar) ?? '',
      doneByName: str(i.done_by_name),
      doneAt: str(i.done_at),
    })),
    submissions: list(step.submissions).map((s) => ({
      id: str(s.id) ?? '',
      round: num(s.round) ?? 1,
      submittedByName: str(s.submitted_by_name),
      submittedAt: str(s.submitted_at) ?? '',
      record: isObject(s.record) ? s.record : null,
      photos: Array.isArray(s.photos) ? s.photos.filter((p): p is string => typeof p === 'string') : [],
      withdrawnAt: str(s.withdrawn_at),
      supersededAt: str(s.superseded_at),
      decision: (DECISIONS as readonly unknown[]).includes(s.decision) ? (s.decision as Submission['decision']) : null,
      decidedByName: str(s.decided_by_name),
      decidedAt: str(s.decided_at),
      decisionNote: str(s.decision_note),
    })),
    can: {
      submit: can.submit === true,
      withdrawSubmissionId: str(can.withdraw_submission_id),
      tick: can.tick === true,
      withdrawRun: can.withdraw_run === true,
    },
  };
}

/** The last thing I sent with a record I can read: a resubmission starts from it. */
export function lastRecord(view: StepView): Submission | null {
  return [...view.submissions].reverse().find((s) => s.record !== null) ?? null;
}

const STEP_TONE: Record<string, Tone> = { open: 'warn', submitted: 'info', passed: 'success', skipped: 'neutral', stopped: 'danger', waiting: 'neutral' };

export function StepSheet({ runStepId, onClose }: { runStepId: string; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const q = useQuery({
    queryKey: TK.step(runStepId),
    queryFn: () => appRpc<unknown>('protocol_step_detail', { p_run_step_id: runStepId }),
  });
  const view = useMemo(() => readStepDetail(q.data), [q.data]);
  const title = view ? bilingual(locale, view.stepEn, view.stepAr) : tr('ws.team.tasks.step.loading');

  return (
    <Modal
      title={title}
      titleAfter={view ? <StatusBadge size="sm" tone={STEP_TONE[view.status] ?? 'neutral'} label={tr(`work.protocol.stepStatus.${view.status as 'open'}`)} /> : undefined}
      subtitle={view ? `${bilingual(locale, view.titleEn, view.titleAr) || tr(`work.protocol.kind.${view.kind}`)} · ${tr(`work.protocol.kind.${view.kind}`)}` : undefined}
      onClose={onClose}
      size="xl"
    >
      {q.isError ? (
        <ErrorText error={q.error} />
      ) : !view ? (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
      ) : (
        <StepBody view={view} onClose={onClose} />
      )}
    </Modal>
  );
}

function StepBody({ view, onClose }: { view: StepView; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const last = lastRecord(view);
  const change: PriceChangeKind | null =
    view.kind === 'price_promo' && last?.record && (PRICE_CHANGE_KINDS as readonly unknown[]).includes(last.record.change)
      ? (last.record.change as PriceChangeKind)
      : null;
  const opts = { variant: view.variant, change };
  const form = useMemo(() => stepForm(view.kind, view.stepKey, opts), [view.kind, view.stepKey, view.variant, change]); // eslint-disable-line react-hooks/exhaustive-deps
  const isCourts = view.kind === 'tournament' && view.stepKey === 'courts';
  const [draft, setDraft] = useState<Draft>(() => (form ? (last?.record ? fromRecord(form.fields, last.record) : emptyDraft(form.fields)) : {}));
  const [photos, setPhotos] = useState<string[]>(() => last?.photos ?? []);
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  const [viewing, setViewing] = useState<string[] | null>(null);
  const key = useRef(`protocol.submit:${crypto.randomUUID()}`);
  const ctx = useStepContexts(view.kind, view.stepKey, view.runId, view.stepId, false);

  // One send is one intent until it lands (§5.3). A send that landed unseen
  // shows up as one more submission, so a new count mints a new key: once it
  // is withdrawn (here or on the phone), the next send is recorded, never
  // answered with the withdrawn one's replay.
  useEffect(() => {
    key.current = `protocol.submit:${crypto.randomUUID()}`;
  }, [view.submissions.length]);

  // A step reopened by a send-back while the sheet is open starts from what was sent.
  useEffect(() => {
    if (form && last?.record) setDraft(fromRecord(form.fields, last.record));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['protocols'] });
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!form) throw new AppRpcError('RECORD_INVALID', 'RECORD_INVALID');
      const record = toRecord(form.fields, draft);
      if (change) record.change = change;
      const found = validateStep(view.kind, view.stepKey, record, opts, { photos: form.photoFolder ? photos.length : undefined });
      setIssues(found);
      if (found.length > 0) throw new AppRpcError('RECORD_INVALID', 'RECORD_INVALID', found[0]!.field);
      return appRpc('submit_step', { p_run_step_id: view.stepId, p_record: record, p_photos: photos, p_idempotency_key: key.current });
    },
    onSuccess: () => {
      key.current = `protocol.submit:${crypto.randomUUID()}`;
      toast.ok(tr('ws.team.tasks.step.sent'));
      refresh();
      onClose();
    },
    onError: (e) => setIssues((cur) => withServerIssue(cur, e)),
  });

  const withdraw = useMutation({
    mutationFn: (submissionId: string) => appRpc('withdraw_step', { p_submission_id: submissionId }),
    onSuccess: () => {
      toast.ok(tr('ws.team.tasks.step.withdrawn'));
      refresh();
    },
  });

  const withdrawRun = useMutation({
    mutationFn: () => appRpc('withdraw_protocol', { p_run_id: view.runId }),
    onSuccess: () => {
      toast.ok(tr('ws.team.tasks.step.runWithdrawn'));
      refresh();
      onClose();
    },
  });

  const tick = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => appRpc('tick_run_item', { p_item_id: v.id, p_done: v.done }),
    onSuccess: refresh,
  });

  const sentBack = [...view.submissions].reverse().find((s) => s.decision === 'send_back' && s.round < view.round + 1);
  const showSentBack = view.status === 'open' && sentBack && sentBack.decisionNote;
  const busy = submit.isPending || withdraw.isPending || withdrawRun.isPending;
  // The round and the assignee, when there is something to say; the run and
  // its kind are already the sheet's subtitle.
  const meta = [
    view.round > 1 ? tr('work.protocol.round', { round: formatNumber(view.round, locale) }) : null,
    view.assignedToName ? tr('ws.team.tasks.step.assignedTo', { name: isolate(view.assignedToName) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {meta && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{meta}</p>}

      {showSentBack && (
        <MessagePresenter
          tone="refused"
          icon="undo"
          message={tr('ws.team.tasks.step.sentBack', { name: isolate(sentBack.decidedByName ?? '—'), note: isolate(sentBack.decisionNote ?? '') })}
        />
      )}

      <StepContextPanel ctx={ctx} />

      {view.items.length > 0 && (
        <section style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr('ws.team.tasks.step.checklist')}</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {view.items.map((item) => (
              <li key={item.id}>
                <label style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', cursor: view.can.tick ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={item.doneAt !== null}
                    disabled={!view.can.tick || tick.isPending}
                    onChange={(e) => tick.mutate({ id: item.id, done: e.target.checked })}
                    data-testid={`item.${item.id}`}
                  />
                  <span>
                    <bdi>{bilingual(locale, item.textEn, item.textAr)}</bdi>
                    {item.doneAt && (
                      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                        {' · '}
                        {tr('ws.team.tasks.step.tickedBy', { name: isolate(item.doneByName ?? '—'), time: formatDateTime(new Date(item.doneAt), locale) })}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <ErrorText error={tick.error} />
        </section>
      )}

      {view.submissions.length > 0 && (
        <section style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr('ws.team.tasks.step.history')}</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {view.submissions.map((s) => (
              <li key={s.id} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {tr('ws.team.tasks.step.sentAt', { name: isolate(s.submittedByName ?? '—'), time: s.submittedAt ? formatDateTime(new Date(s.submittedAt), locale) : '' })}
                </span>
                <StatusBadge size="sm" tone={submissionTone(s)} label={submissionLabel(s, tr)} />
                {s.photos.length > 0 && (
                  <StaffPhotoThumb path={s.photos[0]!} label={tr('ws.team.tasks.photos.photo', { n: formatNumber(1, locale) })} onClick={() => setViewing(s.photos)} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isCourts && view.can.submit ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <p>{tr('ws.team.tasks.step.courtsLead')}</p>
          <Button kind="primary" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/desk/block', search: { run: view.runId, step: view.stepId } })} data-testid="step.courts">
            {tr('ws.team.tasks.step.courtsOpen')}
          </Button>
        </div>
      ) : view.can.submit && form ? (
        <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr(last ? 'ws.team.tasks.step.formAgain' : 'ws.team.tasks.step.form')}</h3>
          <StepFormFields
            kind={view.kind}
            stepKey={view.stepKey}
            form={form}
            variant={view.variant}
            change={change}
            changeLocked
            runId={view.runId}
            draft={draft}
            onDraft={setDraft}
            photos={photos}
            onPhotos={setPhotos}
            issues={issues}
            disabled={busy}
          />
          {issues.length > 0 && <MessagePresenter tone="refused" message={tr('ws.team.tasks.form.issuesSummary')} />}
          {submit.error && !(submit.error instanceof AppRpcError && submit.error.code === 'RECORD_INVALID' && issues.length > 0) && <ErrorText error={submit.error} />}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button kind="primary" icon="check" busy={submit.isPending} disabled={busy} onClick={() => submit.mutate()} data-testid="step.submit">
              {tr(last ? 'ws.team.tasks.step.sendAgain' : 'ws.team.tasks.step.send')}
            </Button>
          </div>
        </section>
      ) : view.status === 'submitted' ? (
        <MessagePresenter tone="info" message={tr('ws.team.tasks.step.awaiting')} />
      ) : view.status === 'open' ? (
        <MessagePresenter tone="info" message={tr('ws.team.tasks.step.notYours')} />
      ) : null}

      {(view.can.withdrawSubmissionId || view.can.withdrawRun) && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-3)' }}>
          {view.can.withdrawSubmissionId && (
            <Button busy={withdraw.isPending} disabled={busy} icon="undo" onClick={() => withdraw.mutate(view.can.withdrawSubmissionId!)} data-testid="step.withdraw">
              {tr('ws.team.tasks.step.withdraw')}
            </Button>
          )}
          {view.can.withdrawRun && (
            <Button
              kind="danger"
              busy={withdrawRun.isPending}
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: tr('ws.team.tasks.step.withdrawRunTitle'),
                  body: tr('ws.team.tasks.step.withdrawRunBody'),
                  confirmLabel: tr('ws.team.tasks.step.withdrawRun'),
                  kind: 'danger',
                });
                if (ok) withdrawRun.mutate();
              }}
              data-testid="step.withdraw-run"
            >
              {tr('ws.team.tasks.step.withdrawRun')}
            </Button>
          )}
          <ErrorText error={withdraw.error ?? withdrawRun.error} />
        </div>
      )}
      {viewing && <PhotoViewer title={tr('ws.team.tasks.photos.label')} paths={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function submissionTone(s: Submission): Tone {
  if (s.withdrawnAt || s.supersededAt) return 'neutral';
  if (s.decision === 'approve' || s.decision === 'auto') return 'success';
  if (s.decision === 'send_back') return 'warn';
  if (s.decision === 'stop') return 'danger';
  return 'info';
}

function submissionLabel(s: Submission, tr: ReturnType<typeof useLocale>['tr']): string {
  if (s.withdrawnAt) return tr('ws.team.tasks.step.status.withdrawn');
  if (s.supersededAt) return tr('ws.team.tasks.step.status.superseded');
  if (s.decision) return tr(`work.protocol.decision.${s.decision}`);
  return tr('work.protocol.stepStatus.submitted');
}
