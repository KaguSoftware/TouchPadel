import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import type { FloorSnapshot } from './floorModel';
import type { LiveFloorResult } from './floorData';

// The panel is what the owner reads; the three.js scene is drawn only where
// WebGL exists, and jsdom has none — so these tests pin everything the panel
// says in words: the counts, the honesty line, the states, and the fallback.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const live = vi.fn<() => LiveFloorResult>();
vi.mock('./floorData', () => ({ useLiveFloor: () => live() }));

import { LiveFloor } from './LiveFloor';

const snapshot: FloorSnapshot = {
  courts: [
    { id: 'c1', slot: 0, name_en: 'Court 1', name_ar: 'ملعب ١', status: 'in_play', guest: 'Ahmed K.', until: '2026-09-18T19:30:00Z', nextAt: null, waiting: null },
    { id: 'c2', slot: 1, name_en: 'Court 2', name_ar: 'ملعب ٢', status: 'free', guest: null, until: null, nextAt: null, waiting: null },
    { id: 'c3', slot: null, name_en: 'Court 3', name_ar: 'ملعب ٣', status: 'free', guest: null, until: null, nextAt: null, waiting: null },
  ],
  tables: [
    { id: 't1', slot: 0, number: '1', status: 'occupied', tab: { id: 'x', label: null, guest: 'Ali', state: 'awaiting_payment', openedAt: '2026-09-18T18:00:00Z' } },
    { id: 't2', slot: 1, number: '2', status: 'free', tab: null },
  ],
  staff: [
    { id: 's1', name: 'Zainab', role: 'court_desk', room: 'reception', status: 'working', stationId: 'DESK-01', coveringFor: null, since: null },
    { id: 's2', name: 'Omar', role: 'cashier', room: 'bar', status: 'break', stationId: 'TILL-01', coveringFor: null, since: '2026-09-18T18:10:00Z' },
  ],
};

function result(partial: Partial<LiveFloorResult> = {}): LiveFloorResult {
  return { snapshot, status: 'ready', error: null, updatedAt: Date.parse('2026-09-18T18:20:00Z'), connection: 'live', refetch: vi.fn(), ...partial };
}

function renderFloor(props: Parameters<typeof LiveFloor>[0] = {}) {
  return render(
    <LocaleProvider>
      <LiveFloor {...props} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  live.mockReset();
  navigate.mockReset();
});

describe('LiveFloor', () => {
  it('says the counts in words: courts of total, tables of total, staff at a station and on break', () => {
    live.mockReturnValue(result());
    renderFloor();
    expect(screen.getByRole('heading', { name: 'Live floor' })).toBeTruthy();
    const counts = within(document.querySelector('dl')!);
    expect(counts.getByText('Courts in play').nextSibling?.textContent).toBe('1 of 3');
    expect(counts.getByText('Tables occupied').nextSibling?.textContent).toBe('1 of 2');
    expect(counts.getByText('Staff at a station').nextSibling?.textContent).toBe('1');
    expect(counts.getByText('On break').nextSibling?.textContent).toBe('1');
    expect(screen.getByTestId('connection-pill').getAttribute('data-status')).toBe('live');
  });

  it('hides the break count when nobody is on one — a zero there is not a fact worth a line', () => {
    live.mockReturnValue(result({ snapshot: { ...snapshot, staff: snapshot.staff.filter((p) => p.status !== 'break') } }));
    renderFloor();
    expect(screen.queryByText('On break')).toBeNull();
  });

  it('admits what the plan cannot draw', () => {
    live.mockReturnValue(result());
    renderFloor();
    const line = screen.getByText(/Courts not on this plan/).closest('p')!;
    expect(line.textContent).toContain('Courts not on this plan 1');
    expect(line.textContent).not.toContain('Tables not on this plan');
    expect(line.textContent).toContain('The plan draws the venue as built.');
  });

  it('says nothing about the plan’s limits when everything fits', () => {
    live.mockReturnValue(result({ snapshot: { ...snapshot, courts: snapshot.courts.slice(0, 2) } }));
    renderFloor();
    expect(screen.queryByText(/not on this plan/)).toBeNull();
  });

  it('without WebGL the counts still stand and the plan says why it is missing', () => {
    live.mockReturnValue(result());
    renderFloor();
    expect(screen.getByTestId('floor-no-webgl').textContent).toContain('cannot draw the 3D plan');
    expect(screen.getByText('Courts in play')).toBeTruthy();
  });

  it('loading shows a skeleton and no counts; an error offers a retry', () => {
    live.mockReturnValue(result({ snapshot: null, status: 'loading', updatedAt: 0, connection: 'connecting' }));
    const { unmount } = renderFloor();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('Courts in play')).toBeNull();
    unmount();

    const refetch = vi.fn();
    live.mockReturnValue(result({ snapshot: null, status: 'error', error: new Error('boom'), refetch }));
    renderFloor();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('offers the Observe boards only where asked, and they go there', () => {
    live.mockReturnValue(result());
    const { unmount } = renderFloor();
    expect(screen.queryByRole('button', { name: 'Bookings board' })).toBeNull();
    unmount();

    renderFloor({ boardLinks: true });
    fireEvent.click(screen.getByRole('button', { name: 'Bookings board' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/observation/courts' });
    fireEvent.click(screen.getByRole('button', { name: 'Tills board' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/observation/tills' });
  });

  it('shows the time of the last read', () => {
    live.mockReturnValue(result());
    renderFloor();
    expect(screen.getByText(/^Updated /)).toBeTruthy();
  });
});
