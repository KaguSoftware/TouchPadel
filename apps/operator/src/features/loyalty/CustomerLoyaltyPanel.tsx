/**
 * A customer's loyalty on the record (docs/design/loyalty/build-contracts-2026-10-05.md §1.3,
 * plan §5.3): balance, tier, the last 12 months' points, points ever earned, and the 100 newest
 * ledger rows, from app.loyalty_customer (every desk role).
 *
 * "Adjust points" (manager, owner: adjustLoyalty) asks for the points and a reason first (the
 * guest reads the reason in their history; REASON_REQUIRED on the server), then a manager PIN,
 * then app.loyalty_adjust (adjustPoints: verify_manager_pin first, the 0115 grant pattern). A
 * PIN refusal stays on the PIN prompt; anything else comes back to the form.
 *
 * A server without loyalty (RPC_MISSING) shows nothing. Adjusting is online only.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatIQD, formatMonthShort, formatNumber } from '@touch/i18n';
import { isRpcMissing } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { DataTable, Panel, PinPromptOverlay, StatusBadge, type Column } from '../../components/kit';
import { adjustErrors, isPinRefusal, ledgerKind, monthlyEarned, parseSigned } from './loyaltyLogic';
import { LOYALTY_KEYS, adjustPoints, useLoyaltyCustomer, useLoyaltyTerms } from './useLoyalty';
import type { LedgerRow } from '@touch/core/loyalty';
import { CardPill } from '../desk/customers/RecordCards';
import { tierColour } from '../desk/customers/recordSummary';

const K = 'ws.loyalty';

export function CustomerLoyaltyPanel({ customerId, tz, withTop = true }: { customerId: string; tz: string; withTop?: boolean }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { reachable } = useStationReach();
  const allowed = can(staff, 'attachMember');
  const q = useLoyaltyCustomer(customerId, allowed);
  const [adjusting, setAdjusting] = useState(false);
  const canAdjust = can(staff, 'adjustLoyalty');
  // The point value and the smallest use, for "≈ … off" and "Ready to use".
  const termsQ = useLoyaltyTerms(allowed);

  if (!allowed || isRpcMissing(q.error)) return null;
  const d = q.data;
  const tier = d?.tier ? (locale === 'ar' ? d.tier.name_ar : d.tier.name_en) : null;

  return (
    <Panel
      title={tr(`${K}.panel.title`)}
      data-testid="customer-loyalty"
    >
      {q.isLoading && <Skeleton lines={3} />}
      {q.isError && !d && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      )}
      {d && (
        <LoyaltyBody
          data={d}
          withTop={withTop}
          tz={tz}
          tier={tier}
          pointValueIqd={termsQ.data?.pointValueIqd ?? null}
          minRedeemPoints={termsQ.data?.minRedeemPoints ?? null}
          adjust={
            canAdjust ? (
              <Button
                kind="primary"
                icon="sliders"
                disabled={!reachable}
                disabledReason={reachable ? undefined : tr(`${K}.member.noConnection`)}
                onClick={() => setAdjusting(true)}
              >
                {tr(`${K}.adjust.button`)}
              </Button>
            ) : null
          }
        />
      )}
      {adjusting && <AdjustDialog customerId={customerId} onClose={() => setAdjusting(false)} />}
    </Panel>
  );
}

/**
 * The loyalty dialog's body (owner's pick "D", 2026-10-15): the points as a big
 * figure with what they are worth and whether they can be used, tiles in the
 * owner's four colours (.tp-tone-tile), the points earned per month for the last
 * six months, then the history in the app's standard table, and Adjust points
 * at the foot.
 */
/**
 * The loyalty dialog's top: the points card and the tiles. The record shows it
 * inside the dialog's coloured header (CustomerLoyaltyTop), like the bookings
 * dialog's count tiles; in a band, the cards wear the header's moving ground
 * (.tp-band-scope in GlobalStyles).
 */
