/**
 * The run sheet (build-contracts-2026-09-23 §5.4): one protocol from start to
 * finish. On the start side, the steps in order with where each one stands;
 * on the end side, the chosen step (StepPanel) with its form and decision.
 * Below the steps, what a new item gathers after its launch: marketing's
 * take, the team's notes, and the day-30 review (management only, which this
 * page already is, #54).
 *
 * The run's own actions follow `can`: Stop (management, a reason required),
 * Withdraw (the starter, before any decision), Cancel the date (a scheduled
 * launch or apply). The owner's changes to this one run (`editProtocols`,
 * Q11) sit on the steps: a checklist, and a step of their own.
 *
 * A done tournament run offers "Publish as tournament" to management
 * (tournaments build contracts §1.6 publish), which opens PublishDialog.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VENUE_TZ, formatDate, formatDateTime, formatIQD, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import type { StepRow } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { can as canDo, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { PublishDialog } from '../tournaments/PublishDialog';
import { canOfferPublish } from '../tournaments/publishLogic';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal } from '../../components/ui';
import { ReviewList, StepWizard, type WizardAt, type WizardStep } from '../../components/StepWizard';
import { AsyncStateWrapper, StatusBadge, asyncStatus } from '../../components/kit';
import { invalidateProtocols, stepDetailQuery, useRunDetail } from './api';
import { ReasonDialog } from './DecisionDialog';
import { PK } from './keys';
import { PhotoStrip } from './PhotoField';
import {
  LOCK_UNOPENED_STEPS,
  addStepAfterChoices,
  defaultStep,
  isObj,
  itemsEditable,
  pickText,
  runStatusTone,
  stepStatusTone,
  type RunDetail,
} from './protocolLogic';
import { AddStepDialog, EditItemsDialog } from './RunEdits';
import { SendSlot } from './ReleaseSteps';
import { StepMeta, StepPanel } from './StepPanel';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function RunSheet({ runId, stepId, onStep, onClose }: { runId: string; stepId: string | null; onStep: (id: string) => void; onClose: () => void }) {
  const { tr } = useLocale();
  const q = useRunDetail(runId);
  const d = q.data;
  // Loaded: the run is the stepped dialog every "add new" form uses. Until
  // then (or when it fails to load) the plain dialog carries the wait and retry.
  if (d) return <RunWizard d={d} stepId={stepId} onStep={onStep} onClose={onClose} />;
  return (
    <Modal title={tr('ws.protocols.run.loading')} onClose={onClose} size="xl">
      <AsyncStateWrapper status={asyncStatus(q, () => false)} error={q.error} onRetry={() => void q.refetch()}>
        {null}
      </AsyncStateWrapper>
    </Modal>
  );
}

function RunWizard({ d, stepId, onStep, onClose }: { d: RunDetail; stepId: string | null; onStep: (id: string) => void; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const { run, steps } = d;
  const title = pickText(locale, run.title_en, run.title_ar) || tr(`work.protocol.kind.${run.kind}`);
  const selected = stepId && steps.some((s) => s.id === stepId) ? stepId : defaultStep(steps);
  const index = Math.max(0, steps.findIndex((s) => s.id === selected));
  const [summary, setSummary] = useState(false);
  // Where a release step's green "Send this step" is drawn: the wizard's footer.
  const [sendSlot, setSendSlot] = useState<HTMLElement | null>(null);
  const at: WizardAt = summary ? 'review' : index;
  const acts = useRunActions(d);
  // Every step is read up front, so moving between steps shows each one at once instead of a loading flash.
  const qc = useQueryClient();
  const stepIds = steps.map((s) => s.id).join(',');
  useEffect(() => {
    for (const id of stepIds.split(',')) if (id) void qc.prefetchQuery({ ...stepDetailQuery(id), staleTime: 15_000 });
  }, [qc, stepIds]);

  const wizardSteps: WizardStep[] = steps.map((s) => ({
    key: s.id,
    label: pickText(locale, s.name_en, s.name_ar),
    done: s.status === 'passed' || s.status === 'skipped',
    locked: LOCK_UNOPENED_STEPS && s.status === 'waiting',
    badge: (
      <>
        {!(LOCK_UNOPENED_STEPS && s.status === 'waiting') && <StatusBadge tone={stepStatusTone(s.status)} label={tr(`work.protocol.stepStatus.${s.status}`)} />}
        <StepMeta step={s} />
      </>
    ),
    status: (
      <>
        {tr(`work.protocol.stepStatus.${s.status}`)}
        {s.round > 1 && ` · ${tr('work.protocol.round', { round: formatNumber(s.round, locale) })}`}
        {s.step_key === null && ` · ${tr('ws.protocols.run.ownStep')}`}
      </>
    ),
    content: (
      <>
        {acts.editItemsFor(s)}
        <StepPanel key={s.id} stepId={s.id} run={d} titled={false} />
      </>
    ),
  }));

  return (
    <SendSlot.Provider value={sendSlot}>
      <StepWizard
        title={title}
        eyebrow={[tr(`work.protocol.kind.${run.kind}`), run.variant ? tr(`work.protocol.variant.${run.variant}`) : null].filter(Boolean).join(' · ')}
        lead={
          <span style={{ display: 'grid', gap: 'var(--tp-sp-4)', justifyItems: 'start' }}>
            <span>
              {tr('ws.protocols.run.startedByShort', { name: isolate(run.started_by_name ?? '—') })} · {formatDate(new Date(run.started_at), locale)}
            </span>
            {acts.actions}
          </span>
        }
        progressAfter={<StatusBadge size="sm" tone={runStatusTone(run.status)} label={tr(`work.protocol.runStatus.${run.status}`)} />}
        testId="run-sheet"
        steps={wizardSteps}
        at={at}
        onAtChange={(next) => {
          if (next === 'review') {
            setSummary(true);
            return;
          }
          setSummary(false);
          const s = steps[next];
          if (s) onStep(s.id);
        }}
        footerStart={acts.stopButton}
        footerEnd={<span ref={setSendSlot} style={{ display: 'contents' }} />}
        reviewLabel={tr('ws.protocols.run.summary')}
        reviewLead={tr('ws.protocols.run.summaryLead')}
        review={(goTo) => (
          <>
            <ReviewList
              goTo={goTo}
              rows={steps.map((s) => ({
                label: pickText(locale, s.name_en, s.name_ar),
                value: tr(`work.protocol.stepStatus.${s.status}`),
                step: s.id,
              }))}
            />
            {acts.dates.length > 0 && <p style={{ ...muted, margin: 0 }}>{acts.dates.join(' · ')}</p>}
            {acts.addStep}
            {run.kind === 'product_release' && <ReleaseExtras d={d} />}
          </>
        )}
        notice={acts.error != null ? <ErrorText error={acts.error} /> : undefined}
        submitLabel={tr('common.close')}
        onSubmit={onClose}
        onClose={onClose}
      />
      {acts.dialogs}
    </SendSlot.Provider>
  );
}

/**
 * The run's own actions and the dialogs they open, gathered for the wizard
 * around the steps: Stop, Withdraw, Cancel the date, Publish (the side
 * column), the owner's checklist and extra step (the step and Summary pages).
 * Every one follows `can`, as before; only where it sits changed.
 */
