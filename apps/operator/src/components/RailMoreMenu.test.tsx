// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../lib/i18n';
import { ThemeModeProvider } from '../lib/themeMode';
import { RailMoreMenu } from './RailMoreMenu';

// The drawer's own provider needs auth and the router; the menu only ever
// reads `allowed`/`open` and calls `toggleDrawer`, so the hook is stubbed.
const drawer = { open: false, openDrawer: vi.fn(), closeDrawer: vi.fn(), toggleDrawer: vi.fn(), allowed: true };
vi.mock('../features/assistant/AssistantDrawer', () => ({
  useAssistantDrawerOrNull: () => drawer,
}));

function Wrap({ children }: { children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <LocaleProvider>{children}</LocaleProvider>
    </ThemeModeProvider>
  );
}

function renderMenu(
  props: Partial<{ canSwitch: boolean; onWorkspacePicker: boolean; onSwitchWorkspace: () => void }> = {},
) {
  const onSwitchWorkspace = props.onSwitchWorkspace ?? vi.fn();
  render(
    <Wrap>
      <RailMoreMenu
        canSwitch={props.canSwitch ?? true}
        onWorkspacePicker={props.onWorkspacePicker}
        onSwitchWorkspace={onSwitchWorkspace}
      />
    </Wrap>,
  );
  return { onSwitchWorkspace };
}

/** The collapsed body is in the DOM but inert; this is what "shut" means. */
function body() {
  return document.getElementById('rail-more-body');
}

describe('the rail foot group', () => {
  beforeEach(() => {
    localStorage.clear();
    drawer.allowed = true;
    drawer.open = false;
    vi.clearAllMocks();
  });

  it('starts collapsed, with the four controls inert', () => {
    renderMenu();
    expect(screen.getByTestId('rail.more').getAttribute('aria-expanded')).toBe('false');
    expect(body()?.getAttribute('data-open')).toBeNull();
    expect(body()?.firstElementChild?.hasAttribute('inert')).toBe(true);
  });

  it('expands in place rather than opening a floating layer', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('rail.more'));
    expect(screen.getByTestId('rail.more').getAttribute('aria-expanded')).toBe('true');
    expect(body()?.getAttribute('data-open')).toBe('true');
    expect(body()?.firstElementChild?.hasAttribute('inert')).toBe(false);
    // The body stays a child of the group: nothing is portalled out.
    expect(screen.getByTestId('rail.more.language').closest('#rail-more-body')).toBe(body());
  });

  it('collapses again on a second press', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('rail.more'));
    await user.click(screen.getByTestId('rail.more'));
    expect(screen.getByTestId('rail.more').getAttribute('aria-expanded')).toBe('false');
    expect(body()?.getAttribute('data-open')).toBeNull();
  });

  it('holds the three station preferences and keeps the workspace row outside', async () => {
    const user = userEvent.setup();
    renderMenu();
    // Switch workspace is a destination, not a preference: it is reachable
    // without opening the group at all.
    const workspace = screen.getByTestId('rail.more.workspace');
    expect(workspace.closest('#rail-more-body')).toBeNull();
    await user.click(screen.getByTestId('rail.more'));
    expect(screen.getByTestId('rail.more.assistant')).toBeTruthy();
    expect(screen.getByTestId('rail.more.language')).toBeTruthy();
    expect(screen.getByTestId('rail.more.mode')).toBeTruthy();
  });

  // A cashier has one workspace and no assistant: the group must not collapse
  // to an empty body, it still holds the two station preferences.
  it('holds only language and appearance when neither is permitted', async () => {
    const user = userEvent.setup();
    drawer.allowed = false;
    renderMenu({ canSwitch: false });
    expect(screen.queryByTestId('rail.more.workspace')).toBeNull();
    await user.click(screen.getByTestId('rail.more'));
    expect(screen.queryByTestId('rail.more.assistant')).toBeNull();
    expect(screen.getByTestId('rail.more.language')).toBeTruthy();
    expect(screen.getByTestId('rail.more.mode')).toBeTruthy();
  });

  // The rail holds the same rows on every screen. Dropping this one on the
  // picker meant the rail looked different on exactly one screen, and the row
  // an owner reaches for had moved up.
  it('keeps the workspace row on the picker and lights it instead of hiding it', async () => {
    const user = userEvent.setup();
    const { onSwitchWorkspace } = renderMenu({ onWorkspacePicker: true });

    const row = screen.getByTestId('rail.more.workspace');
    // Still there, and lit the way every other rail row on its own screen is.
    expect(row.getAttribute('data-active')).toBe('true');
    // "You are here", not a toggle left switched on.
    expect(row.getAttribute('aria-current')).toBe('page');
    expect(row.getAttribute('aria-pressed')).toBeNull();

    // Pressing it goes nowhere: we are already there.
    await user.click(row);
    expect(onSwitchWorkspace).not.toHaveBeenCalled();
  });

  it('leaves the workspace row unlit anywhere else', () => {
    renderMenu();
    const row = screen.getByTestId('rail.more.workspace');
    expect(row.getAttribute('data-active')).toBeNull();
    expect(row.getAttribute('aria-current')).toBeNull();
  });

  it('runs the workspace switch', async () => {
    const user = userEvent.setup();
    const { onSwitchWorkspace } = renderMenu();
    await user.click(screen.getByTestId('rail.more.workspace'));
    expect(onSwitchWorkspace).toHaveBeenCalledOnce();
  });

  // The group stays open across a toggle, so the row renames under the finger
  // and a second appearance change is one press away.
  it('toggles the appearance and stays open', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('rail.more'));
    expect(screen.getByTestId('rail.more.mode').textContent).toContain('Blue mode');
    await user.click(screen.getByTestId('rail.more.mode'));
    expect(body()?.getAttribute('data-open')).toBe('true');
    // The label names where the NEXT press goes, so it has flipped.
    expect(screen.getByTestId('rail.more.mode').textContent).toContain('Light mode');
  });

  // The whole point of ThemeModeIcon: a swap by name would unmount one <svg>
  // and mount the other, and a transition cannot run across that. Both layers
  // stay mounted and only opacity/transform change, so the SAME two nodes must
  // still be there after the flip, with the shown/hidden roles exchanged.
  it('cross-fades the sun and the moon instead of swapping them', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('rail.more'));

    const glyphs = () => Array.from(screen.getByTestId('rail.more.mode').querySelectorAll('svg'));
    const before = glyphs();
    // Two layers in [sun, moon] order, one visible. The glyph names the
    // DESTINATION, like the label: in light mode that is the moon.
    expect(before).toHaveLength(2);
    expect(before.map((g) => g.style.opacity)).toEqual(['0', '1']);

    await user.click(screen.getByTestId('rail.more.mode'));

    const after = glyphs();
    // Same nodes, not replacements — this is what makes the transition possible.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    // ...and they have traded places: in blue mode the sun is the way back.
    expect(after.map((g) => g.style.opacity)).toEqual(['1', '0']);
    // The outgoing layer is parked off-angle, which is what it animates out of.
    expect(after[1]!.style.transform).toContain('rotate(90deg)');
    expect(after[0]!.style.transform).toBe('rotate(0deg) scale(1)');
  });

  it('opens the assistant drawer', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('rail.more'));
    await user.click(screen.getByTestId('rail.more.assistant'));
    expect(drawer.toggleDrawer).toHaveBeenCalledOnce();
  });
});
