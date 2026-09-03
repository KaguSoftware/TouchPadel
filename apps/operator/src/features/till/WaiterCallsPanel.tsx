/**
 * Waiter-calls floor panel (SoW Module 3): the till lists unresolved
 * waiter_calls (table, reason, age) with Ack / Resolve via app.ack_waiter_call
 * and app.resolve_waiter_call (0016). Fast path is the private 'floor'
 * broadcast (0022) — TillScreen owns that subscription (invalidates
 * ['waiterCalls'], chimes on `raised`) and passes its status down; the
 * refetch interval is the safety net.
 *
 * Age escalation: < 2 min muted · 2–5 min amber · ≥ 5 min danger + pulse, with
 * a 60 s re-alarm for un-acked calls older than 5 min (shared alarm machine).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { useLocale } from '../../lib/i18n';
import type { BroadcastStatus } from '../../lib/realtime';
import { Button, ErrorText, card } from '../../components/ui';
import { ConnectionPill } from '../../components/ConnectionPill';
import { CALL_ALARM_CONFIG } from '../kds/alarms';
import { useAlarmSubjects, useAlarms } from '../kds/useKdsAlarms';

type CallReason = 'order' | 'bill' | 'water' | 'assistance';

interface WaiterCallRow {
  id: string;
  reason: CallReason;
  status: 'raised' | 'acknowledged';
  raised_at: string;
  acknowledged_label: string | null;
  resolved_label: string | null;
  table: { table_number: string } | null;
}

const AMBER = '#E8A317'; // same amber as kds/ageColor.ts
const ESCALATE_MIN = 5;
const WARN_MIN = 2;

function ageTone(minutes: number): { color: string; pulse: boolean } {
  if (minutes >= ESCALATE_MIN) return { color: 'var(--tp-danger)', pulse: true };
  if (minutes >= WARN_MIN) return { color: AMBER, pulse: false };
  return { color: 'var(--tp-muted-fg)', pulse: false };
}

export function WaiterCallsPanel({ status }: { status?: BroadcastStatus }) {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Ticker so the age labels / escalation stay honest between broadcasts.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const callsQ = useQuery({
    queryKey: ['waiterCalls'],
    queryFn: async (): Promise<WaiterCallRow[]> => {
      const { data, error: err } = await supabase
        .from('waiter_calls')
        .select(
          'id, reason, status, raised_at, acknowledged_label, resolved_label, table:cafe_tables(table_number)',
        )
        .in('status', ['raised', 'acknowledged'])
        .order('raised_at');
      if (err) throw err;
      return data as unknown as WaiterCallRow[];
    },
    refetchInterval: 60_000,
  });

  const calls = callsQ.data ?? [];

  // Re-alarm every 60 s for raised (un-acked) calls older than 5 min. The
  // 'floor' subscription lives in TillScreen, so this instance only runs timers.
  const subjects = useAlarmSubjects(
    calls.map((c) => ({ id: c.id, status: c.status, created_at: c.raised_at })),
    'raised',
  );
  const { stale } = useAlarms({
    subjects,
    config: CALL_ALARM_CONFIG,
    topic: 'floor',
    createdEvent: 'waiter_call',
    events: ['waiter_call'],
    invalidateKeys: [],
    createdChime: 'call',
    subscribe: false,
  });

  async function act(callId: string, action: 'ack' | 'resolve') {
    setBusyId(callId);
    setError(null);
    try {
      await mutate('waiter_call.action', { callId, action });
      void queryClient.invalidateQueries({ queryKey: ['waiterCalls'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  function ageMinutes(raisedAt: string): number {
    return Math.max(0, Math.floor((Date.now() - new Date(raisedAt).getTime()) / 60_000));
  }
  function ageLabel(minutes: number): string {
    if (minutes >= ESCALATE_MIN) return tr('op.floor.overdue', { minutes });
    return minutes < 1 ? tr('op.floor.ageNow') : tr('op.floor.ageMinutes', { minutes });
  }

  return (
    <div style={{ ...card, marginBlockEnd: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
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
        {status && <ConnectionPill status={status} />}
      </div>
      {calls.length === 0 && (
        <p style={{ margin: 0, marginBlockStart: '0.3rem', color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
          {tr('op.floor.noCalls')}
        </p>
      )}
      {calls.map((c) => {
        const minutes = ageMinutes(c.raised_at);
        const tone = ageTone(minutes);
        const escalated = stale.has(c.id) || (c.status === 'raised' && minutes >= ESCALATE_MIN);
        return (
          <div
            key={c.id}
            data-escalated={escalated || undefined}
            style={{
              marginBlockStart: '0.5rem',
              fontSize: '0.9rem',
              paddingInlineStart: '0.45rem',
              border: `1px solid ${tone.color}`,
              animation: escalated ? 'tpPulse 1.2s infinite' : undefined,
            }}
          >
            {/* The till mounts this in a 13rem rail: a long table number must wrap,
                never widen the column or clip its age. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minInlineSize: 0, overflowWrap: 'anywhere' }}>
                {tr('op.floor.table', { table: isolate(c.table?.table_number ?? '—') })}
                <span
                  style={{
                    background: 'var(--tp-accent)',
                    color: 'var(--tp-accent-contrast)',
                    borderRadius: '999px',
                    paddingInline: '0.4rem',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tr('op.floor.sourceGuest')}
                </span>
              </strong>
              <span
                style={{
                  color: tone.color,
                  fontWeight: minutes >= WARN_MIN ? 700 : 400,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {ageLabel(minutes)}
              </span>
            </div>
            <div style={{ color: 'var(--tp-muted-fg)' }}>
              {tr(`op.floor.reasons.${c.reason}`)}
              {escalated && (
                <span style={{ color: 'var(--tp-danger)', fontWeight: 700 }}> · {tr('op.floor.escalated')}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', marginBlockStart: '0.25rem', alignItems: 'center' }}>
              {c.status === 'raised' ? (
                <Button disabled={busyId === c.id} onClick={() => void act(c.id, 'ack')}>
                  {tr('op.floor.ack')}
                </Button>
              ) : (
                <span style={{ color: 'var(--tp-accent)', alignSelf: 'center', fontSize: '0.85rem' }}>
                  {tr('op.floor.acked')}
                  {c.acknowledged_label && (
                    <span style={{ color: 'var(--tp-muted-fg)' }}> ({c.acknowledged_label})</span>
                  )}
                </span>
              )}
              <Button kind="primary" disabled={busyId === c.id} onClick={() => void act(c.id, 'resolve')}>
                {tr('op.floor.resolve')}
              </Button>
            </div>
            {c.resolved_label && (
              <div style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>{c.resolved_label}</div>
            )}
          </div>
        );
      })}
      <ErrorText error={error} />
    </div>
  );
}
