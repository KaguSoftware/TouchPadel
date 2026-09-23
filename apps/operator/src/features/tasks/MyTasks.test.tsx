import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { MyTasksScreen } from './MyTasks';

// Nothing can be assigned yet, so the screen's one job is to say so in a way
// that does not read as a failed load: a heading, the empty sentence, and
// what will appear here once something is.

function renderIn(locale: 'en' | 'ar') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <LocaleProvider>
      <MyTasksScreen />
    </LocaleProvider>,
  );
}

describe('MyTasksScreen', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage */
    }
  });

  it('names the page and says nothing is assigned yet', () => {
    renderIn('en');
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Nothing is assigned to you yet/ })).toBeTruthy();
    expect(screen.getByText(/Purchases, marketing tasks and checklists will appear here/)).toBeTruthy();
  });

  it('reads in Arabic from the team lane', () => {
    renderIn('ar');
    expect(screen.getByRole('heading', { level: 1, name: 'مهامي' })).toBeTruthy();
  });

  it('offers no control: there is nothing to act on yet', () => {
    renderIn('en');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
