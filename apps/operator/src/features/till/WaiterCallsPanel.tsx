/**
 * Waiter-calls floor panel (SoW Module 3): the till lists unresolved
 * waiter_calls (table, reason, age) with "On my way" / "Done" via
 * app.ack_waiter_call and app.resolve_waiter_call (0016). Fast path is the
 * private 'floor' broadcast (0022) — TillScreen owns that subscription
 * (invalidates ['waiterCalls'], chimes on `raised`) and passes its status
 * down; the refetch interval is the safety net.
 *
 * WHY IT LOOKS LIKE THIS
 *
 * It used to be one tall card per call, each in a red border with a pulsing
 * red ring, a "QR" pill, the word "Escalated" and two stacked buttons, with
 * the age counted in minutes. Eight calls left over from the day before filled
 * the till's whole start column — the open-tabs rail under it was pushed off
 * the screen — and read "Waiting 2757 min · Escalated" eight times in red, so
 * the one call raised a minute ago looked exactly like the stale ones.
 *
 *  - A call is a compact row: table, how long, what they want, and the two
 *    things a person does about it. "On my way" is what the guest's phone says
 *    once a call is acknowledged, so that is the button's name.
 *  - Urgency is carried by the age text ("Waiting 12 min", in amber or red)
 *    and a thin stripe on the row's start edge — never by a border around
 *    every row, and never by colour alone: the words say how long.
 *  - Every call comes from a guest's table QR, so the "QR" pill said nothing.
 *  - Calls older than two hours are not going to be answered by walking over.
 *    They fold into one line that says how many there are, with a way to
 *    clear them together, so a forgotten evening does not bury tonight.
 *
 * Age escalation: < 2 min muted · 2–5 min amber · ≥ 5 min red, with a 60 s
 * re-alarm for un-acked calls older than 5 min (shared alarm machine).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, isolate } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { useLocale } from '../../lib/i18n';
import type { BroadcastStatus } from '../../lib/realtime';
import { Button, ErrorText, card } from '../../components/ui';
import { ConnectionPill } from '../../components/ConnectionPill';
import { useConfirm } from '../../components/ConfirmDialog';
import { CALL_ALARM_CONFIG } from '../kds/alarms';
import { useAlarmSubjects, useAlarms } from '../kds/useKdsAlarms';
import { formatElapsed, minutesSince } from './elapsed';

type CallReason = 'order' | 'bill' | 'water' | 'assistance';

export interface WaiterCallRow {
  id: string;
  reason: CallReason;
  status: 'raised' | 'acknowledged';
  raised_at: string;
  acknowledged_label: string | null;
  resolved_label: string | null;
  table: { table_number: string } | null;
}

const ESCALATE_MIN = 5;
const WARN_MIN = 2;
/** Past this, a call is folded away as old rather than shown as live. */
export const OLD_CALL_MIN = 120;

type Urgency = 'calm' | 'warn' | 'late';

/** How urgent a call reads. An acknowledged call is somebody's already. */
export function callUrgency(status: WaiterCallRow['status'], minutes: number, stale: boolean): Urgency {
  if (status !== 'raised') return 'calm';
  if (stale || minutes >= ESCALATE_MIN) return 'late';
  if (minutes >= WARN_MIN) return 'warn';
  return 'calm';
}

/** Live calls first (oldest first — fairness), then the ones old enough to fold away. */
export function splitCalls<T extends Pick<WaiterCallRow, 'raised_at'>>(calls: readonly T[], now: number): { recent: T[]; old: T[] } {
  const recent: T[] = [];
  const old: T[] = [];
  for (const c of calls) (minutesSince(c.raised_at, now) >= OLD_CALL_MIN ? old : recent).push(c);
  return { recent, old };
}

/** Calls side by side, scrolling sideways rather than pushing the screen down. */
const STRIP_LIST = { gridAutoFlow: 'column', gridAutoColumns: 'minmax(15rem, 19rem)', overflowX: 'auto', paddingBlockEnd: 'var(--tp-sp-1)' } as const;

