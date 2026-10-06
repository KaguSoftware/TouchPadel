/**
 * The Rounds tab of `/desk/tournaments/$id` (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.6 set_rounds and score, §1.9; plan §5.1
 * "Rounds"). Logic in roundsLogic.ts.
 *
 * - Start (status closed, nothing drawn): pick the courts (all adopted ones by
 *   default) and, for Americano, the rounds; the core engine draws them and
 *   `tournament_set_rounds(from_round = 1)` saves them.
 * - Next round (Mexicano, enabled once the last round is scored), and
 *   "Regenerate from round k" whenever rounds are missing (a no-show without a
 *   substitute, or a Mexicano correction, removed them).
 * - Every payload is checked with the server's own rules before it is sent.
 * - The score cell: one input for side A, side B filled as `target − a`. It
 *   sends the match's `revision` as `p_expected_revision`; `changed` refetches.
 *   A correction asks for a reason (the kit's ReasonCodePrompt).
 *
 * Online only: offline the controls are disabled with the reason.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber, isolate } from '@touch/i18n';
import { TOUR_LIMITS } from '@touch/core/tournaments';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, Field, Modal, inputStyle } from '../../components/ui';
import {
  EmptyState,
  MessagePresenter,
  Panel,
  ReasonCodePrompt,
  StatusBadge,
} from '../../components/kit';
import {
  activeEntries,
  boardAction,
  buildFrom,
  buildStart,
  canScore,
  checkPayload,
  defaultAmericanoRounds,
  drawBlocker,
  entriesById,
  isCorrection,
  readScoreInput,
  roundComplete,
  shortName,
} from './roundsLogic';
import { pickName, tournamentErrorKey, tournamentErrorText, codeOf } from './tournamentLogic';
import {
  readPlayAnswer,
  type TourDetailMatch,
  type TourDetailRound,
  type TournamentDetail,
} from './tournamentPayloads';
import {
  invalidateTournament,
  invalidateTournamentCourts,
  useTournamentIdemKey,
} from './useTournaments';

/** The reasons a score correction offers (op.reasons; the server stores `<code>` or `<code>: <note>`). */
const CORRECTION_REASONS = ['staff_error', 'customer_request', 'other'] as const;

