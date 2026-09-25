/**
 * The desk's event mode of `/desk/block?run=&step=` (build-contracts-2026-09-23
 * §2.11, §5.5): what `app.tournament_context` returns, read into the windows
 * the court desk has to block, and what `app.block_courts_for_event` answers.
 *
 * A tournament plan names ranges, each a set of courts and one window. The desk
 * blocks one window per court of each range, exactly as the plan says; a window
 * the run has already blocked (same court, same start and end) shows as done,
 * so asking again after moving a booking only sends what is left. The server
 * writes nothing while any live reservation is in the way and lists it instead.
 *
 * Pure: the screen renders these and calls the RPCs.
 */

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
}
function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export interface Names {
  en: string;
  ar: string;
}

export interface EventBlock {
  reservationId: string;
  courtId: string;
  startAt: string;
  endAt: string;
}

export interface ContextRange {
  courtIds: string[];
  courtNames: Names[];
  from: string;
  to: string;
}

export interface TournamentContext {
  name: Names;
  tournamentClass: string | null;
  format: string | null;
  capacity: { unit: 'players' | 'pairs'; count: number } | null;
  ranges: ContextRange[];
  blocked: EventBlock[];
}

function readBlock(r: Raw): EventBlock | null {
  const reservationId = str(r.reservation_id);
  const courtId = str(r.court_id);
  const startAt = str(r.start_at);
  const endAt = str(r.end_at);
  return reservationId && courtId && startAt && endAt ? { reservationId, courtId, startAt, endAt } : null;
}

/** `app.tournament_context`, read defensively: a field it lacks is empty, never invented. */
export function readTournamentContext(payload: unknown): TournamentContext {
  const p = obj(payload);
  const cap = obj(p.capacity);
  const unit = cap.unit === 'players' || cap.unit === 'pairs' ? cap.unit : null;
  const count = typeof cap.count === 'number' ? cap.count : null;
  return {
    name: { en: str(p.name_en) ?? '', ar: str(p.name_ar) ?? '' },
    tournamentClass: str(p.class),
    format: str(p.format),
    capacity: unit && count !== null ? { unit, count } : null,
    ranges: list(p.ranges)
      .map((r) => ({
        courtIds: Array.isArray(r.court_ids) ? r.court_ids.filter((x): x is string => typeof x === 'string') : [],
        courtNames: list(r.court_names).map((n) => ({ en: str(n.en) ?? '', ar: str(n.ar) ?? '' })),
        from: str(r.from) ?? '',
        to: str(r.to) ?? '',
      }))
      .filter((r) => r.courtIds.length > 0 && r.from !== '' && r.to !== ''),
    blocked: list(p.blocked)
      .map(readBlock)
      .filter((b): b is EventBlock => b !== null),
  };
}

/** One window to block: a court of a range, with the run's block when it has one. */
export interface PlannedWindow {
  key: string;
  courtId: string;
  courtName: Names;
  from: string;
  to: string;
  /** The run's live block of exactly this court and window; null while it is still to block. */
  reservationId: string | null;
}

function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/**
 * Every (range, court) window of the plan in plan order, the same court and
 * window listed once, each matched to the run's block of that court and window.
 */
export function plannedWindows(ctx: TournamentContext): PlannedWindow[] {
  const out: PlannedWindow[] = [];
  const seen = new Set<string>();
  for (const range of ctx.ranges) {
    range.courtIds.forEach((courtId, i) => {
      const key = `${courtId}|${Date.parse(range.from)}|${Date.parse(range.to)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const block = ctx.blocked.find(
        (b) => b.courtId === courtId && sameInstant(b.startAt, range.from) && sameInstant(b.endAt, range.to),
      );
      out.push({
        key,
        courtId,
        courtName: range.courtNames[i] ?? { en: '', ar: '' },
        from: range.from,
        to: range.to,
        reservationId: block?.reservationId ?? null,
      });
    });
  }
  return out;
}

/** `p_blocks` for the windows still to block. */
export function blocksToSend(windows: readonly PlannedWindow[]): Array<{ court_id: string; start_at: string; end_at: string }> {
  return windows
    .filter((w) => w.reservationId === null)
    .map((w) => ({ court_id: w.courtId, start_at: w.from, end_at: w.to }));
}

export interface BlockConflict {
  reservationId: string;
  courtId: string;
  startAt: string;
  endAt: string;
  kind: 'booking' | 'hold' | 'maintenance' | string;
  status: string;
}

export interface BlockAnswer {
  blocked: EventBlock[];
  conflicts: BlockConflict[];
}

/** `app.block_courts_for_event`: what was blocked, or what is in the way. */
export function readBlockAnswer(payload: unknown): BlockAnswer {
  const p = obj(payload);
  return {
    blocked: list(p.blocked)
      .map(readBlock)
      .filter((b): b is EventBlock => b !== null),
    conflicts: list(p.conflicts)
      .map((c) => ({
        reservationId: str(c.reservation_id) ?? '',
        courtId: str(c.court_id) ?? '',
        startAt: str(c.start_at) ?? '',
        endAt: str(c.end_at) ?? '',
        kind: str(c.kind) ?? '',
        status: str(c.status) ?? '',
      }))
      .filter((c) => c.reservationId !== ''),
  };
}

/** The run's blocks of the plan's windows, in plan order: what the desk has done. */
export function plannedBlockIds(windows: readonly PlannedWindow[]): string[] {
  return windows.flatMap((w) => (w.reservationId ? [w.reservationId] : []));
}

/**
 * The courts step's record: the run's blocks of the plan's windows, and the
 * optional note. A live block of no planned window (one that has started
 * after the plan moved) is not sent: the server counts only the passed plan's.
 */
export function courtsRecord(ctx: TournamentContext, movedNote: string): { reservation_ids: string[]; moved_note?: string } {
  const note = movedNote.trim();
  return {
    reservation_ids: plannedBlockIds(plannedWindows(ctx)),
    ...(note ? { moved_note: note } : {}),
  };
}

/** The note's cap on the courts record (§2.1: free text 2000). */
export const MOVED_NOTE_MAX = 2000;

export interface CourtsStep {
  status: string | null;
  canSubmit: boolean;
  isCourtsStep: boolean;
}

/** `app.protocol_step_detail`, as much of it as the event mode needs. */
export function readCourtsStep(payload: unknown): CourtsStep {
  const p = obj(payload);
  const step = obj(p.step);
  const run = obj(p.run);
  return {
    status: str(step.status),
    canSubmit: obj(p.can).submit === true,
    isCourtsStep: step.step_key === 'courts' && run.kind === 'tournament',
  };
}
