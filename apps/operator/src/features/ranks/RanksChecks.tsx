/**
 * Ranks › Checks (0444; plan docs/design/ranks/plan-2026-11-13.md §5, §9). Two review lists:
 *
 *   Level checks      every Type a coach or the desk gave (app.ranks_level_checks_list, manager
 *                     or owner): who was checked, the class, who checked them and in what role,
 *                     whether the rules applied it, and where the player's level went in the
 *                     games after it. A drift of 0.3 or more is coloured: a checker whose players
 *                     keep falling rates too high. Each row stands alone; nothing here adds up a
 *                     checker into a score (staff are never ranked).
 *   Results to check  the same two pairs with the winner flipped within 7 days
 *                     (app.ranks_results_to_check, court desk and up), each result with Void for
 *                     a manager or the owner (app.ranks_void, reason required).
 */
import { useState, type CSSProperties } from 'react';
import { formatDate, formatNumber, formatTime, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { Button, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, Panel, StatusBadge, ViewMore, asyncStatus, useListCap } from '../../components/kit';
import { driftFlagged, levelText, signedLevel, type CheckResult, type LevelCheck, type ResultPair } from './ranksLogic';
import { useLevelChecks, useResultsToCheck } from './useRanks';
import { Team, VoidDialog, playerName } from './resultParts';

const K = 'ws.ranks';

const hint: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' };
const muted: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' };

export function RanksChecks() {
  const { staff } = useAuth();
  const canReadChecks = can(staff, 'readRanksAdmin');
  const canReadPairs = can(staff, 'recordRanks');
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-4)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 28rem), 1fr))',
        alignItems: 'start',
      }}
    >
      {canReadChecks && <LevelChecksPanel />}
      {canReadPairs && <ResultsToCheckPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level checks
// ---------------------------------------------------------------------------

function LevelChecksPanel() {
  const { tr } = useLocale();
  const q = useLevelChecks();
  const rows = q.data ?? [];
  const cap = useListCap(rows);
  const status = asyncStatus(q, (d) => d.length === 0);
  return (
    <Panel title={tr(`${K}.checks.title`)} data-testid="ranks-level-checks">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <p style={{ ...muted, maxInlineSize: '70ch' }}>{tr(`${K}.checks.lead`)}</p>
        <AsyncStateWrapper
          status={status}
          error={q.error}
          onRetry={() => void q.refetch()}
          skeleton={<Skeleton lines={4} />}
          emptyContent={<EmptyState compact icon="star" titleAs="h3" title={tr(`${K}.checks.empty`)} body={tr(`${K}.checks.emptyBody`)} />}
        >
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {cap.shown.map((c, i) => (
              <LevelCheckRow key={c.id} c={c} first={i === 0} />
            ))}
          </ol>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </AsyncStateWrapper>
      </div>
    </Panel>
  );
}

const CHECK_ROLE_KEYS = ['coach', 'court_desk', 'manager', 'owner'] as const;

function LevelCheckRow({ c, first }: { c: LevelCheck; first: boolean }) {
  const { tr, locale } = useLocale();
  const at = new Date(c.checked_at);
  const name = playerName(c.player, tr) ?? tr(`${K}.board.unnamed`);
  const role = CHECK_ROLE_KEYS.find((r) => r === c.role);
  const by = tr(`${K}.checks.by`, {
    name: isolate(c.checked_by ?? tr(`${K}.checks.unknownChecker`)),
    role: role ? tr(`${K}.checks.role.${role}`) : '',
  });
  const flagged = c.applied && driftFlagged(c.drift);
  const games = c.games_after ?? 0;

  return (
    <li
      data-testid={`ranks-level-check-${c.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 'var(--tp-sp-1) var(--tp-sp-4)',
        alignItems: 'center',
        paddingBlock: 'var(--tp-sp-3)',
        borderBlockStart: first ? undefined : '1px solid var(--tp-border)',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700 }}>
            <bdi>{name}</bdi>
          </span>
          <StatusBadge size="sm" tone="neutral" dot={false} label={tr(`${K}.checks.class.${c.class}`)} />
        </div>
        <p style={hint}>
          <bdi>{`${by} · ${formatDate(at, locale)} ${formatTime(at, locale)}`}</bdi>
        </p>
        {c.note && <p style={hint}>{tr(`${K}.checks.note`, { note: isolate(c.note) })}</p>}
      </div>
      <div style={{ display: 'grid', justifyItems: 'end', gap: 'var(--tp-sp-1)', textAlign: 'end' }}>
        {!c.applied ? (
          <>
            <StatusBadge size="sm" tone="neutral" label={tr(`${K}.checks.skipped`)} title={tr(`${K}.checks.skippedHint`)} />
            <span style={{ ...hint, maxInlineSize: '16rem' }}>{tr(`${K}.checks.skippedHint`)}</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontVariantNumeric: 'tabular-nums' }}>
              <bdi dir="ltr">{levelText(c.level_set)}</bdi>
              {' → '}
              {games > 0 && c.level_after !== null ? <bdi dir="ltr">{levelText(c.level_after)}</bdi> : '…'}
            </span>
            <span style={hint}>
              {games > 0 && c.level_after !== null
                ? tr(`${K}.checks.after`, { level: levelText(c.level_after), games: formatNumber(games, locale) })
                : tr(`${K}.checks.noGames`)}
            </span>
            {typeof c.drift === 'number' && games > 0 && (
              <StatusBadge
                size="sm"
                tone={flagged ? 'warn' : 'neutral'}
                dot={flagged}
                label={tr(`${K}.checks.drift`, { drift: signedLevel(c.drift) })}
              />
            )}
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Results to check
// ---------------------------------------------------------------------------

function ResultsToCheckPanel() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const canVoid = can(staff, 'voidRanks');
  const q = useResultsToCheck();
  const rows = q.data ?? [];
  const cap = useListCap(rows);
  const status = asyncStatus(q, (d) => d.length === 0);
  const [voiding, setVoiding] = useState<CheckResult | null>(null);
  return (
    <Panel title={tr(`${K}.toCheck.title`)} data-testid="ranks-to-check">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <p style={{ ...muted, maxInlineSize: '70ch' }}>{tr(`${K}.toCheck.lead`)}</p>
        <AsyncStateWrapper
          status={status}
          error={q.error}
          onRetry={() => void q.refetch()}
          skeleton={<Skeleton lines={4} />}
          emptyContent={<EmptyState compact icon="checkCircle" titleAs="h3" title={tr(`${K}.toCheck.empty`)} body={tr(`${K}.toCheck.emptyBody`)} />}
        >
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {cap.shown.map((p, i) => (
              <PairRow key={`${p.first.id}-${p.second.id}`} pair={p} first={i === 0} canVoid={canVoid} onVoid={setVoiding} />
            ))}
          </ol>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </AsyncStateWrapper>
      </div>
      {voiding && <VoidDialog result={voiding} onClose={() => setVoiding(null)} />}
    </Panel>
  );
}

function PairRow({
  pair,
  first,
  canVoid,
  onVoid,
}: {
  pair: ResultPair;
  first: boolean;
  canVoid: boolean;
  onVoid: (r: CheckResult) => void;
}) {
  const { tr } = useLocale();
  return (
    <li
      data-testid={`ranks-pair-${pair.second.id}`}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-3)',
        borderBlockStart: first ? undefined : '1px solid var(--tp-border)',
      }}
    >
      <PairResult r={pair.first} tag={tr(`${K}.toCheck.first`)} canVoid={canVoid} onVoid={() => onVoid(pair.first)} />
      <PairResult r={pair.second} tag={tr(`${K}.toCheck.then`)} canVoid={canVoid} onVoid={() => onVoid(pair.second)} />
    </li>
  );
}

function PairResult({ r, tag, canVoid, onVoid }: { r: CheckResult; tag: string; canVoid: boolean; onVoid: () => void }) {
  const { tr, locale } = useLocale();
  const played = new Date(r.played_at);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3.5rem minmax(0, 1fr) auto', gap: 'var(--tp-sp-1) var(--tp-sp-3)', alignItems: 'center' }}>
      <span style={{ ...hint, fontWeight: 700, textTransform: 'uppercase' }}>{tag}</span>
      <div style={{ display: 'grid', gap: '0.125rem', minInlineSize: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <Team players={r.a} won={r.winner === 'a'} />
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`${K}.results.versus`)}</span>
          <Team players={r.b} won={r.winner === 'b'} />
        </div>
        <p style={hint}>
          <bdi>{[`${formatDate(played, locale)} ${formatTime(played, locale)}`, tr(`${K}.results.source.${r.source}`)].join(' · ')}</bdi>
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)' }}>
        {r.score && (
          <span dir="ltr" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {r.score}
          </span>
        )}
        {canVoid && (
          <Button size="sm" kind="ghost" icon="ban" onClick={onVoid} data-testid={`ranks-pair-void-${r.id}`}>
            {tr(`${K}.results.void`)}
          </Button>
        )}
      </div>
    </div>
  );
}
