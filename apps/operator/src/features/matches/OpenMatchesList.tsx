/**
 * `/desk/matches` (Courts › Open matches): the branch's open matches, one
 * day at a time, today first. The same rows as the Today board's "Open matches
 * needing players" group (NeedsPlayersPanel), for any day up to two months
 * ahead, each opening `/desk/matches/$id`, with Add player. Starting a match
 * is done on the calendar, where a free time is picked (Start match there).
 *
 * With open matches off for the branch the page says so and links to the
 * rules (Court settings › Open matches).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ, formatDate } from '@touch/i18n';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui';
import { EmptyState, PageHeader } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { addDays, venueToday } from '../deductions/venueDate';
import { AddSeatDialog } from './AddSeatDialog';
import { NeedsPlayersPanel } from './NeedsPlayersPanel';
import { useMatchCaps, useMatchRead, useMatchesLive, useOpenMatches } from './useMatches';
import { useOpenMatchesOn } from './useOpenMatchesOn';

/** How far ahead the day can be moved: matches start at most 180 days out, the list looks two months. */
export const LIST_DAYS_AHEAD = 62;

export function OpenMatchesListScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { reachable } = useStationReach();
  const caps = useMatchCaps();
  const on = useOpenMatchesOn();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const today = venueToday(new Date(), tz);
  const [day, setDay] = useState<string | null>(null);
  const date = day ?? today;
  const [addPlayerTo, setAddPlayerTo] = useState<string | null>(null);

  const from = useMemo(() => wallTimeToUtc(date, 0, tz), [date, tz]);
  const to = useMemo(() => wallTimeToUtc(addDays(date, 1), 0, tz), [date, tz]);
  const q = useOpenMatches(from, to, settingsQ.isSuccess && on);
  const status = useMatchRead(q);
  useMatchesLive(on);

  const shift = (days: number) => setDay(addDays(date, days));
  const isToday = date === today;
  const label = formatDate(from, locale, tz);

  return (
    <div data-testid="open-matches-list" style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <PageHeader title={tr('ws.matches.list.title')} subtitle={tr('ws.matches.list.lead')} />
      {!on ? (
        <EmptyState
          icon="users"
          title={tr('ws.matches.list.offTitle')}
          body={tr('ws.matches.list.offBody')}
          action={
            <Link to="/admin/settings/matches" style={{ fontWeight: 600 }}>
              {tr('ws.matches.list.offAction')}
            </Link>
          }
        />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button size="sm" kind="ghost" icon="chevronStart" disabled={isToday} onClick={() => shift(-1)} aria-label={tr('ws.matches.list.previousDay')} />
            <strong data-testid="open-matches-day" style={{ minInlineSize: '10rem', textAlign: 'center' }}>
              <bdi>{label}</bdi>
            </strong>
            <Button
              size="sm"
              kind="ghost"
              icon="chevronEnd"
              disabled={date >= addDays(today, LIST_DAYS_AHEAD)}
              onClick={() => shift(1)}
              aria-label={tr('ws.matches.list.nextDay')}
            />
            {!isToday && (
              <Button size="sm" onClick={() => setDay(null)}>
                {tr('ws.matches.list.backToToday')}
              </Button>
            )}
            <Button size="sm" kind="ghost" iconEnd="chevronEnd" style={{ marginInlineStart: 'auto' }} onClick={() => void navigate({ to: '/desk' })}>
              {tr('ws.matches.list.startOnCalendar')}
            </Button>
          </div>
          <NeedsPlayersPanel
            status={status}
            tz={tz}
            runMatches={caps.runMatches}
            reachable={reachable}
            hideStart
            onAddPlayer={setAddPlayerTo}
            onOpenMatch={(id) => void navigate({ to: '/desk/matches/$id', params: { id } })}
            onStartMatch={() => void navigate({ to: '/desk' })}
            onRetry={() => void q.refetch()}
          />
        </>
      )}
      {addPlayerTo && <AddSeatDialog matchId={addPlayerTo} onClose={() => setAddPlayerTo(null)} onAdded={() => setAddPlayerTo(null)} />}
    </div>
  );
}
