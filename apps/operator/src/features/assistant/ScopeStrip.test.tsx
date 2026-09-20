import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ASSISTANT_PRESETS, ASSISTANT_SCOPES } from '@touch/core/assistant/tools';
import { LocaleProvider } from '../../lib/i18n';
import { ScopeStrip } from './ScopeStrip';

function renderStrip(props: Partial<Parameters<typeof ScopeStrip>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <ScopeStrip scopes={['howto']} onChange={onChange} packs={{ cafe: 1_234, money: 2_000, howto: 0 }} {...props} />
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

  it('prints each pack size and totals the checked ones', () => {
    renderStrip({ scopes: ['cafe', 'money', 'howto'] });
    expect(document.querySelector('[data-scope="cafe"]')!.textContent).toContain('≈ 1.2k tokens');
    expect(document.querySelector('[data-scope="money"]')!.textContent).toContain('≈ 2k tokens');
    expect(document.querySelector('[data-scope="howto"]')!.textContent).toContain('no pack');
    expect(document.querySelector('[data-scope-total]')!.textContent).toContain('3.2k');
  });

  it('says it is measuring while sizes are unknown', () => {
    renderStrip({ scopes: ['stock'], packs: {}, measuring: true });
    expect(document.querySelector('[data-scope="stock"]')!.textContent).toContain('Measuring');
    expect(document.querySelector('[data-scope-total]')!.textContent).toContain('Measuring');
  });
});
