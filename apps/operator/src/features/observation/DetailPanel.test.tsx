import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import type { WorkspaceKey } from '../../lib/workspaces';

// The panel's one button is its only way forward. These pin its words: the
// workspace's "Open in …", or the record's own (a lesson: "Open lesson", as the
// desk says it, coaching operator.md §5.8), and that a role without that
// workspace is offered nothing.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const setActive = vi.fn();
let available: readonly WorkspaceKey[] = ['owner', 'courtDesk'];
vi.mock('../../routes/__root', () => ({ useWorkspace: () => ({ available, setActive }) }));

import { DetailPanel, type WorkspaceTarget } from './DetailPanel';
import { reservationPanelTarget } from './observeLogic';

const LESSON_ROW = { id: 'r1', kind: 'lesson' as const };

function renderPanel(target: WorkspaceTarget | null, locale: 'en' | 'ar' = 'en') {
  localStorage.setItem('touch-operator-locale', locale);
  return render(
    <LocaleProvider>
      <DetailPanel eyebrow="Lesson" title="Beginners" onClose={vi.fn()} target={target}>
        <p>body</p>
      </DetailPanel>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  setActive.mockReset();
  available = ['owner', 'courtDesk'];
});

afterEach(() => {
  localStorage.removeItem('touch-operator-locale');
});

describe('DetailPanel', () => {
  it('words a booking’s button by its workspace', () => {
    renderPanel({ workspace: 'courtDesk', to: '/desk/bookings/$id', params: { id: 'b1' } });
    expect(screen.getByRole('button', { name: 'Open in Court desk' })).toBeTruthy();
  });

  it.each([
    ['en', 'Open lesson'],
    ['ar', 'فتح الحصة'],
  ] as const)(
    'offers a lesson as "Open lesson" and opens it on the desk, in %s',
    (locale, label) => {
      renderPanel(reservationPanelTarget(LESSON_ROW, true, 'l1'), locale);
      expect(
        screen.queryByRole('button', {
          name: locale === 'en' ? 'Open in Court desk' : 'فتح في مكتب الملاعب',
        }),
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(setActive).toHaveBeenCalledWith('courtDesk');
      expect(navigate).toHaveBeenCalledWith({
        to: '/desk/lessons/$id',
        search: undefined,
        params: { id: 'l1' },
      });
    },
  );

  it('offers nothing to a role that cannot open the court desk', () => {
    available = ['cashier'];
    renderPanel(reservationPanelTarget(LESSON_ROW, true, 'l1'));
    expect(screen.queryByRole('button', { name: 'Open lesson' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open in Court desk' })).toBeNull();
  });
});
