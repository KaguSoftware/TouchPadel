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
 * 0445: what each free line on the bill is for (a birthday gift, the drink card's free drink, a
 * free-with, free add-ons), summed by reason from loyalty_tab_benefits.lines; the member's drink
 * card (x of N, its free drink ready, on this bill or held on another) and the card gifts open
 * now: birthday, monthly, on reaching the card (app.loyalty_card_extras), each marked when this
 * bill carries it (a gift line, or the court hour it took off the bill's booking: court_gift). Each is one line, so the desk reads it at a glance.
 * A ring and a drink card size do nothing on a bill and are not listed (billPerks).
 *
 * 0445 (Redeem in the app, Majed 2026-11-15): a ready free drink and each open card gift reach a
 * bill only once claimed. Each says either "Redeemed in the app · until ..." (the claim's end:
 * seven days for a free drink, the gift's own window for a gift) or "Waiting for the member to
 * redeem" with "Give it now", the till's press for a member without the app
 * (app.claim_card_reward_for_tab), offered while the bill still takes changes.
 *
 * The deal: the member picked it in the app and shows their card. Where the host can apply a
 * promotion (the café till) it gets an Apply button that runs the host's own apply; elsewhere
 * (the shop till, the desk's booking bill) it is named, as information. A deal already on the
 * bill says so.
 */
import { useState } from 'react';
import { formatDateTime, formatIQD, formatNumber } from '@touch/i18n';
import { tierColor, type CardRewardKind, type GiftWhen, type PerkLineKind, type TabBenefits } from '@touch/core/loyalty';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { MessagePresenter, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { TierCardChip } from './TierColorPicker';
import {
  billPerks,
  giftsToday,
  memberCardShown,
  perkHandling,
  perkLineTotals,
  rewardClaim,
  stampState,
  type RewardClaim,
  type PerkLineReason,
  type StampState,
} from './loyaltyLogic';
import { useCardExtras, useClaimCardReward } from './useLoyalty';

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

/** The i18n leaf of a free line's reason. */
export const LINE_WORD: Record<Exclude<PerkLineKind, 'gift'>, 'stamp' | 'freeWith' | 'sizeUpgrade' | 'free_addons'> = {
  stamp: 'stamp',
  free_with: 'freeWith',
  size_upgrade: 'sizeUpgrade',
  free_addons: 'free_addons',
};

type Tr = ReturnType<typeof useLocale>['tr'];

/** A reason's plain word: a gift by its `when` ("Birthday gift", "Monthly gift", "Welcome gift"). */
export function reasonWord(kind: PerkLineKind, when: GiftWhen | null, tr: Tr): string {
  if (kind === 'gift') return tr(`${K}.lines.gift.${when ?? 'other'}`);
  return tr(`${K}.lines.${LINE_WORD[kind]}`);
}

/**
 * A free line's reason as the till prints it under the line: "Birthday gift", "Free drink, card
 * full", the free-with privilege's own name (the owner wrote it: "Free Tea with Desserts"), "Free
 * add-ons"; then the units freed on a line of several, and the amount.
 */
export function lineReasonLabel(
  r: PerkLineReason,
  qty: number,
  tr: ReturnType<typeof useLocale>['tr'],
  locale: ReturnType<typeof useLocale>['locale'],
): string {
  const word = r.kind === 'free_with' && r.perk ? pickName(locale, r.perk) : reasonWord(r.kind, r.when, tr);
  const units = qty > 1 && r.units > 0 && r.kind !== 'free_addons' ? ` ${tr(`${K}.lines.units`, { n: formatNumber(r.units, locale) })}` : '';
  return `${word}${units} · −${formatIQD(r.amount_iqd, locale)}`;
}

const STAMP_TONE: Partial<Record<StampState, 'success' | 'info'>> = {
  ready: 'success',
  onThisBill: 'success',
  heldElsewhere: 'info',
};

/** The drink card as dots, one per stamp of the card's size: what the guest's phone shows, in small. */
function StampDots({ count, size }: { count: number; size: number }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 'var(--tp-sp-0)', flexWrap: 'wrap' }}>
      {Array.from({ length: size }, (_, i) => (
        <span
          key={i}
          style={{
            inlineSize: 8,
            blockSize: 8,
            borderRadius: '50%',
            boxSizing: 'border-box',
            background: i < count ? 'var(--tp-accent)' : 'transparent',
            border: `1px solid ${i < count ? 'var(--tp-accent)' : 'var(--tp-border-input)'}`,
          }}
        />
      ))}
    </span>
  );
}

/** The till's line for a deal's value: "10% off", "5,000 IQD off", "Buy 1, get 1 free". */
export function dealValueText(deal: Pick<NonNullable<TabBenefits['deal']>, 'type' | 'value'>, tr: Tr, locale: ReturnType<typeof useLocale>['locale']): string {
  if (deal.type === 'free_item') {
    // 0445: value is the percent off each unit given, 100 = free; never an IQD amount.
    return deal.value >= 100 ? tr(`${K}.dealFreeItem`) : tr(`${K}.dealFreeItemPercent`, { value: formatNumber(deal.value, locale) });
  }
  return deal.type === 'percent'
    ? tr(`${K}.dealPercent`, { value: formatNumber(deal.value, locale) })
    : tr('ws.loyalty.rewards.iqdOff', { amount: formatIQD(deal.value, locale) });
}

/**
 * Where a free drink or a gift stands with its claim (0445): redeemed until when, or waiting,
 * with "Give it now" while the bill takes changes; a refusal shows under it.
 */
function ClaimLine({
  claim,
  name,
  canGive,
  busy,
  error,
  onGive,
  testId,
}: {
  claim: RewardClaim;
  name: string;
  canGive: boolean;
  busy: boolean;
  error: unknown;
  onGive: () => void;
  testId: string;
}) {
  const { tr, locale } = useLocale();
  const code = (error as { code?: unknown } | null)?.code;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid={testId} data-claim={claim.kind}>
      {claim.kind === 'claimed' ? (
        <span>
          <StatusBadge tone="success" size="sm" dot={false} icon="check" label={tr(`${K}.claim.redeemed`, { when: formatDateTime(new Date(claim.until), locale) })} />
        </span>
      ) : (
        <span style={{ ...row, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <span style={small}>{tr(`${K}.claim.waiting`)}</span>
          {canGive && (
            <Button size="sm" busy={busy} disabled={busy} onClick={onGive} aria-label={tr(`${K}.claim.giveNowFor`, { name })} data-testid={`${testId}-give`}>
              {tr(`${K}.claim.giveNow`)}
            </Button>
          )}
        </span>
      )}
      <ErrorText error={error} message={code === 'REWARD_NOT_READY' ? tr(`${K}.claim.notReady`) : null} style={{ marginBlock: 0 }} />
    </div>
  );
}

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
  const perks = billPerks(benefits.perks);
  const lines = benefits.lines;
  const totals = perkLineTotals(lines, benefits.perks);
  const extras = useCardExtras({ tabId: benefits.tab_id, customerId: benefits.customer_id, enabled: memberCardShown(benefits) });
  const stamp = stampState(extras, lines);
  const gifts = giftsToday(extras, lines, benefits.court_gift ?? null);
  // 0445: "Give it now" for a member without the app; which reward it was for, and its refusal.
  const claim = useClaimCardReward(benefits.tab_id, benefits.customer_id);
  const [failed, setFailed] = useState<{ key: string; error: unknown } | null>(null);
  const pendingKey = claim.isPending ? (claim.variables?.perkId ?? claim.variables?.kind ?? null) : null;
  const give = (kind: CardRewardKind, perkId: string | null) => {
    const key = perkId ?? kind;
    setFailed(null);
    claim.mutate({ kind, perkId }, { onError: (error) => setFailed({ key, error }) });
  };

  // Nothing of the card to show: no block at all.
  if (perks.length === 0 && !picked && stamp === 'off' && gifts.length === 0 && totals.length === 0) return null;

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
      {(perks.length > 0 || totals.length > 0) && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
            {tier && <TierCardChip color={tierColor(tier.color)} width={28} />}
            <span data-testid="member-card-name">
              {tier ? tr(`${K}.cardGives`, { tier: pickName(locale, tier) }) : tr(`${K}.cardGivesPlain`)}
            </span>
          </span>
          {perks.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
              {perks.map((p) => (
                <li key={p.id} style={row} data-testid="member-perk" data-kind={p.kind}>
                  <bdi style={{ minInlineSize: 0 }}>{pickName(locale, p)}</bdi>
                  {perkHandling(p.kind) === 'till' ? (
                    <span style={{ ...small, flexShrink: 0 }}>{tr(`${K}.auto`)}</span>
                  ) : (
                    <StatusBadge tone="info" size="sm" dot={false} label={tr(`${K}.byHand`)} style={{ flexShrink: 0 }} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* 0445: what the card frees on this bill, by reason; an older server sends no lines. */}
          {totals.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
              {totals.map((x) => (
                <li key={`${x.kind}:${x.when ?? ''}`} style={{ ...small, color: 'var(--tp-fg)', display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }} data-testid="member-perk-line-total" data-kind={x.kind}>
                  <Icon name={x.kind === 'gift' ? 'gift' : 'star'} size={12} />
                  {tr(`${K}.lines.total`, { label: reasonWord(x.kind, x.when, tr), amount: formatIQD(x.amount_iqd, locale) })}
                </li>
              ))}
            </ul>
          ) : (
            free > 0 && (
              <span style={small} data-testid="member-perk-on-bill">
                {tr(`${K}.onBill`, { amount: formatIQD(free, locale) })}
              </span>
            )
          )}
        </div>
      )}

      {/* 0445: the drink card, at a glance; a full one says whether its free drink is redeemed. */}
      {extras && stamp !== 'off' && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <div style={{ ...row, alignItems: 'center', flexWrap: 'wrap' }} data-testid="member-stamps" data-state={stamp}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', minInlineSize: 0, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{tr(`${K}.stamps.title`)}</span>
              <StampDots count={Math.min(extras.stamps.count, extras.stamps.size)} size={extras.stamps.size} />
              <span style={{ fontVariantNumeric: 'tabular-nums' }} data-testid="member-stamps-count">
                {tr(`${K}.stamps.count`, {
                  count: formatNumber(Math.min(extras.stamps.count, extras.stamps.size), locale),
                  size: formatNumber(extras.stamps.size, locale),
                })}
              </span>
            </span>
            {STAMP_TONE[stamp] ? (
              <StatusBadge tone={STAMP_TONE[stamp]} size="sm" dot={false} icon={stamp === 'heldElsewhere' ? 'info' : 'check'} label={tr(`${K}.stamps.${stamp}`)} style={{ flexShrink: 0 }} />
            ) : (
              <span style={{ ...small, flexShrink: 0 }}>
                {tr(`${K}.stamps.filling`, { remaining: formatNumber(Math.max(extras.stamps.size - extras.stamps.count, 0), locale) })}
              </span>
            )}
          </div>
          {stamp === 'ready' && (
            <ClaimLine
              claim={rewardClaim(extras.stamps.claimed_until)}
              name={tr(`${K}.stamps.title`)}
              canGive={open}
              busy={pendingKey === 'stamp'}
              error={failed?.key === 'stamp' ? failed.error : null}
              onGive={() => give('stamp', null)}
              testId="member-stamps-claim"
            />
          )}
        </div>
      )}

      {/* 0445: the card gifts open now (birthday, monthly, on reaching the card). */}
      {gifts.map((g) => {
        const name = pickName(locale, g);
        const giftOpen = g.state === 'open';
        return (
          <div key={g.perk_id} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }} data-testid="member-gift" data-state={g.state} data-when={g.when}>
            <div style={{ ...row, alignItems: 'center', justifyContent: 'flex-start' }}>
              <Icon name={g.when === 'birthday' ? 'cake' : 'gift'} size={14} />
              {giftOpen || g.state === 'onThisBill' ? (
                <StatusBadge tone="success" size="sm" dot={false} label={giftOpen ? tr(`${K}.gifts.open.${g.when}`, { name }) : tr(`${K}.gifts.onThisBill`, { name })} />
              ) : (
                <span style={g.state === 'tooRecent' ? { color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-sm)' } : small}>
                  {tr(g.state === 'tooRecent' ? `${K}.gifts.tooRecent` : `${K}.gifts.used`, { name })}
                </span>
              )}
            </div>
            {/* A court hour is taken off the booking's bill, not a café bill: said once, beside it. */}
            {giftOpen && g.target === 'court_hour' && <span style={small}>{tr(`${K}.gifts.courtHint`)}</span>}
            {giftOpen && (
              <ClaimLine
                claim={rewardClaim(g.claimed_until)}
                name={name}
                canGive={open}
                busy={pendingKey === g.perk_id}
                error={failed?.key === g.perk_id ? failed.error : null}
                onGive={() => give('gift', g.perk_id)}
                testId="member-gift-claim"
              />
            )}
          </div>
        );
      })}

      {picked && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="member-deal">
          <span style={{ ...small, fontWeight: 600 }}>{tr(`${K}.dealTitle`)}</span>
          <div style={{ ...row, alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minInlineSize: 0, flexWrap: 'wrap' }}>
              <Icon name="tag" size={13} />
              <bdi style={{ fontWeight: 600 }}>{pickName(locale, picked)}</bdi>
              <span style={{ color: 'var(--tp-muted-fg)' }}>
                {dealValueText(picked, tr, locale)}
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
