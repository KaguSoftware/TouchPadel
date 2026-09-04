/**
 * 06.7 CourtBlockScreen — blocks court time for maintenance or a private
 * event. A block is a `maintenance` reservation created through the same
 * mutate('reservation.create') path the calendar uses; the exclusion
 * constraint decides, and SLOT_TAKEN is rendered as a rejected write.
 * States: ready · busy · conflict · error.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { AppRpcError } from '../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, ConflictNotice, MessagePresenter, PageHeader, Panel, asyncStatus } from '../../components/kit';
import { todayInTz } from './useTradingNight';

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function CourtBlockScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const courts = courtsQ.data ?? [];

  const [courtId, setCourtId] = useState('');
  const [date, setDate] = useState(() => todayInTz(VENUE_TZ));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [done, setDone] = useState(false);

  const effectiveCourt = courtId || courts[0]?.id || '';
  const fromMin = toMinutes(from);
  const toMinRaw = toMinutes(to);
  // A block that ends "after midnight" (02:00 < 22:00) belongs to the same trading night.
  const toMin = fromMin !== null && toMinRaw !== null && toMinRaw <= fromMin ? toMinRaw + 24 * 60 : toMinRaw;
  const rangeInvalid = fromMin !== null && toMinRaw !== null && toMin !== null && toMin <= fromMin;
  const canSubmit = !busy && effectiveCourt !== '' && fromMin !== null && toMin !== null && !rangeInvalid && reason.trim().length > 0;

  async function submit() {
    if (!canSubmit || fromMin === null || toMin === null) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    setDone(false);
    try {
      await mutate('reservation.create', {
        clientRef: clientRef(),
        courtId: effectiveCourt,
        kind: 'maintenance',
        startAt: wallTimeToUtc(date, fromMin, tz).toISOString(),
        endAt: wallTimeToUtc(date, toMin, tz).toISOString(),
        notes: reason.trim(),
      });
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'SLOT_TAKEN') setConflict(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-form)' }}>
      <PageHeader title={tr('ws.courtDesk.block.title')} subtitle={tr('ws.courtDesk.block.lead')} />
      <AsyncStateWrapper status={asyncStatus(courtsQ, (c) => c.length === 0)} error={courtsQ.error} onRetry={() => void courtsQ.refetch()}>
        {done ? (
          <Panel>
            <MessagePresenter tone="success" message={tr('ws.courtDesk.block.done')} style={{ marginBlockEnd: '0.75rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link to="/desk" className="tp-btn" data-kind="primary" data-size="md">
                {tr('ws.courtDesk.block.openCalendar')}
              </Link>
              <Button
                onClick={() => {
                  setDone(false);
                  setFrom('');
                  setTo('');
                  setReason('');
                }}
              >
                {tr('ws.courtDesk.block.another')}
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel>
            {conflict && <ConflictNotice body={tr('ws.courtDesk.block.conflictBody')} onResolve={() => setConflict(false)} style={{ marginBlockEnd: '0.85rem' }} />}
            <Field label={tr('ws.courtDesk.block.court')} required>
              <Select value={effectiveCourt} disabled={busy} onChange={setCourtId} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
            </Field>
            <Field label={tr('ws.courtDesk.block.date')} required>
              <input type="date" style={inputStyle} value={date} disabled={busy} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Field label={tr('ws.courtDesk.block.from')} required>
                <input type="time" step={1800} style={inputStyle} value={from} disabled={busy} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label={tr('ws.courtDesk.block.to')} required error={rangeInvalid ? tr('ws.courtDesk.block.invalidRange') : undefined}>
                <input type="time" step={1800} style={inputStyle} value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <Field label={tr('ws.courtDesk.block.reason')} hint={tr('ws.courtDesk.block.reasonHint')} required>
              <input style={inputStyle} value={reason} disabled={busy} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <ErrorText error={error} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Link to="/desk" className="tp-btn" data-kind="ghost" data-size="md">
                {tr('common.cancel')}
              </Link>
              <Button
                kind="primary"
                icon="ban"
                busy={busy}
                disabled={!canSubmit}
                disabledReason={rangeInvalid ? tr('ws.courtDesk.block.invalidRange') : tr('ws.courtDesk.block.needsFields')}
                onClick={() => void submit()}
              >
                {tr('ws.courtDesk.block.submit')}
              </Button>
            </div>
          </Panel>
        )}
      </AsyncStateWrapper>
    </div>
  );
}
