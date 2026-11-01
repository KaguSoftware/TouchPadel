import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';

// F-29: a manager could ring up shop sales on the café till, and the cash
// landed in the café till's open shift.

let electron = true;
let mode: 'till' | 'desk' | 'kds' | 'shop' = 'till';

vi.mock('../lib/mutate', () => ({ isElectron: () => electron }));
vi.mock('../ipc/bridge', () => ({ touch: { getStation: () => ({ stationId: 'TILL-01', mode, configured: true, appVersion: 't' }) } }));
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: null }) };
});

import { StationKindGate } from './StationKindGate';

function mount(screenName: 'shopTill' | 'kds') {
  return render(
    <LocaleProvider>
      <StationKindGate screen={screenName}>
        <div data-testid="inside">sell</div>
      </StationKindGate>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  electron = true;
  mode = 'till';
  localStorage.clear();
});

describe('StationKindGate', () => {
  it('refuses the shop till on the café till, and says why', () => {
    mount('shopTill');
    expect(screen.queryByTestId('inside')).toBeNull();
    expect(screen.getByText('The shop till is not on this station')).toBeTruthy();
    expect(screen.getByText(/This station is a café till\. Shop sales are taken on the shop station/)).toBeTruthy();
  });

  it('opens the shop till on the shop station', () => {
    mode = 'shop';
    mount('shopTill');
    expect(screen.getByTestId('inside')).toBeTruthy();
  });

  it('refuses the kitchen board on the court desk, opens it on the café till and a kitchen screen', () => {
    mode = 'desk';
    const { unmount } = mount('kds');
    expect(screen.getByText('The kitchen board is not on this station')).toBeTruthy();
    unmount();
    mode = 'till';
    mount('kds');
    expect(screen.getByTestId('inside')).toBeTruthy();
  });

  it('browser mode is not a station: unchanged', () => {
    electron = false;
    mount('shopTill');
    expect(screen.getByTestId('inside')).toBeTruthy();
  });

  it('says it in Arabic too', () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    mount('shopTill');
    expect(screen.getByText('كاشير المتجر ليس على هذه المحطة')).toBeTruthy();
  });
});
