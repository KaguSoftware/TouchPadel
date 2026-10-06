import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';
import type { HeartbeatState } from '../lib/heartbeat';
import type * as BridgeModule from '../ipc/bridge';

// The station's own write path on the status strip (ported from
// fix/offline-signals c2dad117). The beat is a READ over PostgREST; the queue
// drains over the replay edge function. A till whose beat works but whose
// uploads fail used to sit on the green "Connected." strip, because the flag
// that knew (QueueStatus.uploadBlocked) had no reader.

const h = vi.hoisted(() => ({
  push: null as null | ((s: BridgeModule.QueueStatus) => void),
}));

vi.mock('../ipc/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof BridgeModule>();
  return {
    ...actual,
    touch: {
      ...actual.touch,
      onQueueUpdate: (cb: (s: BridgeModule.QueueStatus) => void) => {
        h.push = cb;
        return () => {
          h.push = null;
        };
      },
    },
  };
});

import { VenueStatusBanner } from './VenueStatusBanner';

const OK: HeartbeatState = { degraded: false, queueDepth: 0, error: null, lastOkAt: 1 };
const QUEUE = { depth: 3, uploadBlocked: false, conflicts: 0, failed: 0, blocking: 3 };

function strip(state: HeartbeatState) {
  const { container } = render(
    <LocaleProvider>
      <VenueStatusBanner state={state} />
    </LocaleProvider>,
  );
  return () => container.querySelector('[data-venue-status]')!;
}

beforeEach(() => {
  h.push = null;
});

describe('VenueStatusBanner', () => {
  it('a reachable station whose uploads are blocked does not read as connected', () => {
    const el = strip(OK);
    expect(el().getAttribute('data-connectivity')).toBe('ok');
    act(() => h.push?.({ ...QUEUE, uploadBlocked: true }));
    expect(el().getAttribute('data-connectivity')).toBe('uploadBlocked');
    expect(el().textContent).toMatch(/cannot send/i);
    // A flag, not a count: the strip still shows no queue numbers.
    expect(el().textContent).not.toMatch(/\d/);
    act(() => h.push?.(QUEUE));
    expect(el().getAttribute('data-connectivity')).toBe('ok');
  });

  it('outranks the venue verdict, and yields to an unreachable station', () => {
    const el = strip({ ...OK, degraded: true });
    act(() => h.push?.({ ...QUEUE, uploadBlocked: true }));
    expect(el().getAttribute('data-connectivity')).toBe('uploadBlocked');

    const off = strip({ ...OK, error: new Error('down') });
    act(() => h.push?.({ ...QUEUE, uploadBlocked: true }));
    expect(off().getAttribute('data-connectivity')).toBe('offline');
  });
});