const URGENCY_INK: Record<Urgency, string> = {
  calm: 'var(--tp-muted-fg)',
  warn: 'var(--tp-warn-fg)',
  late: 'var(--tp-danger-fg)',
};
const URGENCY_STRIPE: Record<Urgency, string> = {
  calm: 'var(--tp-border)',
  warn: 'var(--tp-warn-mark)',
  late: 'var(--tp-danger-mark)',
};

/** Unresolved calls, oldest first. The floor plan reads the same key to mark a calling table. */
export const WAITER_CALLS_QUERY = {
  queryKey: ['waiterCalls'] as const,
  queryFn: async (): Promise<WaiterCallRow[]> => {
    const { data, error: err } = await supabase
      .from('waiter_calls')
      .select('id, reason, status, raised_at, acknowledged_label, resolved_label, table:cafe_tables(table_number)')
      .in('status', ['raised', 'acknowledged'])
      .order('raised_at');
    if (err) throw err;
    return data as unknown as WaiterCallRow[];
  },
  refetchInterval: 60_000,
};

/**
 * `strip` is the same panel laid across the top of a wide screen (the till's
 * order view, the open-tabs board): calls side by side, and nothing at all
 * while there are none, so a quiet floor costs the list below no height.
 */
export function WaiterCallsPanel({ status, layout = 'panel' }: { status?: BroadcastStatus; layout?: 'panel' | 'strip' }) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showOld, setShowOld] = useState(false);

  // Ticker so the age labels / escalation stay honest between broadcasts.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const callsQ = useQuery({ ...WAITER_CALLS_QUERY });

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

  const { recent, old } = splitCalls(calls, now);

  async function clearOld() {
    const ok = await confirm({
      title: tr('op.floor.clearOldTitle'),
      body: tr('op.floor.clearOldBody', { count: formatNumber(old.length, locale) }),
      confirmLabel: tr('op.floor.clearOldConfirm'),
      kind: 'primary',
    });
    if (!ok) return;
    setClearing(true);
    setError(null);
    try {
      // One at a time through the same write path as the Done button, so each
      // resolution is queued, audited and replayed exactly like a single one.
      for (const c of old) await mutate('waiter_call.action', { callId: c.id, action: 'resolve' });
    } catch (e) {
      setError(e);
    } finally {
      setClearing(false);
      void queryClient.invalidateQueries({ queryKey: ['waiterCalls'] });
    }
  }

  // Red only while somebody recent is still waiting for an answer: eight
  // calls left over from yesterday are a chore, not an alarm.
  const waiting = recent.filter((c) => c.status === 'raised').length;
  const strip = layout === 'strip';
  if (strip && callsQ.isSuccess && calls.length === 0 && !error) return null;

  return (
    <section
      aria-labelledby="waiter-calls-title"
      style={{
        ...card,
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        minInlineSize: 0,
        // The strip puts the heading beside the calls: one row of height, not two.
        ...(strip ? { gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', columnGap: 'var(--tp-sp-4)', paddingBlock: 'var(--tp-sp-2)' } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
        <h2 id="waiter-calls-title" style={{ margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
          {tr('op.floor.waiterCalls')}
          {calls.length > 0 && (
            <span
              style={{
                background: waiting > 0 ? 'var(--tp-danger)' : 'var(--tp-neutral-soft)',
                color: waiting > 0 ? 'var(--tp-danger-contrast)' : 'var(--tp-fg)',
                borderRadius: 'var(--tp-radius-pill)',
                paddingInline: 'var(--tp-sp-2)',
                fontSize: 'var(--tp-fs-sm)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatNumber(calls.length, locale)}
            </span>
          )}
        </h2>
        {/* "Live" on every screen is ink; the pill earns its place when the
            calls might be out of date. */}
        {status && status !== 'live' && <ConnectionPill status={status} />}
      </div>

      {callsQ.isSuccess && calls.length === 0 && (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('op.floor.noCalls')}</p>
      )}

      {recent.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)', ...(strip ? STRIP_LIST : {}) }}>
          {recent.map((c) => (
            <CallRow key={c.id} call={c} now={now} stale={stale.has(c.id)} busy={busyId === c.id || clearing} onAct={(a) => void act(c.id, a)} />
          ))}
        </ul>
      )}

      {old.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-1-5)',
            borderBlockStart: recent.length > 0 ? '1px solid var(--tp-border)' : undefined,
            paddingBlockStart: recent.length > 0 ? 'var(--tp-sp-2)' : undefined,
            // In the strip the fold goes under the live calls, across both columns.
            gridColumn: strip && recent.length > 0 ? '1 / -1' : undefined,
          }}
        >
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('op.floor.oldCalls', { count: formatNumber(old.length, locale) })}
          </p>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
            <Button size="sm" busy={clearing} onClick={() => void clearOld()}>
              {tr('op.floor.clearOld')}
            </Button>
            <Button size="sm" kind="ghost" icon="chevronDown" onClick={() => setShowOld((v) => !v)}>
              {showOld ? tr('op.floor.hideOld') : tr('op.floor.showOld')}
            </Button>
          </div>
          {showOld && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              {old.map((c) => (
                <CallRow key={c.id} call={c} now={now} stale={false} quiet busy={busyId === c.id || clearing} onAct={(a) => void act(c.id, a)} />
              ))}
            </ul>
          )}
        </div>
      )}
      <ErrorText error={error ?? callsQ.error} />
    </section>
  );
}