export function RoundsBoard({
  detail,
  canRun,
  onRefetch,
}: {
  detail: TournamentDetail;
  canRun: boolean;
  onRefetch: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const roundsKey = useTournamentIdemKey('rounds');
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = boardAction(detail);
  const byId = entriesById(detail);
  const nameOf = (id: string) => {
    const e = byId.get(id);
    return e
      ? shortName(e.full_name) || tr('tournaments.common.player', { no: String(e.seed_no ?? '?') })
      : '—';
  };
  const courtName = (id: string) => {
    const c = detail.courts.find((x) => x.court_id === id);
    return c ? pickName(locale, c.name_en, c.name_ar) : '—';
  };
  const planned = detail.rounds_planned ?? detail.rounds.length;
  const mayDraw = canRun && detail.can.set_rounds && reachable;

  async function send(build: () => ReturnType<typeof buildStart>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = build();
      const problems = checkPayload(detail, payload);
      if (problems.length > 0) {
        // The server would refuse it the same way: say so without sending.
        const first = problems[0];
        setError(
          first === 'payload'
            ? new AppRpcError('INVALID_ARGUMENT', '', undefined, 'p_payload')
            : new AppRpcError('TOURNAMENT_ROUNDS_INVALID', '', undefined, first),
        );
        return false;
      }
      await appRpc('tournament_set_rounds', {
        p_tournament_id: detail.id,
        p_payload: payload,
        p_idempotency_key: roundsKey.key(),
      });
      roundsKey.renew();
      toast.ok(tr('ws.tournaments.rounds.saved'));
      invalidateTournament(qc);
      return true;
    } catch (e) {
      // A stale or changed tournament: a new write next time, on fresh data.
      if (codeOf(e) === 'TOURNAMENT_ROUNDS_INVALID') {
        roundsKey.renew();
        onRefetch();
      }
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Next and Regenerate draw on the players and courts left: say why not
  // rather than let the engine refuse it unexplained.
  const blocker =
    action.kind === 'next' || action.kind === 'regenerate' ? drawBlocker(detail) : null;

  const blockerNote = blocker ? (
    <MessagePresenter tone="refused" message={tr(`ws.tournaments.rounds.${blocker}`)} />
  ) : null;

  const banner =
    action.kind === 'regenerate' ? (
      <MessagePresenter
        tone="refused"
        message={tr('ws.tournaments.rounds.missing', {
          round: formatNumber(action.fromRound, locale),
        })}
      />
    ) : action.kind === 'scoreFirst' ? (
      <MessagePresenter tone="info" message={tr('ws.tournaments.rounds.nextHint')} />
    ) : null;

  const controls =
    action.kind === 'start' ? (
      <Button
        kind="primary"
        icon="play"
        disabled={!mayDraw}
        disabledReason={!reachable ? tr('ws.tournaments.detail.offline') : undefined}
        onClick={() => setStarting(true)}
      >
        {tr('ws.tournaments.rounds.start')}
      </Button>
    ) : action.kind === 'next' ? (
      <Button
        kind="primary"
        icon="play"
        busy={busy}
        disabled={!mayDraw || blocker !== null}
        onClick={() => void send(() => buildFrom(detail, action.fromRound))}
      >
        {tr('ws.tournaments.rounds.next')}
      </Button>
    ) : action.kind === 'regenerate' ? (
      <Button
        kind="primary"
        icon="refresh"
        busy={busy}
        disabled={!mayDraw || blocker !== null}
        onClick={() => void send(() => buildFrom(detail, action.fromRound))}
      >
        {tr('ws.tournaments.rounds.regenerate', { round: formatNumber(action.fromRound, locale) })}
      </Button>
    ) : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="rounds-board">
      {banner}
      {blockerNote}
      {controls && (
        <div
          style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          {controls}
        </div>
      )}
      {notice && <MessagePresenter tone="info" message={notice} />}
      {error != null && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
        >
          {tr(tournamentErrorKey(error))}
        </p>
      )}

      {detail.rounds.length === 0 ? (
        <EmptyState
          compact
          icon="trophy"
          title={
            detail.status === 'open'
              ? tr('ws.tournaments.rounds.notYet')
              : tr('ws.tournaments.rounds.none')
          }
        />
      ) : (
        detail.rounds.map((r) => (
          <RoundPanel
            key={r.round_no}
            round={r}
            total={planned}
            detail={detail}
            nameOf={nameOf}
            courtName={courtName}
            scorable={canRun && canScore(detail) && reachable}
            onScored={(removedFrom) => {
              if (removedFrom !== null)
                setNotice(
                  tr('ws.tournaments.score.roundsRemoved', {
                    round: formatNumber(removedFrom, locale),
                  }),
                );
            }}
            onChanged={onRefetch}
          />
        ))
      )}

      {starting && (
        <StartDialog
          detail={detail}
          busy={busy}
          error={error}
          onClose={() => {
            setStarting(false);
            setError(null);
          }}
          onStart={async (courtIds, rounds) => {
            const ok = await send(() => buildStart(detail, { courtIds, rounds }));
            if (ok) setStarting(false);
          }}
        />
      )}
    </div>
  );
}

