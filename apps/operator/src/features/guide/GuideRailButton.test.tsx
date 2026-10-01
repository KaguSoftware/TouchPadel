import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import type { WorkspaceKey } from '../../lib/workspaces';
import { guideFor } from './guideContent';
import { GuideRailButton } from './GuideRailButton';

// The provider needs auth and the router; the row only reads the context, so
// the hook is stubbed the way RailMoreMenu.test stubs the assistant drawer.
const guide = {
  workspace: 'cashier' as WorkspaceKey,
  available: true,
  open: false,
  openGuide: vi.fn(),
  closeGuide: vi.fn(),
  tab: null,
  setTab: vi.fn(),
};
vi.mock('./GuideProvider', () => ({
  useGuideOrNull: () => guide,
}));

function renderRow(workspace: WorkspaceKey) {
  guide.workspace = workspace;
  guide.available = guideFor(workspace) !== null;
  render(
    <LocaleProvider>
      <GuideRailButton />
    </LocaleProvider>,
  );
}

describe('the rail Guide row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['cashier', 'courtDesk', 'shop'] as WorkspaceKey[])('shows on %s', (ws) => {
    renderRow(ws);
    const row = screen.getByTestId('rail.guide');
    expect(row.textContent).toContain('Guide');
    expect(row.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it.each(['manager', 'owner', 'team'] as WorkspaceKey[])('is absent on %s', (ws) => {
    renderRow(ws);
    expect(screen.queryByTestId('rail.guide')).toBeNull();
  });

  it('opens the guide', async () => {
    renderRow('cashier');
    await userEvent.click(screen.getByTestId('rail.guide'));
    expect(guide.openGuide).toHaveBeenCalledTimes(1);
  });
});