function useRunActions(d: RunDetail) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  // The owner (the only role that edits protocols) stops without a reason (0361, 0391).
  const ownerStops = canDo(staff, 'editProtocols');
  const [stopping, setStopping] = useState(false);
  const [editing, setEditing] = useState<StepRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { run, steps, can } = d;
  const owner = canDo(staff, 'editProtocols');
  const lastKey = steps[steps.length - 1]?.step_key ?? null;
  const afterChoices = owner && can.add_step ? addStepAfterChoices(steps, lastKey) : [];
  const offerPublish = canOfferPublish(run, canDo(staff, 'publishTournaments'));
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings, enabled: offerPublish });

  async function act(tag: string, fn: () => Promise<unknown>, done: MessageKey) {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      toast.ok(tr(done));
      await invalidateProtocols(qc);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const dates = [
    run.scheduled_for && run.status === 'scheduled' ? tr('ws.protocols.run.scheduledFor', { date: formatDateTime(new Date(run.scheduled_for), locale) }) : null,
    run.live_at ? tr('ws.protocols.run.liveAt', { date: formatDateTime(new Date(run.live_at), locale) }) : null,
    run.finished_at ? tr('ws.protocols.run.finishedAt', { date: formatDateTime(new Date(run.finished_at), locale) }) : null,
  ].filter((x): x is string => x !== null);

  const actions =
    can.withdraw_run || can.cancel_schedule || offerPublish ? (
      <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
        {offerPublish && (
          <Button size="sm" kind="primary" icon="trophy" onClick={() => setPublishing(true)}>
            {tr('ws.tournaments.publish.action')}
          </Button>
        )}
        {can.cancel_schedule && (
          <Button
            size="sm"
            icon="undo"
            busy={busy === 'unschedule'}
            onClick={async () => {
              // F-61: cancelling the date asks first.
              const ok = await confirm({
                title: tr('ws.protocols.run.unscheduleTitle'),
                body: tr('ws.protocols.run.unscheduleBody'),
                confirmLabel: tr('ws.protocols.run.unscheduleConfirm'),
                kind: 'danger',
              });
              if (ok) void act('unschedule', () => appRpc('cancel_schedule', { p_run_id: run.id }), 'ws.protocols.run.unscheduled');
            }}
          >
            {tr('work.protocol.action.cancelSchedule')}
          </Button>
        )}
        {can.withdraw_run && (
          <Button
            size="sm"
            kind="ghost"
            busy={busy === 'withdraw'}
            onClick={async () => {
              const ok = await confirm({ title: tr('ws.protocols.run.withdrawTitle'), body: tr('ws.protocols.run.withdrawBody'), confirmLabel: tr('work.protocol.action.withdraw'), kind: 'danger' });
              if (ok) void act('withdraw', () => appRpc('withdraw_protocol', { p_run_id: run.id }), 'ws.protocols.run.withdrawn');
            }}
          >
            {tr('ws.protocols.run.withdraw')}
          </Button>
        )}
      </span>
    ) : null;

  // The way in to a stop, not the stop: it sits in the dialog's footer, where
  // Back used to be, in red. The reason prompt it opens is the red one too.
  const stopButton = can.stop ? (
    <Button size="lg" kind="danger" icon="ban" onClick={() => setStopping(true)}>
      {tr('ws.protocols.run.stop')}
    </Button>
  ) : (
    <span />
  );

  const editItemsFor = (s: StepRow) =>
    owner && can.edit_items && itemsEditable(s.status) ? (
      <div>
        <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing(s)}>
          {s.items.length > 0 ? tr('ws.protocols.edits.editItems', { count: formatNumber(s.items.length, locale) }) : tr('ws.protocols.edits.addItems')}
        </Button>
      </div>
    ) : null;

  const addStep =
    afterChoices.length > 0 ? (
      <div>
        <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
          {tr('ws.protocols.edits.addStep')}
        </Button>
      </div>
    ) : null;

  const dialogs = (
    <>
      {publishing && <PublishDialog runId={run.id} data={run.data} tz={settingsQ.data?.timezone ?? VENUE_TZ} onClose={() => setPublishing(false)} />}
      {stopping && (
        <ReasonDialog
          title={tr('ws.protocols.run.stopTitle')}
          // F-61 (Majed): the owner stops without a reason; a manager says why.
          body={tr(ownerStops ? 'ws.protocols.run.stopBodyOwner' : 'ws.protocols.run.stopBody')}
          confirm={tr('ws.protocols.run.stop')}
          optional={ownerStops}
          danger
          onClose={() => setStopping(false)}
          onSubmit={async (reason) => {
            await appRpc('stop_protocol', { p_run_id: run.id, p_note: reason === '' ? null : reason });
            toast.ok(tr('ws.protocols.run.stopped'));
            await invalidateProtocols(qc);
          }}
        />
      )}
      {editing && <EditItemsDialog step={editing} onClose={() => setEditing(null)} />}
      {adding && <AddStepDialog runId={run.id} after={afterChoices} onClose={() => setAdding(false)} />}
    </>
  );

  return { actions, stopButton, dates, addStep, editItemsFor, dialogs, error };
}

