/**
 * The count is the whole risk here: a claim that outlives its overlay leaves
 * the window undraggable for the rest of the shift, and a double release lets
 * the strip back while an overlay is still up — which is the original bug.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScreenOwnerClaim, ScreenOwnerProvider, useOwnsScreen, useScreenOwned } from './screenOwner';

function Strip() {
  return <span data-testid="strip">{useScreenOwned() ? 'stood-down' : 'painted'}</span>;
}

function Overlay() {
  useOwnsScreen();
  return null;
}

const strip = () => screen.getByTestId('strip').textContent;

describe('screen owner', () => {
  it('paints the strip when nothing owns the screen', () => {
    render(
      <ScreenOwnerProvider>
        <Strip />
      </ScreenOwnerProvider>,
    );
    expect(strip()).toBe('painted');
  });

  it('stands the strip down while an overlay is mounted, and restores it after', () => {
    const view = render(
      <ScreenOwnerProvider>
        <Strip />
        <Overlay />
      </ScreenOwnerProvider>,
    );
    expect(strip()).toBe('stood-down');

    view.rerender(
      <ScreenOwnerProvider>
        <Strip />
      </ScreenOwnerProvider>,
    );
    expect(strip()).toBe('painted');
  });

  it('keeps the strip down until the LAST of several overlays closes', () => {
    const view = render(
      <ScreenOwnerProvider>
        <Strip />
        <Overlay />
        <ScreenOwnerClaim />
      </ScreenOwnerProvider>,
    );
    expect(strip()).toBe('stood-down');

    // A Modal opened from inside the drawer closes; the drawer is still up.
    view.rerender(
      <ScreenOwnerProvider>
        <Strip />
        <Overlay />
      </ScreenOwnerProvider>,
    );
    expect(strip()).toBe('stood-down');

    view.rerender(
      <ScreenOwnerProvider>
        <Strip />
      </ScreenOwnerProvider>,
    );
    expect(strip()).toBe('painted');
  });

  it('does not throw outside a provider — the pre-auth screens have no strip', () => {
    expect(() => render(<Overlay />)).not.toThrow();
    render(<Strip />);
    expect(strip()).toBe('painted');
  });
});
