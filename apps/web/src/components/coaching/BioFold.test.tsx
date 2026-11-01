import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { BioFold } from './BioFold';

describe('BioFold', () => {
  it('renders the bio closed, with the text in the page', () => {
    const { container } = render(
      <BioFold label="Bio">
        <p>Ten years on court</p>
      </BioFold>,
    );
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Ten years on court');
  });

  it('opens with a slide and shuts again after it', async () => {
    const { container } = render(
      <BioFold label="Bio">
        <p>Ten years on court</p>
      </BioFold>,
    );
    const details = container.querySelector('details')!;
    const row = container.querySelector('summary')!;
    fireEvent.click(row);
    expect(details.open).toBe(true);
    await waitFor(() => expect(details.dataset.shown).toBe('true'));

    fireEvent.click(row);
    expect(details.dataset.shown).toBe('false');
    // The slide ends on the body's grid-row transition; only then does `open` drop.
    // jsdom has no TransitionEvent, so the event carries the property name by hand.
    fireEvent(
      container.querySelector('.tp-clink__fold-body')!,
      Object.assign(new Event('transitionend', { bubbles: true }), {
        propertyName: 'grid-template-rows',
      }),
    );
    expect(details.open).toBe(false);
  });
});
