/**
 * The live floor — the reads.
 *
 * Eight small table reads in parallel, all of them rows the working screens
 * already fetch (courts and today's bookings for the desk, open tabs for the
 * till, staff, station assignments, heartbeats and breaks for the rail), so
 * the plan cannot disagree with the boards about what is open. No RPC was
 * added for it: everything it shows is a row the owner can already read.
 *
 * Polled every 30 s and invalidated on the 'floor' and 'courts' broadcasts,
 * the same pair the manager's Today screen listens to.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useBroadcast, type BroadcastStatus } from '../../lib/realtime';
import {
  composeSnapshot,
  LOOKAHEAD_MS,
  type FloorRaw,
  type FloorSnapshot,
  type RawBooking,
  type RawBreak,
  type RawCourt,
  type RawHeartbeat,
  type RawStaff,
  type RawStationStaff,
  type RawTab,
  type RawTable,
} from './floorModel';

export const FLOOR_QUERY_KEY = ['liveFloor'] as const;
export const FLOOR_REFETCH_MS = 30_000;

function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

export async function fetchFloorRaw(nowMs = Date.now()): Promise<FloorRaw> {
  const nowIso = new Date(nowMs).toISOString();
  const laterIso = new Date(nowMs + LOOKAHEAD_MS).toISOString();
  const [courts, bookings, tables, tabs, staff, stationStaff, heartbeats, breaks] = await Promise.all([
    supabase.from('courts').select('id, name_en, name_ar, sort_order').eq('is_active', true).order('sort_order').then(unwrap<RawCourt[]>),
    supabase
      .from('reservations')
      .select('id, court_id, status, start_at, end_at, guest_name')
      .eq('kind', 'booking')
      .in('status', ['confirmed', 'arrived'])
      .gt('end_at', nowIso)
      .lt('start_at', laterIso)
      .then(unwrap<RawBooking[]>),
    supabase.from('cafe_tables').select('id, table_number').eq('is_active', true).then(unwrap<RawTable[]>),
    supabase
      .from('tabs')
      .select('id, status, table_id, label, opened_at, reservation:reservations!tabs_reservation_id_fkey(guest_name)')
      .in('status', ['open', 'awaiting_payment'])
      .is('merged_into_tab_id', null)
      .then((r) => unwrap<unknown[]>(r) as RawTab[]),
    supabase.from('staff').select('id, display_name, role').eq('is_active', true).then(unwrap<RawStaff[]>),
    supabase.from('station_staff').select('station_id, staff_id').then(unwrap<RawStationStaff[]>),
    supabase.from('device_heartbeats').select('device_id, last_seen_at, staff_id').then(unwrap<RawHeartbeat[]>),
    supabase
      .from('staff_breaks')
      .select('staff_id, station_id, started_at, covered_by, cover_started_at')
      .is('ended_at', null)
      .then(unwrap<RawBreak[]>),
  ]);
  return { courts, bookings, tables, tabs, staff, stationStaff, heartbeats, breaks };
}

export interface LiveFloorResult {
  snapshot: FloorSnapshot | null;
  status: 'loading' | 'error' | 'ready';
  error: unknown;
  /** When the rows were last read, ms epoch; 0 before the first read. */
  updatedAt: number;
  connection: BroadcastStatus;
  refetch: () => void;
}

export function useLiveFloor(): LiveFloorResult {
  const q = useQuery({
    queryKey: FLOOR_QUERY_KEY,
    queryFn: () => fetchFloorRaw(),
    refetchInterval: FLOOR_REFETCH_MS,
  });
  const floor = useBroadcast({ topic: 'floor', isPrivate: true, invalidateKeys: [FLOOR_QUERY_KEY] });
  const courts = useBroadcast({ topic: 'courts', isPrivate: true, invalidateKeys: [FLOOR_QUERY_KEY] });

  // Composed against the moment the rows arrived, not the render: a court
  // whose booking ends between two polls flips on the next read, as the
  // boards do, rather than on whichever re-render happens to run first.
  const snapshot = useMemo(() => (q.data ? composeSnapshot(q.data, q.dataUpdatedAt || Date.now()) : null), [q.data, q.dataUpdatedAt]);

  const connection: BroadcastStatus =
    floor.status === 'live' && courts.status === 'live' ? 'live' : floor.status === 'disconnected' || courts.status === 'disconnected' ? 'disconnected' : 'connecting';

  return {
    snapshot,
    status: q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : 'ready',
    error: q.error,
    updatedAt: q.dataUpdatedAt,
    connection,
    refetch: () => void q.refetch(),
  };
}
