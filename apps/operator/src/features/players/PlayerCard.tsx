/**
 * The customer record's Player card (0368; customers contracts §5). Majed,
 * 2026-10-24: the level a player claims "will not be final, it will be
 * measured, and a manager or their performance will judge if that level is
 * actually accurate".
 *
 * So the card says, in one glance: the age band, the level the club goes by
 * and where it came from (the player's own word, or a coach or the desk who
 * confirmed it), what the games suggest when they disagree, and what the
 * player is into — derived from what they did here, never asked. It opens the
 * editor in a dialog, like the Discount card beside it.
 *
 * Since 0451 the last two (what the games suggest, the interest tags) are
 * worked out only when the desk presses "Show games and interests"
 * (app.customer_player_insights): opening a customer no longer waits on them.
 */
import { formatDate, formatNumber, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Figure, SectionCard } from '../desk/customers/RecordCards';
import { INTEREST_TAGS, type PlayerFacts, type PlayerInsights } from './playerLogic';

const K = 'ws.players';

/** The on-demand facts (0451): not asked yet, being worked out, failed, or here. */
export interface InsightsAsk {
  insights: PlayerInsights | null;
  loading: boolean;
  failed: boolean;
  onLoad: () => void;
}

export function PlayerCard({
  facts,
  ask,
  tz,
  canJudge,
  onOpen,
}: {
  facts: PlayerFacts;
  ask: InsightsAsk;
  tz: string;
  /** Court desk, manager, owner. A reader still sees everything. */
  canJudge: boolean;
  onOpen: () => void;
}) {
  const { tr, locale } = useLocale();
  const level = facts.effectiveLevel;
  const judged = facts.confirmedLevel !== null;
  const insights = ask.insights;
  const suggests = insights?.suggested && insights.suggested.level !== level ? insights.suggested : null;
  // The card is one big button that opens the dialog, so the on-demand row
  // sits under it, in the same grid cell, never inside it.
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', alignContent: 'start' }}>
      <SectionCard
        icon="users"
        tone="player"
        testId="card-player"
        title={tr(`${K}.card.title`)}
        sub={facts.ageBand ? tr(`${K}.band.${facts.ageBand}`) : tr(`${K}.card.noBand`)}
        openLabel={tr(canJudge ? `${K}.card.open` : `${K}.card.view`)}
        onOpen={onOpen}
      >
        <Figure
          size="md"
          value={level ? tr(`${K}.level.${level}`) : tr(`${K}.card.noLevel`)}
          unit={
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              {tr(judged ? `${K}.card.byClub` : `${K}.card.byPlayer`)}
            </span>
          }
        />
        {/* Where the level came from: who judged it and when, or that nobody has. */}
        {judged && facts.confirmedAt && (
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(`${K}.card.confirmedBy`, {
              who: isolate(facts.confirmedByName ?? tr(`${K}.card.someone`)),
              role: tr(`${K}.role.${facts.confirmedRole ?? 'court_desk'}`),
              date: formatDate(new Date(facts.confirmedAt), locale, tz),
            })}
          </span>
        )}
        {judged && facts.claimedLevel && facts.claimedLevel !== facts.confirmedLevel && (
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(`${K}.card.claimed`, { level: tr(`${K}.level.${facts.claimedLevel}`) })}
          </span>
        )}
        {facts.note && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <bdi>{facts.note}</bdi>
          </span>
        )}
        {/* What the games say, only when they disagree with the record. */}
        {suggests && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-warn-fg)', background: 'var(--tp-warn-soft)', borderRadius: 'var(--tp-radius-chip)', paddingInline: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-1)' }}>
            {tr(`${K}.card.suggests`, {
              level: tr(`${K}.level.${suggests.level}`),
              games: formatNumber(suggests.games, locale),
              wins: formatNumber(suggests.wins, locale),
            })}
          </span>
        )}
        {insights && <InterestChips tags={insights.interests} />}
      </SectionCard>
      {!insights && <InsightsButton ask={ask} />}
    </div>
  );
}

/** "Show games and interests": asks app.customer_player_insights (0451). */
export function InsightsButton({ ask }: { ask: InsightsAsk }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
      <Button
        size="sm"
        icon="spark"
        busy={ask.loading}
        disabled={ask.loading}
        onClick={ask.onLoad}
        data-testid="player-insights-load"
      >
        {tr(ask.loading ? `${K}.insights.loading` : `${K}.insights.load`)}
      </Button>
      {ask.failed && !ask.loading && (
        <span role="alert" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)' }}>
          {tr(`${K}.insights.failed`)}
        </span>
      )}
    </span>
  );
}

/**
 * The derived tags, in the server's order, at most six on the card: the rest
 * are in the dialog. Chips, not a sentence: the desk reads them at a glance
 * while a guest is standing there.
 */
export function InterestChips({ tags, max = 6 }: { tags: readonly string[]; max?: number }) {
  const { tr } = useLocale();
  const known = INTEREST_TAGS.filter((t) => tags.includes(t));
  if (known.length === 0) {
    return (
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockStart: 'auto' }}>
        {tr(`${K}.card.noInterests`)}
      </span>
    );
  }
  const shown = known.slice(0, max);
  const rest = known.length - shown.length;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1)', marginBlockStart: 'auto' }}>
      {shown.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: 'var(--tp-fs-xs)',
            fontWeight: 600,
            borderRadius: 'var(--tp-radius-chip)',
            paddingInline: 'var(--tp-sp-2)',
            paddingBlock: 'var(--tp-sp-1)',
            background: 'var(--tp-breakdown-violet)',
            color: 'var(--tp-breakdown-violet-fg)',
          }}
        >
          {tr(`${K}.interest.${tag}`)}
        </span>
      ))}
      {rest > 0 && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', alignSelf: 'center' }}>
          {tr(`${K}.card.moreTags`, { n: rest })}
        </span>
      )}
    </span>
  );
}
