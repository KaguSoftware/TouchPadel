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
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatDateTime, formatIQD, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import type { StepRow } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { can as canDo, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, StatusBadge, asyncStatus } from '../../components/kit';
import { invalidateProtocols, useRunDetail } from './api';
import { ReasonDialog } from './DecisionDialog';
import { protocolErrorKey } from './errors';
import { PK } from './keys';
import { PhotoStrip } from './PhotoField';
import {
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
import { StepPanel } from './StepPanel';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function RunSheet({ runId, stepId, onStep, onClose }: { runId: string; stepId: string | null; onStep: (id: string) => void; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const q = useRunDetail(runId);
  const d = q.data;
  const title = d ? pickText(locale, d.run.title_en, d.run.title_ar) || tr(`work.protocol.kind.${d.run.kind}`) : tr('ws.protocols.run.loading');
  const selected = stepId && d?.steps.some((s) => s.id === stepId) ? stepId : d ? defaultStep(d.steps) : null;
  return (
    <Modal
      title={title}
      titleAfter={d ? <StatusBadge tone={runStatusTone(d.run.status)} label={tr(`work.protocol.runStatus.${d.run.status}`)} /> : undefined}
      subtitle={
        d
          ? [
              tr(`work.protocol.kind.${d.run.kind}`),
              d.run.variant ? tr(`work.protocol.variant.${d.run.variant}`) : null,
              tr('ws.protocols.run.startedBy', { name: isolate(d.run.started_by_name ?? '—'), date: formatDate(new Date(d.run.started_at), locale) }),
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      onClose={onClose}
      size="xl"
    >
      <AsyncStateWrapper status={asyncStatus(q, () => false)} error={q.error} onRetry={() => void q.refetch()}>
        {d && <RunBody d={d} selected={selected} onStep={onStep} />}
      </AsyncStateWrapper>
    </Modal>
  );
}

function RunBody({ d, selected, onStep }: { d: RunDetail; selected: string | null; onStep: (id: string) => void }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [stopping, setStopping] = useState(false);
  const [editing, setEditing] = useState<StepRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { run, steps, can } = d;
  const owner = canDo(staff?.role, 'editProtocols');
  const lastKey = steps[steps.length - 1]?.step_key ?? null;
  const afterChoices = owner && can.add_step ? addStepAfterChoices(steps, lastKey) : [];

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

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="run-sheet">
      {(dates.length > 0 || can.stop || can.withdraw_run || can.cancel_schedule) && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span style={muted}>{dates.join(' · ')}</span>
          <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
            {can.cancel_schedule && (
              <Button
                size="sm"
                icon="undo"
                busy={busy === 'unschedule'}
                onClick={() => void act('unschedule', () => appRpc('cancel_schedule', { p_run_id: run.id }), 'ws.protocols.run.unscheduled')}
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
            {can.stop && (
              <Button size="sm" kind="danger" icon="ban" onClick={() => setStopping(true)}>
                {tr('ws.protocols.run.stop')}
              </Button>
            )}
          </span>
        </div>
      )}
      {error != null && (
        <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr(protocolErrorKey(error))}
        </p>
      )}

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'minmax(15rem, 20rem) minmax(0, 1fr)', alignItems: 'start' }}>
        <nav aria-label={tr('ws.protocols.run.steps')} style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {steps.map((s, i) => {
              const on = s.id === selected;
              return (
                <li key={s.id} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                  <button
                    type="button"
                    aria-current={on ? 'step' : undefined}
                    onClick={() => onStep(s.id)}
                    data-testid="run-step"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: 'var(--tp-sp-0) var(--tp-sp-2)',
                      alignItems: 'center',
                      textAlign: 'start',
                      padding: 'var(--tp-sp-2)',
                      borderRadius: 'var(--tp-radius-ctl)',
                      border: `1px solid ${on ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                      background: on ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
                      color: 'var(--tp-fg)',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        gridRow: 'span 2',
                        inlineSize: '1.6rem',
                        blockSize: '1.6rem',
                        borderRadius: 'var(--tp-radius-pill)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 'var(--tp-fs-sm)',
                        fontWeight: 700,
                        background: 'var(--tp-surface-2)',
                      }}
                    >
                      {formatNumber(i + 1, locale)}
                    </span>
                    <span style={{ fontWeight: 600 }}>{pickText(locale, s.name_en, s.name_ar)}</span>
                    <span style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <StatusBadge size="sm" tone={stepStatusTone(s.status)} label={tr(`work.protocol.stepStatus.${s.status}`)} />
                      {s.round > 1 && <span style={muted}>{tr('work.protocol.round', { round: formatNumber(s.round, locale) })}</span>}
                      {s.step_key === null && <span style={muted}>{tr('ws.protocols.run.ownStep')}</span>}
                    </span>
                  </button>
                  {on && owner && can.edit_items && itemsEditable(s.status) && (
                    <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing(s)} style={{ justifySelf: 'start' }}>
                      {s.items.length > 0 ? tr('ws.protocols.edits.editItems', { count: formatNumber(s.items.length, locale) }) : tr('ws.protocols.edits.addItems')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
          {afterChoices.length > 0 && (
            <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
              {tr('ws.protocols.edits.addStep')}
            </Button>
          )}
          {run.kind === 'product_release' && <ReleaseExtras d={d} />}
        </nav>
        <div style={{ minInlineSize: 0 }}>
          {selected ? <StepPanel key={selected} stepId={selected} run={d} /> : <EmptyState compact title={tr('ws.protocols.run.pickStep')} />}
        </div>
      </div>

      {stopping && (
        <ReasonDialog
          title={tr('ws.protocols.run.stopTitle')}
          body={tr('ws.protocols.run.stopBody')}
          confirm={tr('ws.protocols.run.stop')}
          danger
          onClose={() => setStopping(false)}
          onSubmit={async (reason) => {
            await appRpc('stop_protocol', { p_run_id: run.id, p_note: reason });
            toast.ok(tr('ws.protocols.run.stopped'));
            await invalidateProtocols(qc);
          }}
        />
      )}
      {editing && <EditItemsDialog step={editing} onClose={() => setEditing(null)} />}
      {adding && <AddStepDialog runId={run.id} after={afterChoices} onClose={() => setAdding(false)} />}
    </div>
  );
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
    retry: false,
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
    retry: false,
    queryFn: async () => readNotes(await appRpc<unknown>('release_notes_for_item', { p_menu_item_id: run.menu_item_id })),
  });
  const review = useQuery({
    queryKey: PK.review(run.id),
    enabled: launched,
    retry: false,
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
