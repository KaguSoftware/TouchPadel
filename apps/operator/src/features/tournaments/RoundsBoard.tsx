/**
 * The Rounds tab of `/desk/tournaments/$id` (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.6 set_rounds and score, §1.9; plan §5.1
 * "Rounds"). Logic in roundsLogic.ts.
 *
 * - Laid out (2026-10-05 redesign, option C): the rounds two to a row,
 *   each round's matches two to a row, the round being
 *   played outlined, and the top of the standings beside them
 *   (`.tp-tour-split`, components/GlobalStyles.tsx).
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
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber, isolate } from '@touch/i18n';
import { TOUR_LIMITS } from '@touch/core/tournaments';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, Field, Modal, inputStyle } from '../../components/ui';
import { EmptyState, MessagePresenter, ReasonCodePrompt } from '../../components/kit';
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
  needsScoreReason,
  readScoreInput,
  scoreTyping,
  shortName,
} from './roundsLogic';
import { pickName, roundsErrorKey, tournamentErrorText, codeOf } from './tournamentLogic';
import { currentRoundNo, roundState, scoredCount, type RoundState } from './layoutLogic';
import { RankMedal } from './TournamentParts';
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
  onShowStandings,
}: {
  detail: TournamentDetail;
  canRun: boolean;
  onRefetch: () => void;
  /** "All" on the leaderboard: the Standings tab. */
  onShowStandings?: () => void;
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
  const current = currentRoundNo(detail.rounds);
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
          {tr(roundsErrorKey(error))}
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
        <div className="tp-tour-split">
          <div
            style={{
              display: 'grid',
              // Two rounds to a row; one once a round would drop under 22rem.
              gridTemplateColumns:
                'repeat(auto-fill, minmax(max(22rem, calc((100% - var(--tp-sp-3)) / 2)), 1fr))',
              gap: 'var(--tp-sp-3)',
              minInlineSize: 0,
              alignItems: 'start',
            }}
          >
            {detail.rounds.map((r) => (
              <RoundPanel
                key={r.round_no}
                round={r}
                total={planned}
                state={roundState(r, current)}
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
            ))}
          </div>
          <Leaderboard detail={detail} nameOf={nameOf} onShowAll={onShowStandings} />
        </div>
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

/** A round's column: done rounds sit back, the one being played is outlined, drawn ones are dashed. */
const ROUND_LOOK: Record<RoundState, CSSProperties> = {
  done: { background: 'var(--tp-surface-2)', border: '1px solid var(--tp-border)' },
  now: { background: 'var(--tp-surface)', border: '2px solid var(--tp-accent)' },
  drawn: { background: 'transparent', border: '2px dashed var(--tp-border-strong)' },
};

function RoundPanel({
  round,
  total,
  state,
  detail,
  nameOf,
  courtName,
  scorable,
  onScored,
  onChanged,
}: {
  round: TourDetailRound;
  total: number;
  state: RoundState;
  detail: TournamentDetail;
  nameOf: (id: string) => string;
  courtName: (id: string) => string;
  scorable: boolean;
  onScored: (removedFrom: number | null) => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const title = tr('ws.tournaments.rounds.roundOf', {
    round: formatNumber(round.round_no, locale),
    total: formatNumber(Math.max(total, round.round_no), locale),
  });
  const tag =
    state === 'now'
      ? tr('ws.tournaments.rounds.state.now', {
          scored: formatNumber(scoredCount(round), locale),
          total: formatNumber(round.matches.length, locale),
        })
      : tr(`ws.tournaments.rounds.state.${state}`);
  return (
    <section
      aria-label={title}
      data-round-state={state}
      style={{
        ...ROUND_LOOK[state],
        minInlineSize: 0,
        boxSizing: 'border-box',
        borderRadius: 'var(--tp-radius-dialog)',
        padding: 'var(--tp-sp-3)',
        display: 'grid',
        gap: 'var(--tp-sp-2-5)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--tp-sp-2)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>{title}</h3>
        <span
          style={{
            fontSize: 'var(--tp-fs-xs)',
            fontWeight: 700,
            color:
              state === 'now'
                ? 'var(--tp-accent)'
                : state === 'done'
                  ? 'var(--tp-success-fg)'
                  : 'var(--tp-muted-fg)',
          }}
        >
          {tag}
        </span>
      </header>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--tp-sp-2)',
        }}
      >
        {round.matches.map((m) => (
          <li key={m.match_id} style={{ minInlineSize: 0, display: 'flex' }}>
            <MatchRow
              match={m}
              target={detail.points_target}
              court={courtName(m.court_id)}
              a={m.a.map(nameOf).join(' & ')}
              b={m.b.map(nameOf).join(' & ')}
              scorable={scorable}
              finished={detail.status === 'finished'}
              onScored={onScored}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
      {round.sit_out.length > 0 && (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.tournaments.rounds.sitOut', {
            names: round.sit_out
              .map((id) => isolate(nameOf(id)))
              .join(locale === 'ar' ? '، ' : ', '),
          })}
        </p>
      )}
    </section>
  );
}

