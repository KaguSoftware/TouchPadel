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
    expect(screen.getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    expect(onChange).toHaveBeenLastCalledWith([...ASSISTANT_SCOPES]);

    fireEvent.click(screen.getByRole('button', { name: 'Money and floor' }));
    expect(onChange).toHaveBeenLastCalledWith([...ASSISTANT_PRESETS.moneyAndFloor].sort((a, b) => ASSISTANT_SCOPES.indexOf(a) - ASSISTANT_SCOPES.indexOf(b)));
  });

  it('toggles one checkbox and keeps catalog order', () => {
    const { onChange } = renderStrip();
    fireEvent.click(screen.getByRole('checkbox', { name: /^Cafe/ }));
    expect(onChange).toHaveBeenLastCalledWith(['cafe', 'howto']);

    fireEvent.click(screen.getByRole('checkbox', { name: /^Pages and how-to/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('shows one start figure with its price and no size per box', () => {
    renderStrip({ scopes: ['cafe', 'money', 'howto'] });
    for (const scope of ['cafe', 'money', 'howto']) expect(document.querySelector(`[data-scope="${scope}"]`)!.textContent).not.toMatch(/token/);
    const start = document.querySelector('[data-scope-start]')!.textContent!;
    expect(start).toContain('Every question starts at');
    expect(start).toMatch(/12\.3k\S? tokens/);
    // 12,345 input tokens at $5 / Mtok.
    expect(start).toContain('$0.06');
    expect(start).toContain('Earlier messages in this chat');
  });

  it('says "about" when the vendor could only estimate', () => {
    renderStrip({ start: { tokens: 2_000, exact: false, model: 'openai/gpt-oss-120b' } });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('starts at about');
  });

  it('says it is measuring while the start is unknown, and why when it cannot be measured', () => {
    renderStrip({ start: undefined, measuring: true });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('Measuring');
    cleanup();
    renderStrip({ start: null });
    expect(document.querySelector('[data-scope-start]')!.textContent).toContain('no AI key');
  });
});
