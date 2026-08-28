/**
 * Opening-hours editor — one window per day (Phase 1; midnight-crossing
 * windows are unsupported by the slot grid). Saves the full jsonb via
 * app.set_opening_hours (0013).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DayKey } from '@touch/core';
import { appRpc } from '../../lib/appRpc';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, card, inputStyle } from '../../components/ui';

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface DayDraft {
  closed: boolean;
  open: string;
  close: string;
}

export function OpeningHoursEditor() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<DayKey, DayDraft> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Shared fetcher. This selected a NARROWER column set under the same key as
  // the desk calendar, which then read `timezone` as undefined and rendered the
  // whole grid in the fallback timezone, silently.
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });

  useEffect(() => {
    if (!settingsQ.data || draft) return;
    const next = {} as Record<DayKey, DayDraft>;
    for (const key of DAY_KEYS) {
      const windows = settingsQ.data.opening_hours[key] ?? [];
      const first = windows[0];
      next[key] = first
        ? { closed: false, open: first[0], close: first[1] }
        : { closed: true, open: '09:00', close: '23:00' };
    }
    setDraft(next);
  }, [settingsQ.data, draft]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const hours: Record<string, [string, string][]> = {};
      for (const key of DAY_KEYS) {
        const d = draft[key];
        hours[key] = d.closed ? [] : [[d.open, d.close]];
      }
      await appRpc('set_opening_hours', { p_opening_hours: hours });
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: QK.venueSettings });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return <p>{tr('common.loading')}</p>;

  return (
    <div style={{ ...card, maxInlineSize: '34rem' }}>
      <h3 style={{ marginBlockStart: 0 }}>{tr('op.hours.title')}</h3>
      {DAY_KEYS.map((key) => {
        const d = draft[key];
        return (
          <div
            key={key}
            style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBlockEnd: '0.4rem' }}
          >
            <span style={{ inlineSize: '6rem' }}>{tr(`op.days.${key}`)}</span>
            <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={d.closed}
                onChange={(e) => setDraft({ ...draft, [key]: { ...d, closed: e.target.checked } })}
              />
              {tr('op.hours.closedDay')}
            </label>
            {!d.closed && (
              <>
                <input
                  style={{ ...inputStyle, inlineSize: 'auto' }}
                  dir="ltr"
                  type="time"
                  aria-label={tr('op.hours.open')}
                  value={d.open}
                  onChange={(e) => setDraft({ ...draft, [key]: { ...d, open: e.target.value } })}
                />
                <span>–</span>
                <input
                  style={{ ...inputStyle, inlineSize: 'auto' }}
                  dir="ltr"
                  type="time"
                  aria-label={tr('op.hours.close')}
                  value={d.close}
                  onChange={(e) => setDraft({ ...draft, [key]: { ...d, close: e.target.value } })}
                />
              </>
            )}
          </div>
        );
      })}
      <ErrorText error={error} />
      {saved && <p style={{ color: 'var(--tp-accent)' }}>{tr('op.hours.saved')}</p>}
      <Button kind="primary" disabled={busy} onClick={() => void save()}>
        {tr('common.save')}
      </Button>
    </div>
  );
}
