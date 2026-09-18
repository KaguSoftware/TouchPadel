/**
 * The Phase 2 gate on the Live floor plan — both halves of it, both ways round.
 *
 * WHY THE FLAG IS MOCKED RATHER THAN READ. The point of a gate is that it gets
 * flipped, and a test that asserted the real flag's current value would fail
 * the moment somebody follows `docs/PHASE-2-RECONNECT.md` — turning the revert
 * into a two-file job and the suite into a thing to argue with. So each test
 * states the flag it wants and pins the BEHAVIOUR that must follow from it.
 * Both directions stay covered whichever way the real constant points.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { EMPTY_SNAPSHOT, type FloorSnapshot } from './floorModel';
import type { LiveFloorResult } from './floorData';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const live = vi.fn<() => LiveFloorResult>();
vi.mock('./floorData', () => ({ useLiveFloor: () => live() }));

const gate = vi.hoisted(() => ({ restricted: true }));
vi.mock('./phaseGate', () => ({
  get PHASE_2_RESTRICTED() {
    return gate.restricted;
  },
  PHASE_2_LABEL: 'PHASE 2 RESTRICTED',
}));

import { LiveFloor } from './LiveFloor';

const busy: FloorSnapshot = {
  courts: [{ id: 'c1', slot: 0, name_en: 'Court 1', name_ar: 'ملعب ١', status: 'in_play', guest: 'Ahmed K.', players: 4, until: '2026-09-18T19:30:00Z', nextAt: null }],
  tables: [{ id: 't1', slot: 0, number: '1', status: 'occupied', tab: { id: 'x', label: null, guest: 'Ali', state: 'open', openedAt: '2026-09-18T18:00:00Z' } }],
  staff: [{ id: 's1', name: 'Zainab', role: 'court_desk', room: 'reception', status: 'working', stationId: 'DESK-01', coveringFor: null, since: null }],
};

/** What `useLiveFloor` answers while the gate is on (floorData.ts). */
function offResult(): LiveFloorResult {
  return { snapshot: EMPTY_SNAPSHOT, status: 'ready', error: null, updatedAt: 0, connection: 'disconnected', refetch: vi.fn() };
}

function renderFloor() {
  return render(
    <LocaleProvider>
      <LiveFloor />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  gate.restricted = true;
  live.mockReset();
  navigate.mockReset();
});

describe('Phase 2 gate — restricted', () => {
  it('says PHASE 2 RESTRICTED over the panel', () => {
    live.mockReturnValue(offResult());
    renderFloor();
    expect(screen.getByTestId('phase-2-restricted').textContent).toBe('PHASE 2 RESTRICTED');
  });

  it('blurs the panel body and puts it out of reach of pointer, keyboard and screen reader', () => {
    live.mockReturnValue(offResult());
    renderFloor();
    const blurred = document.querySelector('[inert]') as HTMLElement;
    expect(blurred).toBeTruthy();
    expect(blurred.style.filter).toContain('blur');
    expect(blurred.style.pointerEvents).toBe('none');
    expect(blurred.getAttribute('aria-hidden')).toBe('true');
    // The counts are INSIDE it — the gate covers the whole body, not just the plan.
    expect(within(blurred).getByText('Courts in play')).toBeTruthy();
  });

  // The label must not be swallowed by the blur it stands on, and it must not
  // become a control either: there is nothing behind it to click.
  it('leaves the label itself sharp and untouchable', () => {
    live.mockReturnValue(offResult());
    renderFloor();
    const label = screen.getByTestId('phase-2-restricted');
    expect(label.closest('[inert]')).toBeNull();
    expect((label.parentElement as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('reads as disconnected, and every count as a static zero', () => {
    live.mockReturnValue(offResult());
    renderFloor();
    expect(screen.getByTestId('connection-pill').getAttribute('data-status')).toBe('disconnected');
    const counts = within(document.querySelector('dl')!);
    expect(counts.getByText('Courts in play').nextSibling?.textContent).toBe('0 of 0');
    expect(counts.getByText('Tables occupied').nextSibling?.textContent).toBe('0 of 0');
    expect(counts.getByText('Staff at a station').nextSibling?.textContent).toBe('0');
  });

  // A gate is not a mute button: whatever it is handed, it shows none of it.
  it('shows nothing even if the hook hands it a busy floor', () => {
    live.mockReturnValue({ ...offResult(), snapshot: busy, connection: 'live' });
    renderFloor();
    expect(screen.getByTestId('phase-2-restricted')).toBeTruthy();
    expect(screen.getByText('Courts in play').closest('[inert]')).toBeTruthy();
  });

  // No feed is on its way, so a skeleton would promise a fetch that is not
  // happening.
  it('never leaves a loading skeleton spinning in the stage', () => {
    live.mockReturnValue(offResult());
    renderFloor();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  // The plan is DRAWN under the gate — it is the live layer that is empty, not
  // the picture. What it must not offer is anything to press: a control behind
  // a blur, on a plan with no state to explore, only looks broken.
  it('offers no zoom, no full screen and no drag hint', () => {
    live.mockReturnValue(offResult());
    renderFloor();
    expect(screen.queryByRole('button', { name: /zoom|full screen/i })).toBeNull();
    expect(screen.queryByText(/drag to look around/i)).toBeNull();
  });
});

describe('Phase 2 gate — reconnected', () => {
  beforeEach(() => {
    gate.restricted = false;
  });

  it('the label and the blur are gone', () => {
    live.mockReturnValue({ snapshot: busy, status: 'ready', error: null, updatedAt: Date.parse('2026-09-18T18:20:00Z'), connection: 'live', refetch: vi.fn() });
    renderFloor();
    expect(screen.queryByTestId('phase-2-restricted')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('the real floor is shown again', () => {
    live.mockReturnValue({ snapshot: busy, status: 'ready', error: null, updatedAt: Date.parse('2026-09-18T18:20:00Z'), connection: 'live', refetch: vi.fn() });
    renderFloor();
    const counts = within(document.querySelector('dl')!);
    expect(counts.getByText('Courts in play').nextSibling?.textContent).toBe('1 of 1');
    expect(screen.getByTestId('connection-pill').getAttribute('data-status')).toBe('live');
  });
});
