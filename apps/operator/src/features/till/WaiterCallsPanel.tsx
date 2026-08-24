/**
 * Waiter-calls floor panel (SoW Module 3): the till lists unresolved
 * waiter_calls (table, reason, age) with Ack / Resolve via app.ack_waiter_call
 * and app.resolve_waiter_call (0016). Fast path is the private 'floor'
 * broadcast (0022) — TillScreen's subscription invalidates ['waiterCalls'];
 * a slow refetch interval is the safety net.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, card } from '../../components/ui';

type CallReason = 'order' | 'bill' | 'water' | 'assistance';

interface WaiterCallRow {
  id: string;
  reason: CallReason;
  status: 'raised' | 'acknowledged';
  raised_at: string;
  table: { table_number: string } | null;
}

export function WaiterCallsPanel() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Minute-ish ticker so the age labels stay honest between broadcasts.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const callsQ = useQuery({
    queryKey: ['waiterCalls'],
    queryFn: async (): Promise<WaiterCallRow[]> => {
      const { data, error: err } = await supabase
        .from('waiter_calls')
        .select('id, reason, status, raised_at, table:cafe_tables(table_number)')
        .in('status', ['raised', 'acknowledged'])
        .order('raised_at');
      if (err) throw err;
      return data as unknown as WaiterCallRow[];
    },
    refetchInterval: 60_000,
  });

  async function act(callId: string, action: 'ack' | 'resolve') {
    setBusyId(callId);
    setError(null);
    try {
      await appRpc(action === 'ack' ? 'ack_waiter_call' : 'resolve_waiter_call', {
        p_call_id: callId,
      });
      void queryClient.invalidateQueries({ queryKey: ['waiterCalls'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  function ageLabel(raisedAt: string): string {
    const minutes = Math.floor((Date.now() - new Date(raisedAt).getTime()) / 60_000);
    return minutes < 1 ? tr('op.floor.ageNow') : tr('op.floor.ageMinutes', { minutes });
  }

  const calls = callsQ.data ?? [];

  return (
    <div style={{ ...card, marginBlockEnd: '0.6rem' }}>
      <h2 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        {tr('op.floor.waiterCalls')}
        {calls.length > 0 && (
          <span
            style={{
              background: 'var(--tp-danger)',
              color: 'var(--tp-danger-contrast)',
              borderRadius: '999px',
              paddingInline: '0.5rem',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            {calls.length}
          </span>
        )}
      </h2>
      {calls.length === 0 && (
        <p style={{ margin: 0, marginBlockStart: '0.3rem', color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
          {tr('op.floor.noCalls')}
        </p>
      )}
      {calls.map((c) => (
        <div key={c.id} style={{ marginBlockStart: '0.5rem', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem' }}>
            <strong>
              {tr('op.floor.table', { table: isolate(c.table?.table_number ?? '—') })}
            </strong>
            <span style={{ color: 'var(--tp-muted-fg)' }}>{ageLabel(c.raised_at)}</span>
          </div>
          <div style={{ color: 'var(--tp-muted-fg)' }}>{tr(`op.floor.reasons.${c.reason}`)}</div>
          <div style={{ display: 'flex', gap: '0.35rem', marginBlockStart: '0.25rem' }}>
            {c.status === 'raised' ? (
              <Button disabled={busyId === c.id} onClick={() => void act(c.id, 'ack')}>
                {tr('op.floor.ack')}
              </Button>
            ) : (
              <span style={{ color: 'var(--tp-accent)', alignSelf: 'center', fontSize: '0.85rem' }}>
                {tr('op.floor.acked')}
              </span>
            )}
            <Button kind="primary" disabled={busyId === c.id} onClick={() => void act(c.id, 'resolve')}>
              {tr('op.floor.resolve')}
            </Button>
          </div>
        </div>
      ))}
      <ErrorText error={error} />
    </div>
  );
}
