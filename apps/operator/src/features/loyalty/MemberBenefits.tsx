/**
 * What the bill customer's card gives (0410, app.loyalty_tab_benefits), inside the member block
 * of a bill: the card by name and colour, its privileges as a short list, and the deal the
 * member picked in the app.
 *
 * Two kinds of privilege read differently because the cashier does different things with them:
 * free add-ons are taken off by the till itself (useAutoTierPerks; the bill's "Card privileges"
 * row carries the amount), so the line only says so; anything else is honoured by hand, so it
 * is marked for the cashier to act on and to tell the guest.
 *
 * The deal: the member picked it in the app and shows their card. Where the host can apply a
 * promotion (the café till) it gets an Apply button that runs the host's own apply; elsewhere
 * (the shop till, the desk's booking bill) it is named, as information. A deal already on the
 * bill says so.
 */
import { formatIQD, formatNumber } from '@touch/i18n';
import { tierColor, type TabBenefits } from '@touch/core/loyalty';
import { useLocale, pickName } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { MessagePresenter, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { TierCardChip } from './TierColorPicker';

const K = 'ws.loyalty.benefits';

/** The host's promotion apply, for the deal the member picked. */
export interface DealAction {
  /** Runs the host's own "Apply promotion" (the picked deal goes first); absent: no apply here. */
  apply?: () => void;
  busy?: boolean;
  /** What the last press came to. */
  notice?: { tone: 'success' | 'refused'; text: string } | null;
}

const row = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--tp-sp-2)',
  fontSize: 'var(--tp-fs-sm)',
} as const;

const small = { fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' } as const;

export function MemberBenefits({
  benefits,
  open,
  deal,
}: {
  benefits: TabBenefits;
  /** The bill still takes changes: a deal can be applied. */
  open: boolean;
  deal?: DealAction;
}) {
  const { tr, locale } = useLocale();
  const tier = benefits.tier;
  const picked = benefits.deal;
  const free = benefits.addons.on_bill_iqd;

  return (
    <div
      data-testid="member-benefits"
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        paddingBlockStart: 'var(--tp-sp-2)',
        borderBlockStart: '1px solid var(--tp-border)',
      }}
    >
      {benefits.perks.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
            {tier && <TierCardChip color={tierColor(tier.color)} width={28} />}
            <span data-testid="member-card-name">
              {tier ? tr(`${K}.cardGives`, { tier: pickName(locale, tier) }) : tr(`${K}.cardGivesPlain`)}
            </span>
          </span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {benefits.perks.map((p) => (
              <li key={p.id} style={row} data-testid="member-perk" data-kind={p.kind}>
                <bdi style={{ minInlineSize: 0 }}>{pickName(locale, p)}</bdi>
                {p.kind === 'free_addons' ? (
                  <span style={{ ...small, flexShrink: 0 }}>{tr(`${K}.auto`)}</span>
                ) : (
                  <StatusBadge tone="info" size="sm" dot={false} label={tr(`${K}.byHand`)} style={{ flexShrink: 0 }} />
                )}
              </li>
            ))}
          </ul>
          {free > 0 && (
            <span style={small} data-testid="member-perk-on-bill">
              {tr(`${K}.onBill`, { amount: formatIQD(free, locale) })}
            </span>
          )}
        </div>
      )}

      {picked && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="member-deal">
          <span style={{ ...small, fontWeight: 600 }}>{tr(`${K}.dealTitle`)}</span>
          <div style={{ ...row, alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minInlineSize: 0, flexWrap: 'wrap' }}>
              <Icon name="tag" size={13} />
              <bdi style={{ fontWeight: 600 }}>{pickName(locale, picked)}</bdi>
              <span style={{ color: 'var(--tp-muted-fg)' }}>
                {picked.type === 'percent'
                  ? tr(`${K}.dealPercent`, { value: formatNumber(picked.value, locale) })
                  : tr('ws.loyalty.rewards.iqdOff', { amount: formatIQD(picked.value, locale) })}
              </span>
            </span>
            {picked.applied ? (
              <StatusBadge tone="success" size="sm" icon="check" dot={false} label={tr(`${K}.dealApplied`)} style={{ flexShrink: 0 }} />
            ) : deal?.apply && open ? (
              <Button size="sm" kind="primary" busy={deal.busy} disabled={deal.busy} onClick={deal.apply} data-testid="member-deal-apply">
                {tr(`${K}.dealApply`)}
              </Button>
            ) : null}
          </div>
          {!picked.applied && !(deal?.apply && open) && <span style={small}>{tr(`${K}.dealElsewhere`)}</span>}
          {deal?.notice && <MessagePresenter tone={deal.notice.tone} message={deal.notice.text} />}
        </div>
      )}
    </div>
  );
}