function RoundPanel({
  round,
  total,
  detail,
  nameOf,
  courtName,
  scorable,
  onScored,
  onChanged,
}: {
  round: TourDetailRound;
  total: number;
  detail: TournamentDetail;
  nameOf: (id: string) => string;
  courtName: (id: string) => string;
  scorable: boolean;
  onScored: (removedFrom: number | null) => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const done = roundComplete(round);
  return (
    <Panel
      title={tr('ws.tournaments.rounds.roundOf', {
        round: formatNumber(round.round_no, locale),
        total: formatNumber(Math.max(total, round.round_no), locale),
      })}
      actions={
        done ? (
          <StatusBadge size="sm" tone="success" label={tr('tournaments.common.status.finished')} />
        ) : undefined
      }
    >
      <ul
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}
      >
        {round.matches.map((m) => (
          <li key={m.match_id}>
            <MatchRow
              match={m}
              target={detail.points_target}
              court={courtName(m.court_id)}
              a={m.a.map(nameOf).join(' & ')}
              b={m.b.map(nameOf).join(' & ')}
              scorable={scorable}
              onScored={onScored}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
      {round.sit_out.length > 0 && (
        <p
          style={{
            margin: 0,
            marginBlockStart: 'var(--tp-sp-2)',
            fontSize: 'var(--tp-fs-sm)',
            color: 'var(--tp-muted-fg)',
          }}
        >
          {tr('ws.tournaments.rounds.sitOut', {
            names: round.sit_out
              .map((id) => isolate(nameOf(id)))
              .join(locale === 'ar' ? '، ' : ', '),
          })}
        </p>
      )}
    </Panel>
  );
}

function MatchRow({
  match: m,
  target,
  court,
  a,
  b,
  scorable,
  onScored,
  onChanged,
}: {
  match: TourDetailMatch;
  target: number;
  court: string;
  a: string;
  b: string;
  scorable: boolean;
  onScored: (removedFrom: number | null) => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const scored = isCorrection(m);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(6rem, 10rem) minmax(0, 1fr) auto',
        gap: 'var(--tp-sp-2)',
        alignItems: 'center',
        padding: 'var(--tp-sp-2)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
      }}
    >
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        <bdi>{court}</bdi>
      </span>
      <span style={{ minInlineSize: 0 }}>
        <bdi>{a}</bdi>{' '}
        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.rounds.vs')}</span>{' '}
        <bdi>{b}</bdi>
        {m.corrections > 0 && (
          <span
            style={{
              marginInlineStart: 'var(--tp-sp-2)',
              fontSize: 'var(--tp-fs-xs)',
              color: 'var(--tp-muted-fg)',
            }}
          >
            {tr('ws.tournaments.score.corrections', { count: formatNumber(m.corrections, locale) })}
          </span>
        )}
      </span>
      <span
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-2)',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        {scored && !editing && (
          <strong
            dir="ltr"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            data-testid="match-score"
          >
            {m.points_a}–{m.points_b}
          </strong>
        )}
        {(!scored || editing) && scorable ? (
          <ScoreCell
            match={m}
            target={target}
            teamA={a}
            onDone={(removedFrom) => {
              setEditing(false);
              onScored(removedFrom);
            }}
            onChanged={onChanged}
            onCancel={scored ? () => setEditing(false) : undefined}
          />
        ) : (
          scored &&
          scorable && (
            <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing(true)}>
              {tr('ws.tournaments.score.correct')}
            </Button>
          )
        )}
      </span>
    </div>
  );
}

/**
 * One match's score entry: side A's points typed, side B shown as `target − a`.
 * A first score saves at once; a correction asks why first.
 */
export function ScoreCell({
  match: m,
  target,
  teamA,
  onDone,
  onChanged,
  onCancel,
}: {
  match: TourDetailMatch;
  target: number;
  teamA: string;
  onDone: (removedFrom: number | null) => void;
  onChanged: () => void;
  onCancel?: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(m.points_a !== null ? String(m.points_a) : '');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const score = readScoreInput(text, target);
  const correction = isCorrection(m);

  async function save(reason: string | null) {
    if (!score) return;
    setBusy(true);
    setError(null);
    try {
      const out = readPlayAnswer(
        await appRpc('tournament_score', {
          p_match_id: m.match_id,
          p_points_a: score.a,
          p_points_b: score.b,
          p_expected_revision: m.revision,
          p_reason: reason,
        }),
      );
      toast.ok(tr('ws.tournaments.score.saved'));
      setAsking(false);
      // A finish releases the courts: the calendar's lists too.
      if (out.status === 'finished') invalidateTournamentCourts(qc);
      else invalidateTournament(qc);
      onDone(out.removed_from_round);
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'TOURNAMENT_SCORE_REFUSED') onChanged();
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 'var(--tp-sp-2)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <input
        aria-label={tr('ws.tournaments.score.pointsFor', { team: teamA })}
        inputMode="numeric"
        dir="ltr"
        style={{ ...inputStyle, inlineSize: '4.5rem', textAlign: 'center' }}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
      />
      <span
        style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}
        data-testid="score-other"
      >
        {score
          ? tr('ws.tournaments.score.other', { points: formatNumber(score.b, locale) })
          : tr('ws.tournaments.score.sum', { target: formatNumber(target, locale) })}
      </span>
      <Button
        size="sm"
        kind="primary"
        busy={busy && !asking}
        disabled={!score}
        onClick={() => (correction ? setAsking(true) : void save(null))}
      >
        {tr('ws.tournaments.score.save')}
      </Button>
      {onCancel && (
        <Button size="sm" kind="ghost" disabled={busy} onClick={onCancel}>
          {tr('common.cancel')}
        </Button>
      )}
      {error != null && !asking && (
        <span role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tournamentErrorText(error, tr, { target: formatNumber(target, locale) })}
        </span>
      )}
      {asking && (
        <ReasonCodePrompt
          action={tr('ws.tournaments.score.correctionTitle')}
          reasonCodes={CORRECTION_REASONS}
          noteMode="optional"
          busy={busy}
          error={error}
          onCancel={() => setAsking(false)}
          onSubmit={(code, note) => void save(note ? `${code}: ${note}` : code)}
        >
          <p style={{ marginBlockStart: 0 }}>{tr('ws.tournaments.score.correctionReason')}</p>
        </ReasonCodePrompt>
      )}
    </span>
  );
}