function LoyaltyTop({
  data: d,
  tier,
  tierKey,
  pointValueIqd,
  minRedeemPoints,
}: {
  data: { balance: number; lifetime: number; points_12m: number; tier: { multiplier: number; name_en?: string } | null };
  tier: string | null;
  /** The tier's card colour (tierColour), as the record's loyalty card has it. */
  tierKey: string | null;
  pointValueIqd: number | null;
  minRedeemPoints: number | null;
}) {
  const { tr, locale } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  const ready = minRedeemPoints != null && minRedeemPoints > 0 && d.balance >= minRedeemPoints;
  const tile = (key: string, label: string, value: ReactNode, span?: boolean, tone?: string) => (
    <div
      key={key}
      className="tp-tone-tile"
      style={{
        // A colour by name instead of by place (the tier tile wears its tier's).
        ...(tone ? ({ '--tp-tone': tone } as CSSProperties) : null),
        border: '1px solid var(--tp-tone)',
        borderBlockStart: '6px solid var(--tp-tone)',
        borderRadius: 'var(--tp-radius-panel)',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-3)',
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        gridColumn: span ? '1 / -1' : undefined,
      }}
    >
      <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-band-ink, var(--tp-fg))' }}>{label}</span>
      <span style={{ color: 'var(--tp-band-ink, var(--tp-fg))' }}>{value}</span>
    </div>
  );
  const figure = (v: number) => (
    <span style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 'var(--tp-fs-2xl)', lineHeight: 1 }}>{n(v)}</span>
  );

  return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
        <div
          // The record's loyalty card itself (owner, 2026-10-15): the same tier
          // ground, motion, ink and shine (.tp-record-card[data-tone='loyalty']).
          className="tp-record-card"
          data-tone="loyalty"
          data-tier={tierKey ?? undefined}
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderColor: 'var(--tp-loyalty-edge)',
            paddingBlock: 'var(--tp-sp-4)',
            paddingInline: 'var(--tp-sp-4)',
            display: 'grid',
            gap: 'var(--tp-sp-2)',
            alignContent: 'start',
          }}
        >
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-band-ink, var(--tp-muted-fg))' }}>
            {tr(`${K}.panel.balance`)}
            {tier && <CardPill tone="tier">{tier}</CardPill>}
          </span>
          <span data-testid="loyalty-balance" style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '2.75rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
            {n(d.balance)}
          </span>
          {(pointValueIqd != null && d.balance > 0) || ready ? (
            <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              {pointValueIqd != null && d.balance > 0 && (
                <StatusBadge tone="success" size="sm" dot={false} label={tr(`${K}.panel.worth`, { amount: formatIQD(d.balance * pointValueIqd, locale) })} />
              )}
              {ready && <StatusBadge tone="info" size="sm" dot={false} label={tr(`${K}.panel.ready`)} />}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
          {tile('12m', tr(`${K}.panel.points12m`), figure(d.points_12m))}
          {tile('lifetime', tr(`${K}.panel.lifetime`), figure(d.lifetime))}
          {tile(
            'tier',
            tr(`${K}.panel.tier`),
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-xl)' }}>{tier ? <bdi>{tier}</bdi> : tr(`${K}.panel.noTier`)}</span>
              {d.tier && <span style={{ color: 'var(--tp-band-ink, var(--tp-muted-fg))', opacity: 0.8, fontSize: 'var(--tp-fs-sm)' }}>{tr(`${K}.panel.earns`, { multiplier: formatNumber(d.tier.multiplier, locale) })}</span>}
            </span>,
            true,
            // Its tier's own colour, not the black of its place, which blue mode turns
            // white and loses on the white tile (owner, 2026-10-15), deepened a quarter so the pale
            // silver and platinum still show on white. Member: the night-court navy.
            tierKey ? `color-mix(in oklab, var(--tp-tier-${tierKey}) 75%, var(--tp-brand-black))` : 'color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black))',
          )}
        </div>
      </div>
  );
}

/** The top of a customer's loyalty, for the dialog's header: null where the panel shows nothing. */
export function CustomerLoyaltyTop({ customerId }: { customerId: string }) {
  const { locale } = useLocale();
  const { staff } = useAuth();
  const allowed = can(staff, 'attachMember');
  const q = useLoyaltyCustomer(customerId, allowed);
  const termsQ = useLoyaltyTerms(allowed);
  const d = q.data;
  if (!allowed || !d) return null;
  const tier = d.tier ? (locale === 'ar' ? d.tier.name_ar : d.tier.name_en) : null;
  return <LoyaltyTop data={d} tier={tier} tierKey={tierColour(d.tier?.name_en)} pointValueIqd={termsQ.data?.pointValueIqd ?? null} minRedeemPoints={termsQ.data?.minRedeemPoints ?? null} />;
}

