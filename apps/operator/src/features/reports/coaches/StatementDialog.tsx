/**
 * One coach statement (docs/design/coaching/operator.md §5.16), from
 * app.coach_statement_detail: the figures, every line with its lesson (R24;
 * an adjustment line is marked), the stale-draft line, the coach-booked
 * no-shows (C-24, R56, R72), who approved and paid it, and the actions the
 * statement offers (`statementActions`).
 *
 * - draft: Recount (coach_statement_refresh), Approve (a confirm, no PIN, R4),
 *   Void (no PIN);
 * - approved: Mark paid (reference, then a manager PIN), Void (a manager PIN,
 *   R59); Mark paid is off below zero;
 * - void: Redraft (coach_statement_refresh, which answers the new draft);
 * - paid: nothing.
 *
 * Every `can` false on a live statement is the caller's own (CM-11): it says
 * so instead of offering anything. Every statement write is online-only (CD-6)
 * and a refusal is shown in place with its §5.19 line.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatPercent, isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { useStationReach } from '../../../lib/stationReach';
import { useToast } from '../../../components/toast';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Modal, Skeleton } from '../../../components/ui';
import { DataTable, MessagePresenter, StatusBadge, type Column } from '../../../components/kit';
import {
  readStatementApproved,
  readStatementRefreshed,
  type StatementLine,
  type StatementRow,
} from '../../coaching/lessonPayloads';
import { coachingErrorText, statementStatusKey } from '../../coaching/lessonLogic';
import { LessonReadNotice } from '../../coaching/LessonReadNotice';
import {
  invalidateStatement,
  useCoachingCaps,
  useLessonRead,
  useStatementDetail,
} from '../../coaching/useCoaching';
import {
  coachOf,
  countText,
  lineLessonParts,
  maybeNegativeMoneyText,
  moneyText,
  signedMoneyText,
  statementActions,
  statementTone,
  type StatementActionKey,
} from './statementsLogic';
import { MarkPaidDialog } from './MarkPaidDialog';
import { VoidStatementDialog } from './VoidStatementDialog';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function StatementDialog({
  statementId,
  fallback,
  monthText,
  onClose,
}: {
  statementId: string;
  /** The list row, shown in the title while the detail loads. */
  fallback: StatementRow;
  /** "October 2026", for the title and the approve question. */
  monthText: string;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const caps = useCoachingCaps();
  const { branchId: railBranch } = useVenue();
  const { reachable } = useStationReach();
  // A redraft answers a new statement: the dialog follows it.
  const [id, setId] = useState(statementId);
  const q = useStatementDetail(id);
  const read = useLessonRead(q);
  const [busy, setBusy] = useState<StatementActionKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [approving, setApproving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const detail = read.kind === 'ready' ? read.data : null;
  const s = detail?.statement ?? fallback;
  const coach = coachOf(s, locale);
  const plan = statementActions({ statement: s, can: detail?.can ?? null }, caps, railBranch);
  const offline = !reachable;

  function done(key: StatementActionKey, next?: string | null) {
    invalidateStatement(qc, id);
    if (next && next !== id) {
      invalidateStatement(qc, next);
      setId(next);
    }
    toast.ok(tr(`ws.coaching.coachPay.actions.done.${key}`));
  }

  async function refresh(key: 'recount' | 'redraft') {
    setBusy(key);
    setError(null);
    try {
      const r = readStatementRefreshed(
        await appRpc('coach_statement_refresh', { p_statement_id: id }),
      );
      done(key, r.statement_id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy('approve');
    setError(null);
    try {
      readStatementApproved(await appRpc('coach_statement_approve', { p_statement_id: id }));
      setApproving(false);
      done('approve');
    } catch (e) {
      setApproving(false);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  function press(key: StatementActionKey) {
    setError(null);
    if (key === 'recount' || key === 'redraft') void refresh(key);
    else if (key === 'approve') setApproving(true);
    else if (key === 'markPaid') setPaying(true);
    else setVoiding(true);
  }

  const amount = maybeNegativeMoneyText(s.total_iqd, locale);
  const errorText = error ? coachingErrorText(error, tr, { amount }, { scope: 'statement' }) : null;
  const blocked = plan.actions.some((a) => a.blocked === 'negative');

  return (
    <Modal
      title={tr('ws.coaching.coachPay.dialog.title', { coach: isolate(coach), month: monthText })}
      titleAfter={
        <StatusBadge
          size="sm"
          tone={statementTone(s.status)}
          label={statementStatusKey(s.status) ? tr(statementStatusKey(s.status)!) : s.status}
        />
      }
      size="lg"
      dismissible={busy === null}
      onClose={onClose}
      footer={
        plan.actions.length > 0 ? (
          <div
            style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', inlineSize: '100%' }}
          >
            {plan.actions.map((a) => (
              <Button
                key={a.key}
                kind={
                  a.key === 'void'
                    ? 'ghost'
                    : a.key === 'recount' || a.key === 'redraft'
                      ? 'default'
                      : 'primary'
                }
                icon={ACTION_ICON[a.key]}
                busy={busy === a.key}
                disabled={offline || a.blocked !== null || busy !== null}
                disabledReason={
                  offline
                    ? tr('ws.coaching.offline.needsConnection')
                    : a.blocked === 'negative'
                      ? tr('ws.coaching.errors.negativeStatement', { amount })
                      : undefined
                }
                title={
                  a.key === 'recount'
                    ? tr('ws.coaching.coachPay.actions.recountHint')
                    : a.key === 'redraft'
                      ? tr('ws.coaching.coachPay.actions.redraftHint')
                      : undefined
                }
                onClick={() => press(a.key)}
                data-testid={`statement.action.${a.key}`}
              >
                {tr(`ws.coaching.coachPay.actions.${a.key}`)}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    >
      {read.kind === 'loading' ? (
        <Skeleton lines={6} />
      ) : read.kind === 'failed' ? (
        <LessonReadNotice status={read} onRetry={() => void q.refetch()} />
      ) : read.kind === 'absent' || !detail ? (
        <MessagePresenter tone="info" message={tr('ws.coaching.coachPay.dialog.notFound')} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <LessonReadNotice status={read} onRetry={() => void q.refetch()} />
          <Figures statement={s} />

          {plan.readOnly === 'ownStatement' && (
            <MessagePresenter tone="info" message={tr('ws.coaching.errors.ownStatement')} />
          )}
          {s.status === 'draft' && detail.stale && (
            <MessagePresenter
              tone="info"
              icon="refresh"
              message={tr('ws.coaching.coachPay.dialog.stale')}
            />
          )}
          {blocked && (
            <MessagePresenter
              tone="refused"
              message={tr('ws.coaching.errors.negativeStatement', { amount })}
            />
          )}
          <StatementHistory statement={s} />

          <ErrorText error={error} message={errorText} style={{ marginBlock: 0 }} />

          <section aria-label={tr('ws.coaching.coachPay.dialog.lines')}>
            <h3
              style={{
                margin: 0,
                marginBlockEnd: 'var(--tp-sp-1)',
                fontSize: 'var(--tp-fs-sm)',
                fontWeight: 600,
              }}
            >
              {tr('ws.coaching.coachPay.dialog.lines')}
            </h3>
            {detail.lines.length === 0 ? (
              <p style={muted}>{tr('ws.coaching.coachPay.dialog.noLines')}</p>
            ) : (
              <>
                <DataTable<StatementLine>
                  aria-label={tr('ws.coaching.coachPay.dialog.lines')}
                  columns={lineColumns(tr, locale)}
                  rows={detail.lines}
                  rowKey={(l) => l.line_id}
                  onRowClick={(l) => {
                    if (l.lesson_id)
                      void navigate({ to: '/desk/lessons/$id', params: { id: l.lesson_id } });
                  }}
                  dense
                />
                {detail.lines.some((l) => l.is_adjustment) && (
                  <p style={{ ...muted, marginBlockStart: 'var(--tp-sp-1)' }}>
                    {tr('ws.coaching.coachPay.dialog.adjustmentHint')}
                  </p>
                )}
              </>
            )}
          </section>

          {detail.coach_booked_no_shows.length > 0 && (
            <section
              aria-label={tr('ws.coaching.coachPay.dialog.noShowsTitle')}
              data-testid="statement.noShows"
            >
              <h3
                style={{
                  margin: 0,
                  marginBlockEnd: 'var(--tp-sp-1)',
                  fontSize: 'var(--tp-fs-sm)',
                  fontWeight: 600,
                }}
              >
                {tr('ws.coaching.coachPay.dialog.noShowsTitle')}
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'grid',
                  gap: 'var(--tp-sp-1)',
                }}
              >
                {detail.coach_booked_no_shows.map((n) => (
                  <li key={`${n.lesson_id}:${n.start_at ?? ''}`}>
                    <Button
                      size="sm"
                      kind="ghost"
                      iconEnd="arrowUpRight"
                      onClick={() =>
                        void navigate({ to: '/desk/lessons/$id', params: { id: n.lesson_id } })
                      }
                    >
                      {tr('ws.coaching.coachPay.dialog.noShowRow', {
                        date: n.start_at ? formatDate(new Date(n.start_at), locale) : '—',
                        name: isolate(n.student_label?.trim() || tr('ws.coaching.common.walkIn')),
                      })}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={approving}
        title={tr('ws.coaching.coachPay.actions.approveTitle', {
          coach: isolate(coach),
          month: monthText,
        })}
        body={<p>{tr('ws.coaching.coachPay.actions.approveBody')}</p>}
        confirmLabel={tr('ws.coaching.coachPay.actions.approve')}
        busy={busy === 'approve'}
        onConfirm={() => void approve()}
        onCancel={() => setApproving(false)}
      />
      {paying && (
        <MarkPaidDialog
          statement={s}
          coach={coach}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            done('markPaid');
          }}
        />
      )}
      {voiding && (
        <VoidStatementDialog
          statement={s}
          coach={coach}
          onClose={() => setVoiding(false)}
          onDone={() => {
            setVoiding(false);
            done('void');
          }}
        />
      )}
    </Modal>
  );
}

const ACTION_ICON = {
  recount: 'refresh',
  approve: 'check',
  void: 'ban',
  markPaid: 'banknote',
  redraft: 'repeat',
} as const;

/** The statement's figures, every one the server's. */
function Figures({ statement: s }: { statement: StatementRow }) {
  const { tr, locale } = useLocale();
  const rows: [string, string][] = [
    [tr('ws.coaching.coachPay.columns.lessons'), countText(s.lessons_count, locale)],
    [tr('ws.coaching.coachPay.columns.collected'), moneyText(s.collected_iqd, locale)],
    [tr('ws.coaching.coachPay.columns.courtShare'), moneyText(s.court_share_iqd, locale)],
    [tr('ws.coaching.coachPay.columns.coachShare'), moneyText(s.coach_iqd, locale)],
    [tr('ws.coaching.coachPay.columns.adjustments'), signedMoneyText(s.adjustments_iqd, locale)],
    [tr('ws.coaching.coachPay.columns.toPay'), maybeNegativeMoneyText(s.total_iqd, locale)],
  ];
  return (
    <dl
      data-testid="statement.figures"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))',
        gap: 'var(--tp-sp-2) var(--tp-sp-4)',
        margin: 0,
      }}
    >
      {rows.map(([label, value], i) => (
        <div key={label}>
          <dt style={{ ...muted, fontWeight: 600 }}>{label}</dt>
          <dd
            style={{
              margin: 0,
              fontWeight: i === rows.length - 1 ? 700 : 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <bdi>{value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Who approved, paid or voided it, and when. */
function StatementHistory({ statement: s }: { statement: StatementRow }) {
  const { tr, locale } = useLocale();
  const day = (iso: string | null) => (iso ? formatDate(new Date(iso), locale) : '—');
  const name = (n: string | null) => isolate(n?.trim() || '—');
  const lines: string[] = [];
  if (s.approved_at)
    lines.push(
      tr('ws.coaching.coachPay.dialog.approvedLine', {
        date: day(s.approved_at),
        name: name(s.approved_by_name),
      }),
    );
  if (s.status === 'paid' || s.paid_at) {
    lines.push(
      tr('ws.coaching.coachPay.dialog.paidLine', {
        date: day(s.paid_at),
        name: name(s.paid_by_name),
        reference: isolate(s.paid_reference?.trim() || '—'),
      }),
    );
  }
  if (s.status === 'void' || s.voided_at) {
    lines.push(
      tr('ws.coaching.coachPay.dialog.voidLine', {
        date: day(s.voided_at),
        reason: isolate(s.void_reason?.trim() || '—'),
      }),
    );
  }
  if (lines.length === 0) return null;
  return (
    <ul
      data-testid="statement.history"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}
    >
      {lines.map((l) => (
        <li key={l} style={muted}>
          {l}
        </li>
      ))}
    </ul>
  );
}

function lineColumns(
  tr: ReturnType<typeof useLocale>['tr'],
  locale: ReturnType<typeof useLocale>['locale'],
): Column<StatementLine>[] {
  const c = (k: Parameters<typeof tr>[0]) => tr(k);
  const n = (
    key: keyof StatementLine,
    header: string,
    text: (l: StatementLine) => string,
  ): Column<StatementLine> => ({
    key,
    header,
    numeric: true,
    render: (l) => <bdi>{text(l)}</bdi>,
  });
  return [
    {
      key: 'date',
      header: c('ws.coaching.coachPay.dialog.columns.date'),
      render: (l) => <bdi>{l.start_at ? formatDate(new Date(l.start_at), locale) : '—'}</bdi>,
    },
    {
      key: 'lesson',
      header: c('ws.coaching.coachPay.dialog.columns.lesson'),
      render: (l) => {
        const p = lineLessonParts(l, locale);
        const kind = p.kindKey ? tr(p.kindKey) : '';
        const second =
          p.sessionNo !== null
            ? tr('ws.coaching.common.session', { n: String(p.sessionNo) })
            : p.name;
        const first = p.sessionNo !== null ? p.name || kind : kind;
        const text =
          first && second
            ? tr('ws.coaching.common.label.pair', { a: first, b: second })
            : first || second || '—';
        return (
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--tp-sp-1-5)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <bdi>{text}</bdi>
            {l.is_adjustment && (
              <StatusBadge
                size="sm"
                tone="warn"
                label={tr('ws.coaching.coachPay.dialog.adjustment')}
                title={tr('ws.coaching.coachPay.dialog.adjustmentHint')}
              />
            )}
          </span>
        );
      },
    },
    n('enrolments', c('ws.coaching.coachPay.dialog.columns.signUps'), (l) =>
      countText(l.enrolments, locale),
    ),
    n('attended', c('ws.coaching.coachPay.dialog.columns.attended'), (l) =>
      countText(l.attended, locale),
    ),
    n('no_shows', c('ws.coaching.coachPay.dialog.columns.noShows'), (l) =>
      countText(l.no_shows, locale),
    ),
    // Line money is signed (R22): an adjustment line can take money back.
    n('collected_iqd', c('ws.coaching.coachPay.dialog.columns.collected'), (l) =>
      maybeNegativeMoneyText(l.collected_iqd, locale),
    ),
    n('court_share_iqd', c('ws.coaching.coachPay.dialog.columns.courtShare'), (l) =>
      maybeNegativeMoneyText(l.court_share_iqd, locale),
    ),
    n('share_bp', c('ws.coaching.coachPay.dialog.columns.share'), (l) =>
      l.share_bp === null
        ? '—'
        : `${formatPercent(l.share_bp / 100, locale)}${tr('ws.kit.common.percent')}`,
    ),
    n('coach_iqd', c('ws.coaching.coachPay.dialog.columns.coachAmount'), (l) =>
      maybeNegativeMoneyText(l.coach_iqd, locale),
    ),
  ];
}
