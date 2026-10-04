import { describe, expect, it } from 'vitest';

// The desk calendar's tournament overlay (build contracts §1.11). DeskCalendar
// cannot be mounted here, so its call sites are pinned by source text: only a
// block its tournament still holds (open, closed, running: the guard trigger's
// set, isLiveAdoptedBlock) refuses the drag and opens the tournament. A
// finished or cancelled tournament's leftover block is the desk's again, as on
// BookingDetail.

const SOURCES = import.meta.glob('../desk/DeskCalendar.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const src = Object.values(SOURCES)[0] ?? '';

describe('DeskCalendar and adopted blocks', () => {
  it('reads the calendar source', () => {
    expect(src.length).toBeGreaterThan(1000);
  });

  it('refuses the drag only for a block its tournament still holds', () => {
    expect(src).toContain('isLiveAdoptedBlock(tournamentsBy.get(r.id))');
    expect(src).not.toContain('tournamentsBy.has(r.id)');
    expect(src).toContain('const heldBy = isLiveAdoptedBlock(tournament) ? tournament : null;');
    expect(src).toContain('const draggable = !heldBy && canMoveReservation(r, now);');
  });

  it('opens the tournament only for a held block; any other opens its own detail', () => {
    expect(src).toContain('if (heldBy) {');
    expect(src).toContain('params: { id: heldBy.id }');
    expect(src).not.toMatch(/if \(tournament\) \{/);
  });
});
