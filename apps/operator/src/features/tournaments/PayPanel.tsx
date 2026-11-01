/**
 * The Pay tab of `/desk/tournaments/$id` (0390, F-40; Majed 2026-11-01: "a Pay
 * page; a confirmed participant may be unpaid"): every registered player who
 * still owes the entry fee, confirmed first, each with Take payment
 * (TakeTournamentPayment over the till's PaymentPane, app.tournament_settle).
 * Confirming and paying are separate steps: the badge says which players are
 * confirmed, and nobody has to pay to be confirmed.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { Button } from '../../components/ui';
import { EmptyState, MessagePresenter, StatusBadge } from '../../components/kit';
import { TakeTournamentPayment, type TournamentPayTarget } from './TakeTournamentPayment';
import { entryActions, owingEntries } from './tournamentLogic';
import { readTournamentDetail, type TourEntry, type TournamentDetail } from './tournamentPayloads';
import { invalidateTournament, type TournamentCaps } from './useTournaments';

export function PayPanel({ detail, caps, onRefetch }: { detail: TournamentDetail; caps: TournamentCaps; onRefetch: () => void }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const [pay, setPay] = useState<TournamentPayTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = owingEntries(detail);
  const total = rows.reduce((s, e) => s + e.owed_iqd, 0);
  const nameOf = (e: TourEntry) => e.full_name || tr('tournaments.common.player', { no: String(e.seed_no ?? '?') });

  async function refetch(): Promise<TournamentDetail | null> {
    invalidateTournament(qc);
    try {
      return readTournamentDetail(await appRpc('desk_tournament_detail', { p_tournament_id: detail.id }));
    } catch {
      return null;
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="pay-panel">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-md)' }}>{tr('ws.tournaments.pay.title')}</h3>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.pay.lead')}</p>
      </div>
      {notice && <MessagePresenter tone="info" message={notice} />}
      {rows.length === 0 ? (
        <EmptyState title={tr('ws.tournaments.pay.empty')} />
      ) : (
        <>
          <p style={{ margin: 0, fontWeight: 600 }} data-testid="pay-total">
            {tr('ws.tournaments.pay.total', { count: formatNumber(rows.length, locale), amount: isolate(formatIQD(total, locale)) })}
          </p>
          <ul style={{ listStyle: 'none', paddingInline: 0, margin: 0, display: 'grid' }}>
            {rows.map((e) => {
              const a = entryActions(e, detail, { run: caps.runTournaments, pay: caps.takeTournamentPayment });
              return (
                <li
                  key={e.entry_id}
                  data-testid={`pay.row.${e.entry_id}`}
                  className="tp-row"
                  style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-1-5)', borderBlockEnd: '1px solid var(--tp-border)' }}
                >
                  <bdi style={{ fontWeight: 600, marginInlineEnd: 'auto' }}>{nameOf(e)}</bdi>
                  <StatusBadge
                    size="sm"
                    tone={e.confirmed ? 'success' : 'warn'}
                    label={tr(e.confirmed ? 'ws.tournaments.entries.confirmed' : 'ws.tournaments.entries.notConfirmed')}
                  />
                  <StatusBadge size="sm" tone="warn" label={tr('ws.tournaments.entries.owed', { amount: formatIQD(e.owed_iqd, locale) })} />
                  {a.pay && (
                    <Button
                      size="sm"
                      kind="primary"
                      icon="banknote"
                      disabled={!reachable}
                      disabledReason={!reachable ? tr('ws.tournaments.detail.offline') : undefined}
                      data-testid={`pay.take.${e.entry_id}`}
                      onClick={() => setPay({ entryId: e.entry_id, name: nameOf(e), dueIqd: e.owed_iqd })}
                    >
                      {tr('ws.tournaments.entries.takePayment')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {pay && (
        <TakeTournamentPayment
          target={pay}
          method="cash"
          onClose={() => setPay(null)}
          onNotice={setNotice}
          refetchDue={async () => {
            const fresh = await refetch();
            onRefetch();
            return fresh?.entries.find((x) => x.entry_id === pay.entryId)?.owed_iqd ?? null;
          }}
        />
      )}
    </div>
  );
}