// ── After a launch ───────────────────────────────────────────────────────────

interface Note {
  id: string;
  author_name: string | null;
  body: string;
  created_at: string;
  photos?: string[];
}

function readNotes(raw: unknown): Note[] {
  const list = isObj(raw) && Array.isArray(raw.notes) ? raw.notes.filter(isObj) : [];
  return list.map((n) => ({
    id: String(n.id ?? ''),
    author_name: typeof n.author_name === 'string' ? n.author_name : null,
    body: typeof n.body === 'string' ? n.body : '',
    created_at: typeof n.created_at === 'string' ? n.created_at : '',
    photos: Array.isArray(n.photos) ? n.photos.filter((p): p is string => typeof p === 'string') : [],
  }));
}

/** What a new item gathers once it runs: marketing's take, the team's notes, the day-30 review. */
function ReleaseExtras({ d }: { d: RunDetail }) {
  const { tr } = useLocale();
  const { run } = d;
  const launched = run.status === 'live' || run.status === 'done';
  const take = useQuery({
    queryKey: PK.context('marketingTake', run.id),
    queryFn: async () => {
      const [onRun, onItem] = await Promise.all([
        appRpc<unknown>('marketing_notes_for', { p_subject_kind: 'run', p_subject_id: run.id }),
        run.menu_item_id ? appRpc<unknown>('marketing_notes_for', { p_subject_kind: 'item', p_subject_id: run.menu_item_id }) : Promise.resolve(null),
      ]);
      return [...readNotes(onRun), ...readNotes(onItem)];
    },
  });
  const notes = useQuery({
    queryKey: PK.context('notes', run.id),
    enabled: launched && Boolean(run.menu_item_id),
    queryFn: async () => readNotes(await appRpc<unknown>('release_notes_for_item', { p_menu_item_id: run.menu_item_id })),
  });
  const review = useQuery({
    queryKey: PK.review(run.id),
    enabled: launched,
    queryFn: () => appRpc<unknown>('release_review', { p_run_id: run.id }),
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-2)' }}>
      <NotesBlock title={tr('ws.protocols.run.marketingTake')} empty={tr('ws.protocols.run.noTake')} notes={take.data ?? []} error={take.error} />
      {launched && <NotesBlock title={tr('ws.protocols.run.teamNotes')} empty={tr('ws.protocols.run.noNotes')} notes={notes.data ?? []} error={notes.error} />}
      {launched && <ReviewBlock raw={review.data} />}
    </div>
  );
}

