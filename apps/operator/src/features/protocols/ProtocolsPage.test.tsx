import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { ProtocolsPageScreen } from './ProtocolsPage';

// The D1 placeholder: a followed link (?start=, ?run=) must land on a named
// page that says what will be here, not on a blank screen or a failed load.
// D2 replaces the page and this test with it.

function renderIn(locale: 'en' | 'ar') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <LocaleProvider>
      <ProtocolsPageScreen />
    </LocaleProvider>,
  );
}

describe('ProtocolsPageScreen (placeholder)', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage */
    }
  });

  it('names the page and says it is not ready yet', () => {
    renderIn('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Protocols' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Protocols are not ready yet/ })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('reads in Arabic from the protocols lane', () => {
    renderIn('ar');
    expect(screen.getByRole('heading', { level: 1, name: 'البروتوكولات' })).toBeTruthy();
    expect(screen.getByText(/وتُتّخذ قراراتها/)).toBeTruthy();
  });
});