function LoyaltyBody({
  data: d,
  tz,
  tier,
  pointValueIqd,
  minRedeemPoints,
  adjust,
  withTop = true,
}: {
  data: { balance: number; lifetime: number; points_12m: number; tier: { multiplier: number; name_en?: string } | null; history: LedgerRow[] };
  tz: string;
  tier: string | null;
  pointValueIqd: number | null;
  minRedeemPoints: number | null;
  adjust: ReactNode;
  /** False when the dialog's header carries the top (CustomerLoyaltyTop). */
  withTop?: boolean;
}) {
  const { tr, locale } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  const months = monthlyEarned(d.history, Date.now(), tz);
  const top = Math.max(1, ...months.map((m) => m.total));
  const columns: Column<LedgerRow>[] = [
    { key: 'when', header: tr(`${K}.panel.columns.when`), render: (r) => <bdi>{formatDateTime(new Date(r.created_at), locale, tz)}</bdi> },
    { key: 'what', header: tr(`${K}.panel.columns.what`), render: (r) => tr(`${K}.panel.kind.${ledgerKind(r.kind)}`) },
    {
      key: 'points',
      header: tr(`${K}.panel.columns.points`),
      numeric: true,
      render: (r) => (
        <span dir="ltr" style={{ fontWeight: 600, color: r.delta < 0 ? 'var(--tp-muted-fg)' : 'var(--tp-success-fg)' }}>
          {r.delta > 0 ? `+${n(r.delta)}` : n(r.delta)}
        </span>
      ),
    },
    { key: 'note', header: tr(`${K}.panel.columns.note`), render: (r) => (r.note ? <bdi>{r.note}</bdi> : null) },
  ];
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      {withTop && <LoyaltyTop data={d} tier={tier} tierKey={tierColour(d.tier?.name_en)} pointValueIqd={pointValueIqd} minRedeemPoints={minRedeemPoints} />}

      <section aria-label={tr(`${K}.panel.perMonth`)} style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>
          <span>{tr(`${K}.panel.perMonth`)}</span>
          <span style={{ fontWeight: 500 }}>{tr(`${K}.panel.perMonthSpan`)}</span>
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, gap: 'var(--tp-sp-3)', alignItems: 'end', blockSize: '7rem' }}>
          {months.map((m, i) => {
            const now = i === months.length - 1;
            return (
              <div key={m.key} style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', justifyItems: 'center', gap: 'var(--tp-sp-1)', blockSize: '100%' }}>
                <span style={{ fontFamily: 'var(--tp-font-numeric)', fontSize: 'var(--tp-fs-xs)', fontWeight: 600 }}>{n(m.total)}</span>
                <span style={{ alignSelf: 'end', inlineSize: '100%', display: 'flex', alignItems: 'flex-end', blockSize: '100%' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      inlineSize: '100%',
                      blockSize: `${Math.max(3, Math.round((m.total / top) * 100))}%`,
                      borderStartStartRadius: '6px',
                      borderStartEndRadius: '6px',
                      background: now ? 'var(--tp-accent-2)' : 'color-mix(in oklab, var(--tp-accent-2) 65%, var(--tp-surface))',
                      borderBlockStart: '3px solid var(--tp-success-mark)',
                    }}
                  />
                </span>
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{formatMonthShort(new Date(`${m.key}-15T12:00:00Z`), locale, 'UTC')}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label={tr(`${K}.panel.history`)} style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{tr(`${K}.panel.history`)}</h3>
        <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', overflow: 'hidden' }}>
          <DataTable
            aria-label={tr(`${K}.panel.history`)}
            dense
            columns={columns}
            rows={d.history}
            rowKey={(r) => r.id}
            emptyContent={tr(`${K}.panel.historyEmpty`)}
          />
        </div>
      </section>

      {adjust && <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBlockStart: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}>{adjust}</div>}
    </div>
  );
}

function AdjustDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const errors = touched ? adjustErrors({ delta, reason }) : {};

  function next() {
    setTouched(true);
    setError(null);
    if (Object.keys(adjustErrors({ delta, reason })).length > 0) return;
    setPinError(null);
    setPinOpen(true);
  }

  async function submit(pin: string) {
    const points = parseSigned(delta);
    if (points === null) return;
    setBusy(true);
    setPinError(null);
    try {
      const res = await adjustPoints(customerId, points, reason.trim(), pin);
      void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.customer(customerId) });
      void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.member(customerId) });
      toast.ok(tr(`${K}.adjust.done`, { points: formatNumber(Number(res.balance), locale) }));
      setPinOpen(false);
      onClose();
    } catch (e) {
      if (isPinRefusal(e)) {
        setPinError(e);
      } else {
        setPinOpen(false);
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={tr(`${K}.adjust.title`)}
        subtitle={tr(`${K}.adjust.lead`)}
        size="sm"
        dismissible={!busy}
        onClose={onClose}
        footer={(close) => (
          <>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button kind="primary" icon="lock" busy={busy} onClick={next} data-testid="adjust-next">
              {tr(`${K}.adjust.next`)}
            </Button>
          </>
        )}
      >
        <Field
          label={tr(`${K}.adjust.delta`)}
          hint={tr(`${K}.adjust.deltaHint`)}
          error={errors.delta ? tr(`${K}.adjust.deltaRequired`) : undefined}
        >
          <input
            style={{ ...inputStyle, inlineSize: '10rem', fontVariantNumeric: 'tabular-nums' }}
            dir="ltr"
            inputMode="numeric"
            autoFocus
            value={delta}
            data-testid="adjust-delta"
            onChange={(e) => setDelta(e.target.value.replace(/[^\d\-−]/g, ''))}
          />
        </Field>
        <Field
          label={tr(`${K}.adjust.reason`)}
          hint={tr(`${K}.adjust.reasonHint`)}
          error={errors.reason ? tr(`${K}.adjust.reasonRequired`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={inputStyle}
            value={reason}
            maxLength={200}
            data-testid="adjust-reason"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
      </Modal>
      {pinOpen && (
        <PinPromptOverlay
          action={tr(`${K}.adjust.pinAction`)}
          busy={busy}
          error={pinError}
          onSubmit={(pin) => void submit(pin)}
          onCancel={() => setPinOpen(false)}
        />
      )}
    </>
  );
}
