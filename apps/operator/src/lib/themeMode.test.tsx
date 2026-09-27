// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, themeCss } from '@touch/ui';
import { THEME_MODE_STORAGE_KEY, ThemeModeProvider, useThemeMode } from './themeMode';

function Probe() {
  const { mode, toggleMode } = useThemeMode();
  return (
    <>
      <output data-testid="mode">{mode}</output>
      <button type="button" onClick={toggleMode}>
        toggle
      </button>
    </>
  );
}

/** What main.tsx wires: the mode context feeding ThemeProvider. */
function Themed() {
  const { mode } = useThemeMode();
  return (
    <ThemeProvider theme="operator" dir="ltr" mode={mode}>
      <Probe />
    </ThemeProvider>
  );
}

describe('theme mode', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-mode');
  });

  it('defaults to light and reads no attribute without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });

  it('boots into the persisted appearance', () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'blue');
    render(
      <ThemeModeProvider>
        <Probe />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('blue');
  });

  it('treats an unknown stored value as light', () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'dark');
    render(
      <ThemeModeProvider>
        <Probe />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });

  it('toggling persists and writes data-mode on <html>, and back', async () => {
    const user = userEvent.setup();
    render(
      <ThemeModeProvider>
        <Themed />
      </ThemeModeProvider>,
    );
    expect(document.documentElement.getAttribute('data-mode')).toBeNull();

    await act(() => user.click(screen.getByRole('button', { name: 'toggle' })));
    expect(screen.getByTestId('mode').textContent).toBe('blue');
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('blue');
    expect(document.documentElement.getAttribute('data-mode')).toBe('blue');

    await act(() => user.click(screen.getByRole('button', { name: 'toggle' })));
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('light');
    // Light writes NO attribute, so the padel and cafe documents stay untouched.
    expect(document.documentElement.getAttribute('data-mode')).toBeNull();
  });

  it('the token sheet carries a blue block that out-specifies the operator block', () => {
    const operatorAt = themeCss.indexOf(":root[data-theme='operator'],");
    const blueAt = themeCss.indexOf(":root[data-theme='operator'][data-mode='blue'],");
    expect(operatorAt).toBeGreaterThan(-1);
    expect(blueAt).toBeGreaterThan(operatorAt);
    const block = themeCss.slice(blueAt, themeCss.indexOf('}', blueAt));
    // The ground is THE brand blue, unmodified; the ink is white; and the
    // scheme flips so native controls follow.
    expect(block).toContain('--tp-bg: var(--tp-brand-blue);');
    expect(block).toContain('--tp-fg: var(--tp-brand-white);');
    expect(block).toContain('color-scheme: dark;');
    // No layout token may leak into the colour block.
    expect(block).not.toMatch(/--tp-(sp|fs|rail-w|row-h|touch|z)-/);
  });
});
