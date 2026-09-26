/**
 * The branch this operator shows (multi-venue slice 4, plan MV1–MV8).
 *
 * - A registered station (0222) is its branch, always: a till at one branch
 *   never trades for another.
 * - The owner, or a manager at two branches, on a machine that is not a
 *   registered station picks the branch in the rail switcher; the choice is
 *   remembered on the machine.
 * - Anyone else works at their only branch.
 *
 * The branch rides on every request as x-venue-scope (lib/venueScope.ts), and
 * the server narrows staff reads and reports to it (0226), so screens need no
 * per-query branch filter. Switching resets the query cache: every screen
 * reloads for the new branch.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { station } from './idem';
import { setBranchScope, setStationHeader } from './venueScope';

export type VenueStatus = 'preparing' | 'open' | 'closed';

export interface VenueRow {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  status: VenueStatus;
  timezone: string;
  phone: string | null;
  created_at: string;
}

export interface VenueContextValue {
  /** Every branch that is not closed and that this person works at (the owner: all of them). */
  venues: VenueRow[];
  /** The branch the screens show; null until the lists have loaded. */
  branchId: string | null;
  current: VenueRow | null;
  /** The branch this machine is registered at as a station, if it is one. */
  stationBranchId: string | null;
  /** True when the rail offers the switcher (owner or two branches, on an unregistered machine). */
  canSwitch: boolean;
  setBranch: (id: string) => void;
}

const VenueContext = createContext<VenueContextValue | null>(null);

const STORAGE_KEY = 'tp.op.branch';

function readChoice(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeChoice(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode: the choice lasts for this session only */
  }
}

/**
 * Pure: which branch the screens show. Station first, then a remembered choice
 * the person may still use, then their only branch, then the first open one.
 */
export function pickBranch(input: {
  stationBranchId: string | null;
  choice: string | null;
  mine: string[];
  venues: Pick<VenueRow, 'id' | 'status'>[];
}): string | null {
  const { stationBranchId, choice, mine, venues } = input;
  if (stationBranchId && mine.includes(stationBranchId)) return stationBranchId;
  if (choice && mine.includes(choice)) return choice;
  if (mine.length === 1) return mine[0] ?? null;
  const firstOpen = venues.find((v) => v.status === 'open' && mine.includes(v.id));
  return firstOpen?.id ?? mine[0] ?? null;
}

export function VenueProvider({ children }: { children: ReactNode }) {
  const { session, staff } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = Boolean(session && staff);
  const [choice, setChoice] = useState<string | null>(() => readChoice());

  // This machine's station id rides on every request from the start.
  useEffect(() => {
    setStationHeader(station());
  }, []);

  const venuesQ = useQuery({
    queryKey: ['venues', 'mine'],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async (): Promise<{ venues: VenueRow[]; mine: string[] }> => {
      const [v, m] = await Promise.all([
        supabase
          .from('venues')
          .select('id, slug, name_en, name_ar, status, timezone, phone, created_at')
          .neq('status', 'closed')
          .order('created_at'),
        supabase.schema('app').rpc('staff_venue_ids'),
      ]);
      if (v.error) throw v.error;
      if (m.error) throw m.error;
      const mine = ((m.data ?? []) as string[]).filter(Boolean);
      const venues = ((v.data ?? []) as unknown as VenueRow[]).filter((row) => mine.includes(row.id));
      return { venues, mine };
    },
  });

  const stationQ = useQuery({
    queryKey: ['venues', 'station', station()],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('stations')
        .select('venue_id')
        .eq('id', station())
        .is('retired_at', null)
        .maybeSingle();
      if (error) throw error;
      return (data as { venue_id: string } | null)?.venue_id ?? null;
    },
  });

  const venues = useMemo(() => venuesQ.data?.venues ?? [], [venuesQ.data]);
  const mine = useMemo(() => venuesQ.data?.mine ?? [], [venuesQ.data]);
  const stationBranchId = stationQ.data ?? null;
  const branchId = venuesQ.data ? pickBranch({ stationBranchId, choice, mine, venues }) : null;

  // Publish before children render their queries, so the first fetches of a
  // freshly picked branch already carry it.
  setBranchScope(branchId);

  // A real switch (not the first resolution) reloads every screen.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current && branchId && previous.current !== branchId) {
      void queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== 'venues' });
    }
    previous.current = branchId;
  }, [branchId, queryClient]);

  const setBranch = useCallback((id: string) => {
    writeChoice(id);
    setChoice(id);
  }, []);

  const isOwner = staff?.role === 'owner';
  const value = useMemo<VenueContextValue>(
    () => ({
      venues,
      branchId,
      current: venues.find((v) => v.id === branchId) ?? null,
      stationBranchId,
      canSwitch: !stationBranchId && (isOwner || mine.length > 1) && venues.length > 1,
      setBranch,
    }),
    [venues, branchId, stationBranchId, isOwner, mine.length, setBranch],
  );

  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

/** The branch context; outside the provider (unit tests) a one-branch default. */
export function useVenue(): VenueContextValue {
  return (
    useContext(VenueContext) ?? {
      venues: [],
      branchId: null,
      current: null,
      stationBranchId: null,
      canSwitch: false,
      setBranch: () => undefined,
    }
  );
}

/** Staff broadcast topics that exist per branch since 0224 ('kds', 'floor', 'courts'). */
const PER_BRANCH_TOPICS = new Set(['kds', 'floor', 'courts']);

/** Pure: the realtime topic for a branch; the literal topic while no branch is known. */
export function branchTopic(topic: string, branchId: string | null): string {
  return branchId && PER_BRANCH_TOPICS.has(topic) ? `${topic}:${branchId}` : topic;
}
