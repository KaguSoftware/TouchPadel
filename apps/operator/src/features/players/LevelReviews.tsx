/**
 * "Levels to check" (0368; customers contracts §1.2, §5): the players whose
 * confirmed games disagree with what the club has on record, biggest
 * disagreement first.
 *
 * Majed, 2026-10-24: a level "will not be final, it will be measured, and a
 * manager or their performance will judge if that level is actually accurate".
 * The measurement is the server's (app.level_suggestions: at least five
 * confirmed results, scored against the levels of the people they played),
 * and the judgment is still a person's — each row offers the suggestion or
 * the player's own claim, and either one takes the row off the list.
 *
 * It sits on the player ranks page, where levels already live. The desk
 * confirms a level from the customer record instead, mid-conversation.
 */
import { formatDate, formatNumber, isolate } from '@touch/i18n';
import { Link } from '@tanstack/react-router';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, Panel, ViewMore, asyncStatus, useListCap } from '../../components/kit';
import { reviewChoices, type LevelReview, type PlayLevel } from './playerLogic';
import { rpcMissing, useConfirmLevel, useLevelReviews } from './usePlayers';

const K = 'ws.players';

export function LevelReviews({ canJudge, tz }: { canJudge: boolean; tz: string }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const { reachable } = useStationReach();
  const q = useLevelReviews(true);
  const confirm = useConfirmLevel();
  const rows = q.data ?? [];
  const cap = useListCap(rows);

  // A server without 0368 has no queue at all; the page simply does not show it.
  if (rpcMissing(q.error)) return null;

  const decide = async (row: LevelReview, level: PlayLevel) => {
    try {
      await confirm.mutateAsync({ profileId: row.profileId, level });
      toast.ok(tr(`${K}.reviews.confirmed`, { name: isolate(row.fullName), level: tr(`${K}.level.${level}`) }));
    } catch {
      // The error line under the panel says what happened; the toast would double it.
    }
  };

  return (
    <Panel title={tr(`${K}.reviews.title`)}>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)' }}>{tr(`${K}.reviews.lead`)}</p>
      <AsyncStateWrapper
        status={asyncStatus(q, (data) => data.length === 0)}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyContent={<EmptyState kind="nothingToDo" title={tr(`${K}.reviews.empty`)} body={tr(`${K}.reviews.emptyBody`)} />}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {cap.shown.map((row) => {
            const choices = reviewChoices(row);
            return (
              <li
                key={row.profileId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 'var(--tp-sp-3)',
                  alignItems: 'center',
                  padding: 'var(--tp-sp-3)',
                  borderRadius: 'var(--tp-radius-panel)',
                  border: '1px solid var(--tp-border)',
                  background: 'var(--tp-surface)',
                }}
              >
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                  <Link
                    to="/desk/customers/$id"
                    params={{ id: row.profileId }}
                    style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    <bdi>{row.fullName}</bdi>
                  </Link>
                  <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
                    {tr(`${K}.reviews.row`, {
                      claimed: row.confirmed
                        ? tr(`${K}.level.${row.confirmed}`)
                        : row.claimed
                          ? tr(`${K}.level.${row.claimed}`)
                          : tr(`${K}.card.noLevel`),
                      suggested: tr(`${K}.level.${row.suggested}`),
                    })}
                  </span>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                    {tr(`${K}.reviews.basis`, {
                      games: formatNumber(row.games, locale),
                      wins: formatNumber(row.wins, locale),
                      losses: formatNumber(row.losses, locale),
                    })}
                    {row.lastPlayedAt
                      ? ` · ${tr(`${K}.reviews.lastPlayed`, { date: formatDate(new Date(row.lastPlayedAt), locale, tz) })}`
                      : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button
                    kind="primary"
                    busy={confirm.isPending && confirm.variables?.profileId === row.profileId && confirm.variables?.level === choices.confirm}
                    disabled={!canJudge || confirm.isPending || !reachable}
                    disabledReason={!canJudge ? tr(`${K}.dialog.readerOnly`) : !reachable ? tr(`${K}.offline`) : undefined}
                    onClick={() => void decide(row, choices.confirm)}
                  >
                    {tr(`${K}.reviews.confirm`, { level: tr(`${K}.level.${choices.confirm}`) })}
                  </Button>
                  {choices.keep && (
                    <Button
                      busy={confirm.isPending && confirm.variables?.profileId === row.profileId && confirm.variables?.level === choices.keep}
                      disabled={!canJudge || confirm.isPending || !reachable}
                      disabledReason={!canJudge ? tr(`${K}.dialog.readerOnly`) : !reachable ? tr(`${K}.offline`) : undefined}
                      onClick={() => void decide(row, choices.keep!)}
                    >
                      {tr(`${K}.reviews.keep`, { level: tr(`${K}.level.${choices.keep}`) })}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
      </AsyncStateWrapper>
      <ErrorText error={confirm.error} />
    </Panel>
  );
}
