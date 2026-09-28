/**
 * The hold ladder (migration 0249) on two staff screens, one row body:
 *
 *   HoldReviewsPanel      day close, the day's record: guests the ladder
 *                         suspended at this branch, waiting for a decision.
 *                         Hidden when there is none; never blocks the close.
 *   CustomerHoldStanding  customer record: where this guest stands, whenever
 *                         it is not clear, so a ban can be lifted later.
 *
 * Lift and Ban are MGMT's (CAPABILITY_ROLES.decideHoldStanding, the RPC is the
 * wall); the desk and the cashier see the standing only. A ban asks first.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, VENUE_TZ, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { currentBranchId } from '../../lib/venueScope';
import { can, useAuth } from '../../lib/auth';
import { useToast } from '../../components/toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, ErrorText } from '../../components/ui';
import { Panel, StatusBadge, type Tone } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { decideHoldStanding, fetchGuestHoldStanding, fetchHoldReviews, guestHoldStandingKey, holdReviewsKey } from './holdApi';
import { holdStandingActions, showHoldStanding, type HoldStanding, type HoldStandingStatus } from './holdStandingLogic';

const K = 'ws.manager.holds';

const TONE: Record<HoldStandingStatus, Tone> = {
  clear: 'neutral',
  warned: 'warn',
  cooldown: 'warn',
  suspended: 'danger',
  banned: 'danger',
};

export function HoldReviewsPanel() {
  const { tr, locale } = useLocale();
  const branch = currentBranchId();
  const q = useQuery({
    queryKey: holdReviewsKey(branch),
    queryFn: () => fetchHoldReviews(branch),
    refetchInterval: 60_000,
    retry: false,
  });
  const rows = q.data ?? [];
  if (rows.length === 0 && !q.error) return null;

  return (
    <Panel
      title={<CardTitle icon="ban">{tr(`${K}.reviewTitle`)}</CardTitle>}
      actions={rows.length > 0 ? <StatusBadge tone="warn" label={tr(`${K}.reviewBadge`, { count: formatNumber(rows.length, locale) })} /> : undefined}
      data-testid="day-close-hold-reviews"
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)', maxInlineSize: '70ch' }}>{tr(`${K}.reviewLead`)}</p>
      {rows.length === 0 ? (
        <>
          <ErrorText error={q.error} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {rows.map((s) => (
            <StandingRow key={s.id} standing={s} withName />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function CustomerHoldStanding({ customerId }: { customerId: string }) {
  const { tr } = useLocale();
  const q = useQuery({
    queryKey: guestHoldStandingKey(customerId),
    queryFn: () => fetchGuestHoldStanding(customerId),
    retry: false,
  });
  if (!showHoldStanding(q.data)) return null;
  return (
    <Panel title={<CardTitle icon="hourglass">{tr(`${K}.recordTitle`)}</CardTitle>} data-testid="customer-hold-standing">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        <StandingRow standing={q.data} withName={false} />
      </ul>
    </Panel>
  );
}

function StandingRow({ standing: s, withName }: { standing: HoldStanding; withName: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { staff } = useAuth();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings, staleTime: 5 * 60_000 });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  const [busy, setBusy] = useState<'lift' | 'ban' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmBan, setConfirmBan] = useState(false);

  const mayDecide = can(staff?.role, 'decideHoldStanding');
  const actions = holdStandingActions(s);
  const guest = s.guest_name?.trim() || tr(`${K}.noName`);
  const until = s.blocked_until ? formatDateTime(new Date(s.blocked_until), locale, tz) : '';

  async function run(decision: 'lift' | 'ban') {
    setBusy(decision);
    setError(null);
    try {
      await decideHoldStanding(s.id, decision);
      setConfirmBan(false);
      toast.ok(tr(decision === 'lift' ? `${K}.lifted` : `${K}.banned`));
    } catch (e) {
      setError(e);
      setConfirmBan(false);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['holdReviews'] });
      void qc.invalidateQueries({ queryKey: ['guestHoldStanding'] });
    }
  }

  return (
    <li style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-3)', borderBlockEnd: '1px solid var(--tp-border)' }}>
      {withName && (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>
            <bdi>{guest}</bdi>
          </strong>
          {s.guest_phone && (
            <bdi dir="ltr" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
              {s.guest_phone}
            </bdi>
          )}
        </span>
      )}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge tone={TONE[s.status]} size="sm" label={tr(`${K}.status.${s.status}` as MessageKey, { time: until })} />
        {s.strikes > 0 && s.status !== 'banned' && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.strikes`, { count: formatNumber(s.strikes, locale) })}</span>
        )}
      </div>

      <ErrorText error={confirmBan ? null : error} style={{ marginBlock: 0 }} />

      {mayDecide && (actions.lift || actions.ban) && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          {actions.lift && (
            <Button size="sm" icon="undo" busy={busy === 'lift'} disabled={busy !== null} onClick={() => void run('lift')}>
              {tr(s.status === 'banned' ? `${K}.liftBan` : `${K}.lift`)}
            </Button>
          )}
          {actions.ban && (
            <Button size="sm" kind="ghost" icon="ban" disabled={busy !== null} onClick={() => { setError(null); setConfirmBan(true); }}>
              {tr(`${K}.ban`)}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmBan}
        kind="danger"
        title={tr(`${K}.banTitle`, { name: guest })}
        body={
          <>
            <p>{tr(`${K}.banBody`)}</p>
            <ErrorText error={error} />
          </>
        }
        confirmLabel={tr(`${K}.banConfirm`)}
        busy={busy === 'ban'}
        onConfirm={() => void run('ban')}
        onCancel={() => setConfirmBan(false)}
      />
    </li>
  );
}