function CallRow({
  call,
  now,
  stale,
  quiet = false,
  busy,
  onAct,
}: {
  call: WaiterCallRow;
  now: number;
  stale: boolean;
  /** A folded-away old call: listed for tidying, not raised as an alarm. */
  quiet?: boolean;
  busy: boolean;
  onAct: (action: 'ack' | 'resolve') => void;
}) {
  const { tr } = useLocale();
  const minutes = minutesSince(call.raised_at, now);
  const urgency = quiet ? 'calm' : callUrgency(call.status, minutes, stale);
  const age = formatElapsed(call.raised_at, now, tr);
  const raised = call.status === 'raised';
  return (
    <li
      data-urgency={urgency}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2-5)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
        borderInlineStart: `3px solid ${URGENCY_STRIPE[urgency]}`,
        minInlineSize: 0,
      }}
    >
      {/* The till mounts this in a narrow column: a long table number wraps,
          the age never does. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
        <strong style={{ minInlineSize: 0, overflowWrap: 'anywhere' }}>{tr('op.floor.table', { table: isolate(call.table?.table_number ?? '—') })}</strong>
        <span
          style={{
            marginInlineStart: 'auto',
            color: URGENCY_INK[urgency],
            fontWeight: urgency === 'calm' ? 400 : 700,
            fontSize: 'var(--tp-fs-sm)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {minutes < 1 ? tr('op.floor.ageNow') : raised ? tr('op.floor.overdue', { age }) : tr('op.floor.ageMinutes', { age })}
        </span>
      </div>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr(`op.floor.reasons.${call.reason}`)}
        {!raised && (
          <>
            {' · '}
            {tr('op.floor.acked')}
            {call.acknowledged_label && <bdi> ({call.acknowledged_label})</bdi>}
          </>
        )}
      </span>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
        {raised && (
          <Button size="sm" disabled={busy} onClick={() => onAct('ack')}>
            {tr('op.floor.ack')}
          </Button>
        )}
        <Button size="sm" kind="primary" icon="check" disabled={busy} onClick={() => onAct('resolve')}>
          {tr('op.floor.resolve')}
        </Button>
      </div>
    </li>
  );
}