/** One match as a card: court and score on top, the two sides, then the score entry. */
function MatchRow({
  match: m,
  target,
  court,
  a,
  b,
  scorable,
  finished = false,
  onScored,
  onChanged,
}: {
  match: TourDetailMatch;
  target: number;
  court: string;
  a: string;
  b: string;
  scorable: boolean;
  /** The tournament has finished: every score write asks for a reason (0311). */
  finished?: boolean;
  onScored: (removedFrom: number | null) => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const scored = isCorrection(m);
  const aWon = scored && (m.points_a ?? 0) > (m.points_b ?? 0);
  const bWon = scored && (m.points_b ?? 0) > (m.points_a ?? 0);
  const side = (names: string, won: boolean) => (
    // Short names ("Yusuf S."), shown whole: a long pair wraps, never "…".
    <bdi
      style={{
        display: 'block',
        overflowWrap: 'anywhere',
        lineHeight: 1.35,
        fontWeight: won ? 700 : 500,
        color: scored && !won ? 'var(--tp-muted-fg)' : 'var(--tp-fg)',
      }}
      title={names}
    >
      {names}
    </bdi>
  );
  return (
    <div
      style={{
        flex: 1,
        minInlineSize: 0,
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        alignContent: 'start',
        padding: 'var(--tp-sp-2-5)',
        background: 'var(--tp-surface)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
        }}
      >
        <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 700, color: 'var(--tp-muted-fg)' }}>
          <bdi>{court}</bdi>
        </span>
        {scored && (
          <strong
            dir="ltr"
            style={{
              fontVariantNumeric: 'tabular-nums',
              padding: '0 var(--tp-sp-2)',
              borderRadius: 'var(--tp-radius-pill)',
              background: 'var(--tp-success-soft)',
              color: 'var(--tp-success-fg)',
            }}
            data-testid="match-score"
          >
            {m.points_a}–{m.points_b}
          </strong>
        )}
      </div>
      {side(a, aWon)}
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.tournaments.rounds.vs')}
      </span>
      {side(b, bWon)}
      {m.corrections > 0 && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.tournaments.score.corrections', { count: formatNumber(m.corrections, locale) })}
        </span>
      )}
      {scorable && (
        <span>
          <Button
            size="sm"
            kind={scored ? 'ghost' : 'primary'}
            icon={scored ? 'note' : 'plus'}
            onClick={() => setOpen(true)}
          >
            {scored ? tr('ws.tournaments.score.correct') : tr('ws.tournaments.score.enter')}
          </Button>
        </span>
      )}
      {open && (
        <ScoreDialog
          match={m}
          finished={finished}
          court={court}
          target={target}
          teamA={a}
          teamB={b}
          onClose={() => setOpen(false)}
          onDone={(removedFrom) => {
            setOpen(false);
            onScored(removedFrom);
          }}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

/** The top of the standings beside the rounds; "All" opens the Standings tab. */
function Leaderboard({
  detail,
  nameOf,
  onShowAll,
}: {
  detail: TournamentDetail;
  nameOf: (id: string) => string;
  onShowAll?: () => void;
}) {
  const { tr, locale } = useLocale();
  const top = detail.standings.slice(0, 7);
  return (
    <aside
      aria-label={tr('ws.tournaments.rounds.leaderboard')}
      style={{
        minInlineSize: 0,
        background: 'var(--tp-surface)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-dialog)',
        padding: 'var(--tp-sp-4)',
        display: 'grid',
        gap: 'var(--tp-sp-2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--tp-sp-2)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
          {tr('ws.tournaments.rounds.leaderboard')}
        </h3>
        {onShowAll && detail.standings.length > top.length && (
          <Button size="sm" kind="ghost" onClick={onShowAll}>
            {tr('ws.tournaments.rounds.allStandings', {
              count: formatNumber(detail.standings.length, locale),
            })}
          </Button>
        )}
      </div>
      {top.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.tournaments.standings.empty')}
        </p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {top.map((row) => (
            <li
              key={row.entry_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2-5)',
                padding: 'var(--tp-sp-2) 0',
                borderBlockEnd: '1px solid var(--tp-border)',
              }}
            >
              <RankMedal rank={row.rank} label={formatNumber(row.rank, locale)} />
              <bdi
                style={{
                  flex: 1,
                  minInlineSize: 0,
                  overflowWrap: 'anywhere',
                  fontWeight: 600,
                }}
              >
                {nameOf(row.entry_id)}
              </bdi>
              <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {formatNumber(row.points_won, locale)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/**
 * One match's score entry, drawn as a scoreboard (2026-10-05): each side's
 * names with big −/+ buttons, side A typed or stepped and side B always
 * `target − a` (its buttons step A the other way). A first score saves at
 * once; a correction asks why first. Opened in ScoreDialog.
 */
export function ScoreCell({
  match: m,
  target,
  teamA,
  teamB,
  finished = false,
  onDone,
  onChanged,
  onCancel,
}: {
  match: TourDetailMatch;
  target: number;
  teamA: string;
  teamB?: string;
  /** The tournament has finished: a first score asks for a reason too (0311, c35). */
  finished?: boolean;
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
  const reasoned = needsScoreReason(m, finished ? 'finished' : 'running');
  const sideB = teamB ?? tr('ws.tournaments.score.otherSide');

  /** Step side A by `d` points, inside 0…target. */
  function step(d: number) {
    const a = /^\d+$/.test(text) ? Number(text) : 0;
    setText(String(Math.min(target, Math.max(0, a + d))));
  }

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

  /** A side's − or + button; `d` is what it does to side A (side B's run the other way). */
  const stepButton = (team: string, more: boolean, d: number) => (
    <Button
      size="lg"
      icon={more ? 'plus' : 'minus'}
      disabled={busy}
      aria-label={tr(more ? 'ws.tournaments.score.more' : 'ws.tournaments.score.less', { team })}
      title={tr(more ? 'ws.tournaments.score.more' : 'ws.tournaments.score.less', { team })}
      onClick={() => step(d)}
    />
  );
  const boxStyle: CSSProperties = {
    ...inputStyle,
    inlineSize: '5.5rem',
    blockSize: '3.5rem',
    textAlign: 'center',
    fontSize: 'var(--tp-fs-3xl)',
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  };
  const row = (team: string, value: ReactNode, minus: number, plus: number, won: boolean) => (
    <div
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2-5)',
        padding: 'var(--tp-sp-3) var(--tp-sp-4)',
        borderRadius: 'var(--tp-radius-panel)',
        background: won ? 'var(--tp-success-soft)' : 'var(--tp-surface-2)',
      }}
    >
      {/* The short names, whole, wrapping if they must: never cut to "…". */}
      <bdi
        style={{
          display: 'block',
          textAlign: 'center',
          fontSize: 'var(--tp-fs-lg)',
          fontWeight: 700,
          lineHeight: 1.35,
          overflowWrap: 'anywhere',
        }}
      >
        {team}
      </bdi>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--tp-sp-3)',
        }}
      >
        {stepButton(team, false, minus)}
        {value}
        {stepButton(team, true, plus)}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {row(
        teamA,
        <input
          aria-label={tr('ws.tournaments.score.pointsFor', { team: teamA })}
          inputMode="numeric"
          dir="ltr"
          style={boxStyle}
          value={text}
          disabled={busy}
          onChange={(e) => setText(scoreTyping(e.target.value, target))}
        />,
        -1,
        1,
        score !== null && score.a > score.b,
      )}
      {row(
        sideB,
        <output
          aria-label={tr('ws.tournaments.score.pointsFor', { team: sideB })}
          data-testid="score-other"
          dir="ltr"
          style={{
            ...boxStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--tp-surface)',
            boxSizing: 'border-box',
          }}
        >
          {score ? formatNumber(score.b, locale) : '–'}
        </output>,
        1,
        -1,
        score !== null && score.b > score.a,
      )}
      {/* Side B's box already shows its points: the line under the board only
          says what the two must add up to, and keeps its room once they do. */}
      <p
        style={{
          margin: 0,
          minBlockSize: '1.5em',
          fontSize: 'var(--tp-fs-sm)',
          color: 'var(--tp-muted-fg)',
        }}
      >
        {score ? null : tr('ws.tournaments.score.sum', { target: formatNumber(target, locale) })}
      </p>
      {error != null && !asking && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
        >
          {tournamentErrorText(error, tr, { target: formatNumber(target, locale) })}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-2)',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        {onCancel && (
          <Button disabled={busy} onClick={onCancel}>
            {tr('common.cancel')}
          </Button>
        )}
        <Button
          kind="primary"
          busy={busy && !asking}
          disabled={!score}
          onClick={() => (reasoned ? setAsking(true) : void save(null))}
        >
          {tr('ws.tournaments.score.save')}
        </Button>
      </div>
      {asking && (
        <ReasonCodePrompt
          action={tr('ws.tournaments.score.correctionTitle')}
          reasonCodes={CORRECTION_REASONS}
          noteMode="optional"
          busy={busy}
          error={error}
          errorMessage={
            error != null
              ? tournamentErrorText(error, tr, { target: formatNumber(target, locale) })
              : null
          }
          onCancel={() => setAsking(false)}
          onSubmit={(code, note) => void save(note ? `${code}: ${note}` : code)}
        >
          <p style={{ marginBlockStart: 0 }}>
            {tr(
              isCorrection(m)
                ? 'ws.tournaments.score.correctionReason'
                : 'ws.tournaments.score.lateReason',
            )}
          </p>
        </ReasonCodePrompt>
      )}
    </div>
  );
}

/** The pop-up a match's "Enter score" or "Correct" opens. */
function ScoreDialog({
  match,
  finished,
  court,
  target,
  teamA,
  teamB,
  onClose,
  onDone,
  onChanged,
}: {
  match: TourDetailMatch;
  finished: boolean;
  court: string;
  target: number;
  teamA: string;
  teamB: string;
  onClose: () => void;
  onDone: (removedFrom: number | null) => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  return (
    <Modal
      title={
        isCorrection(match)
          ? tr('ws.tournaments.score.correctionTitle')
          : tr('ws.tournaments.score.enter')
      }
      subtitle={`${court} · ${tr('ws.tournaments.detail.pointsTag', { points: formatNumber(target, locale) })}`}
      onClose={onClose}
      size="sm"
    >
      <ScoreCell
        match={match}
        finished={finished}
        target={target}
        teamA={teamA}
        teamB={teamB}
        onDone={onDone}
        onChanged={onChanged}
        onCancel={onClose}
      />
    </Modal>
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
          {tr(roundsErrorKey(error))}
        </p>
      )}
    </Modal>
  );
}