function NotesBlock({ title, empty, notes, error }: { title: string; empty: string; notes: Note[]; error: unknown }) {
  const { locale } = useLocale();
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>{title}</h4>
      {error != null ? (
        <ErrorText error={error} style={{ marginBlock: 0 }} />
      ) : notes.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {notes.map((n) => (
            <li key={n.id} style={{ display: 'grid', gap: 'var(--tp-sp-0)', fontSize: 'var(--tp-fs-sm)' }}>
              <bdi dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                {n.body}
              </bdi>
              <span style={muted}>
                {n.author_name ? `${n.author_name} · ` : ''}
                {n.created_at ? formatDate(new Date(n.created_at), locale) : ''}
              </span>
              {n.photos && n.photos.length > 0 && <PhotoStrip paths={n.photos} title={title} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The day-30 review: its figures and the written summary, in the reader's language. */
function ReviewBlock({ raw }: { raw: unknown }) {
  const { tr, locale } = useLocale();
  const r = isObj(raw) ? raw : null;
  const numbers = r && isObj(r.numbers) ? r.numbers : null;
  const writeUp = r && isObj(r.write_up) ? r.write_up : null;
  const text = writeUp ? (locale === 'ar' ? writeUp.ar : writeUp.en) : null;
  const n = (k: string) => (numbers && typeof numbers[k] === 'number' ? (numbers[k] as number) : null);
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="release-review">
      <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.run.review')}</h4>
      {!r ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.run.reviewNotYet')}</p>
      ) : (
        <>
          {numbers && (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.protocols.run.reviewFigures', {
                units: formatNumber(n('units') ?? 0, locale),
                days: formatNumber(n('days_sold') ?? 0, locale),
                revenue: formatIQD(n('revenue_iqd') ?? 0, locale),
              })}
              {' · '}
              {n('margin_pct') === null ? tr('ws.protocols.run.reviewNoMargin') : tr('ws.protocols.run.reviewMargin', { margin: formatNumber(n('margin_pct')!, locale) })}
            </p>
          )}
          {typeof text === 'string' && text.trim() !== '' ? (
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--tp-fs-sm)' }}>{text}</p>
          ) : (
            <p style={{ ...muted, margin: 0 }}>{tr(`ws.protocols.run.reviewStatus.${String(r.status) === 'failed' ? 'failed' : 'thin'}` as MessageKey)}</p>
          )}
        </>
      )}
    </section>
  );
}
