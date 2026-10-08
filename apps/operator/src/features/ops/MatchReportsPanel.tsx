/**
 * "Player reports" on Ops (docs/design/open-matches/operator.md §5.17): what
 * players reported from the app about someone they played with, at the branch
 * the rail shows, oldest first (app.match_reports_open). Gated
 * `reviewMatchReports` (manager, owner).
 *
 * Each row says why, when, which match (Open match) and who: their name,
 * phone and flags, how often they were reported in 90 days and their
 * no-shows (Open customer), and who reported them. Two decisions, each
 * app.resolve_match_report: Close report (dismissed), one click; and Ban
 * (banned, a chain-wide ban with reason `reported`, R35, R40), after a
 * confirm, hidden once the player is banned. A report someone else dealt with
 * first (REPORT_CLOSED) refreshes the list and says so.
 *
 * Mounted `hideWhenEmpty` on Today, after the online refunds: nothing while
 * nothing waits, and nothing on a server without open matches (RPC_MISSING).
 * A failed first read says so with Retry (§5.5). Online only (DF-11).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatNumber, isolate, VENUE_TZ } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { currentBranchId } from '../../lib/venueScope';
import { useToast } from '../../components/toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { CustomerFlagBadge, EmptyState, Panel, StatusBadge, ViewMore, useListCap } from '../../components/kit';
import { MatchReadNotice } from '../matches/MatchReadNotice';
import { matchStatusKey } from '../matches/matchLogic';
import type { MatchReport } from '../matches/matchPayloads';
import { invalidateMatchReport, useMatchCaps, useMatchRead, useMatchReports } from '../matches/useMatches';
import { CardTitle } from './OpsVisuals';
import { reportActions, reportCategoryKey, reportReasonKey, reportRefusalRefetches, showReportsPanel, sortReports } from './matchReportsLogic';

const K = 'ws.matches.ops';

export function MatchReportsPanel({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { tr } = useLocale();
  const caps = useMatchCaps();
  const branch = currentBranchId();
  const q = useMatchReports(branch, caps.reviewMatchReports);
  const status = useMatchRead(q);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings, staleTime: 5 * 60_000 });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const rows = status.kind === 'ready' ? sortReports(status.data) : null;
  const cap = useListCap(rows ?? []);

  if (!caps.reviewMatchReports || status.kind === 'absent') return null;
  // Nothing disappears silently: a failed first read shows even on Today.
  const show = status.kind === 'failed' || (status.kind === 'loading' ? !hideWhenEmpty : showReportsPanel({ rows: rows?.length, hideWhenEmpty }));
  if (!show) return null;

  return (
    <Panel title={<CardTitle icon="alert">{tr(`${K}.title`)}</CardTitle>} data-testid="match-reports">
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)', maxInlineSize: '70ch' }}>{tr(`${K}.lead`)}</p>
      {status.kind === 'loading' && <Skeleton lines={3} blockSize="1.4rem" />}
      <MatchReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
      {rows && rows.length === 0 && <EmptyState compact icon="checkCircle" kind="nothingToDo" title={tr(`${K}.empty`)} titleAs="h3" />}
      {rows && rows.length > 0 && (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
            {cap.shown.map((r) => (
              <ReportRow key={r.report_id} report={r} branch={branch} tz={tz} />
            ))}
          </ul>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </>
      )}
    </Panel>
  );
}

function ReportRow({ report: r, branch, tz }: { report: MatchReport; branch: string | null; tz: string }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { reachable } = useStationReach();
  const [busy, setBusy] = useState<'dismissed' | 'banned' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmBan, setConfirmBan] = useState(false);

  const actions = reportActions(r);
  const who = r.reported;
  const name = who?.full_name?.trim() || tr(`${K}.formerPlayer`);
  const offline = tr('ws.matches.offline.needsConnection');
  const reportedId = who?.customer_id ?? null;

  async function resolve(outcome: 'dismissed' | 'banned') {
    setBusy(outcome);
    setError(null);
    try {
      await appRpc('resolve_match_report', { p_report_id: r.report_id, p_outcome: outcome });
      setConfirmBan(false);
      toast.ok(tr(outcome === 'dismissed' ? `${K}.closed` : `${K}.banned`));
      invalidateMatchReport(qc, branch, reportedId);
    } catch (e) {
      setConfirmBan(false);
      if (e instanceof AppRpcError && reportRefusalRefetches(e.code)) {
        // Someone dealt with it first: the row goes, so the words go in a toast.
        toast.err(e);
        invalidateMatchReport(qc, branch, reportedId);
      } else {
        setError(e);
      }
    } finally {
      setBusy(null);
    }
  }

  const m = r.match;
  const categoryKey = reportCategoryKey(m?.category);
  const statusKey = m?.status ? matchStatusKey(m.status) : null;
  const matchLine = [
    m?.start_at ? formatDateTime(new Date(m.start_at), locale, tz) : null,
    categoryKey ? tr(categoryKey) : null,
    statusKey ? tr(statusKey) : (m?.status ?? null),
  ].filter(Boolean);
  const count = (n: number | null | undefined) => (n == null ? '—' : formatNumber(n, locale));

  return (
    <li data-testid="match-report" style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-3)', borderBlockEnd: '1px solid var(--tp-border)' }}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge tone="warn" size="sm" label={tr(reportReasonKey(r.reason))} />
        {r.created_at && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.reportedAt`, { time: formatDateTime(new Date(r.created_at), locale, tz) })}</span>}
      </div>

      <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 18rem', minInlineSize: 0 }}>
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>
              <bdi>{name}</bdi>
            </strong>
            {who?.phone && (
              <bdi dir="ltr" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                {who.phone}
              </bdi>
            )}
            {(who?.flags ?? []).map((f, i) => (
              <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
            ))}
          </span>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr(`${K}.reports90d`, { count: count(who?.reports_90d) })} · {tr(`${K}.noShows`, { count: count(who?.no_shows) })}
          </span>
          {r.reporter && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr(`${K}.reporter`, { name: isolate(r.reporter.full_name?.trim() || tr(`${K}.formerPlayer`)) })}
            </span>
          )}
        </div>
        {reportedId && (
          <Button size="sm" kind="ghost" icon="user" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/desk/customers/$id', params: { id: reportedId } })}>
            {tr(`${K}.openCustomer`)}
          </Button>
        )}
      </div>

      {m && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
          <bdi style={{ flex: '1 1 14rem', color: 'var(--tp-muted-fg)' }}>{matchLine.join(' · ')}</bdi>
          {m.id && (
            <Button size="sm" kind="ghost" icon="users" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/desk/matches/$id', params: { id: m.id as string } })}>
              {tr(`${K}.openMatch`)}
            </Button>
          )}
        </div>
      )}

      <ErrorText error={confirmBan ? null : error} style={{ marginBlock: 0 }} />

      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        {actions.close && (
          <Button size="sm" icon="check" busy={busy === 'dismissed'} disabled={busy !== null || !reachable} disabledReason={offline} onClick={() => void resolve('dismissed')}>
            {tr(`${K}.close`)}
          </Button>
        )}
        {actions.ban && (
          <Button
            size="sm"
            kind="danger"
            icon="ban"
            disabled={busy !== null || !reachable}
            disabledReason={offline}
            onClick={() => {
              setError(null);
              setConfirmBan(true);
            }}
          >
            {tr(`${K}.ban`)}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmBan}
        kind="danger"
        title={tr(`${K}.banTitle`, { name: isolate(name) })}
        body={
          <>
            <p>{tr(`${K}.banBody`)}</p>
            <ErrorText error={error} />
          </>
        }
        confirmLabel={tr(`${K}.ban`)}
        busy={busy === 'banned'}
        onConfirm={() => void resolve('banned')}
        onCancel={() => setConfirmBan(false)}
      />
    </li>
  );
}