function StartDialog({
  detail,
  busy,
  error,
  onClose,
  onStart,
}: {
  detail: TournamentDetail;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onStart: (courtIds: string[], rounds: number) => void | Promise<void>;
}) {
  const { tr, locale } = useLocale();
  const players = activeEntries(detail).length;
  const [courtIds, setCourtIds] = useState<string[]>(() => detail.courts.map((c) => c.court_id));
  const [rounds, setRounds] = useState(String(defaultAmericanoRounds(players)));
  const americano = detail.format === 'americano';
  const n = Number(rounds);
  const roundsOk = !americano || (/^\d+$/.test(rounds) && n >= 1 && n <= TOUR_LIMITS.roundsMax);
  const enough = players >= TOUR_LIMITS.entriesMin;
  const ready = enough && courtIds.length > 0 && roundsOk;
  return (
    <Modal
      title={tr('ws.tournaments.rounds.startTitle')}
      subtitle={tr('ws.tournaments.rounds.startLead')}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!ready}
            onClick={() => void onStart(courtIds, americano ? n : 1)}
          >
            {tr('ws.tournaments.rounds.generate')}
          </Button>
        </>
      }
    >
      <p style={{ marginBlockStart: 0 }}>
        {tr('ws.tournaments.rounds.players', { count: formatNumber(players, locale) })}
      </p>
      {!enough && (
        <MessagePresenter tone="refused" message={tr('ws.tournaments.rounds.needPlayers')} />
      )}
      <Field
        label={tr('ws.tournaments.rounds.courts')}
        error={courtIds.length === 0 ? tr('ws.tournaments.rounds.needCourts') : undefined}
        group
      >
        <div role="group" style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {detail.courts.map((c) => (
            <label
              key={c.court_id}
              style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}
            >
              <input
                type="checkbox"
                checked={courtIds.includes(c.court_id)}
                disabled={busy}
                onChange={(e) =>
                  setCourtIds((ids) =>
                    e.target.checked ? [...ids, c.court_id] : ids.filter((x) => x !== c.court_id),
                  )
                }
              />
              <bdi>{pickName(locale, c.name_en, c.name_ar)}</bdi>
            </label>
          ))}
        </div>
      </Field>
      {americano && (
        <Field
          label={tr('ws.tournaments.rounds.count')}
          hint={tr('ws.tournaments.rounds.countHint', {
            max: formatNumber(TOUR_LIMITS.roundsMax, locale),
          })}
          error={
            roundsOk
              ? undefined
              : tr('ws.tournaments.publish.errors.range', {
                  min: '1',
                  max: String(TOUR_LIMITS.roundsMax),
                })
          }
        >
          <input
            style={inputStyle}
            inputMode="numeric"
            dir="ltr"
            value={rounds}
            disabled={busy}
            onChange={(e) => setRounds(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
          />
        </Field>
      )}
      {error != null && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
        >
          {tr(tournamentErrorKey(error))}
        </p>
      )}
    </Modal>
  );
}
