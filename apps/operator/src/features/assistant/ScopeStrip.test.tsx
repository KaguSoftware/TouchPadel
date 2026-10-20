import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ASSISTANT_PRESETS, ASSISTANT_SCOPES } from '@touch/core/assistant/tools';
import { LocaleProvider } from '../../lib/i18n';
import { ScopeStrip } from './ScopeStrip';

function renderStrip(props: Partial<Parameters<typeof ScopeStrip>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <ScopeStrip scopes={['howto']} onChange={onChange} start={{ tokens: 12_345, exact: true, model: 'claude-opus-5' }} pricing={{ 'claude-opus-5': { input: 5_000_000, cache_write: 6_250_000, cache_read: 500_000, output: 25_000_000 } }} {...props} />
    </LocaleProvider>,
  );
  return { onChange };
}

describe('ScopeStrip', () => {
  it('marks the matching preset as pressed and applies another on a tap', () => {
    const { onChange } = renderStrip();
    expect(screen.getByRole('button', { name: 'Just help' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Money and floor' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Money and floor' }));
    expect(onChange).toHaveBeenLastCalledWith([...ASSISTANT_PRESETS.moneyAndFloor].sort((a, b) => ASSISTANT_SCOPES.indexOf(a) - ASSISTANT_SCOPES.indexOf(b)));
  });

  // Owner call 2026-10-16: no one-tap "every scope"; the owner ticks what a chat needs.
  it('offers no Everything preset, only Money and floor and Just help', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: 'Everything' })).toBeNull();
    const presets = document.querySelectorAll('[data-scope-strip] [role="group"] button');
    expect(presets).toHaveLength(2);
  });

  it('toggles one scope button and keeps catalog order', () => {
    const { onChange } = renderStrip();
    const cafe = screen.getByTestId('scope-cafe');
    expect(cafe.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(cafe);
    expect(onChange).toHaveBeenLastCalledWith(['cafe', 'howto']);

    fireEvent.click(screen.getByTestId('scope-howto'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  // Owner call 2026-10-20: a chat that exists always reads something.
  it('keeps the last scope on when keepOne is set', () => {
    const { onChange } = renderStrip({ keepOne: true });
    const howto = screen.getByTestId('scope-howto') as HTMLButtonElement;
    expect(howto.getAttribute('aria-pressed')).toBe('true');
    expect(howto.disabled).toBe(true);
    fireEvent.click(howto);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks for a pick instead of a start figure when nothing is on', () => {
    renderStrip({ scopes: [] });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('Pick at least one to start asking.');
  });

  it('leads with one start figure and its price, and no size per chip', () => {
    renderStrip({ scopes: ['cafe', 'money', 'howto'] });
    for (const scope of ['cafe', 'money', 'howto']) expect(screen.getByTestId(`scope-${scope}`).textContent).not.toMatch(/token/);
    const start = document.querySelector('[data-scope-start]')!;
    expect(start.textContent).toContain('Each question starts at');
    expect(start.textContent).toMatch(/12\.3k\S? tokens/);
    // 12,345 input tokens at $5 / Mtok.
    expect(start.textContent).toContain('$0.06');
    expect(start.textContent).toContain('⁨3⁩ picked');
    // The long explanation is the line's tooltip, not more text under it.
    expect(start.querySelector('p')!.getAttribute('title')).toContain('Earlier messages in this chat');
  });

  it('marks an estimate with ≈', () => {
    renderStrip({ start: { tokens: 2_000, exact: false, model: 'openai/gpt-oss-120b' } });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('≈');
  });

  it('filters the chips by what is typed', () => {
    renderStrip();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find what to read' }), { target: { value: 'stock' } });
    expect(screen.getByTestId('scope-stock')).toBeTruthy();
    expect(screen.queryByTestId('scope-cafe')).toBeNull();
  });

  it('says it is measuring while the start is unknown, and why when it cannot be measured', () => {
    renderStrip({ start: undefined, measuring: true });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('Measuring');
    cleanup();
    renderStrip({ start: null });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('no AI key');
  });
});
