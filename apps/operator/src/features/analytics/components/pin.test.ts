import { describe, expect, it } from 'vitest';
import { PINNED_SCHEMA, pinKeyFor, pinnedQuestion, toolEntries } from './pin';

describe('pin helpers', () => {
  it('derives a stable key the RPC accepts from the question', () => {
    const k = pinKeyFor('How many bookings came from the app last week?');
    expect(k).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
    expect(k.startsWith('pin_how_many_bookings_came_from_')).toBe(true);
    expect(pinKeyFor('How many bookings came from the app last week?')).toBe(k);
    expect(pinKeyFor('How many bookings came from the desk last week?')).not.toBe(k);
    expect(pinKeyFor('؟؟؟').length).toBeLessThanOrEqual(64);
    expect(pinKeyFor('x'.repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it('turns the sources into tool entries, dropping the arguments the page supplies', () => {
    const entries = toolEntries([
      { name: 'analytics_courts_guests', args: { from: '2026-09-01', to: '2026-09-07', court: null } },
      { name: 'stock_view', args: { view: 'expiring_soon', limit: 20, from: '2026-09-01' } },
      'panel_headline',
      'panel_headline',
      { name: 'Not A Tool', args: {} },
    ]);
    expect(entries).toEqual(['analytics_courts_guests', 'stock_view {"view":"expiring_soon","limit":20}', 'panel_headline']);
  });

  it('writes the figure labels into the stored question', () => {
    const q = pinnedQuestion('How did the app do?', [{ label: 'App bookings', value: 12 }, { label: 'Desk bookings', value: '30' }, { label: 'App bookings', value: 12 }]);
    expect(q.startsWith('How did the app do?')).toBe(true);
    expect(q).toContain('App bookings; Desk bookings');
  });

  it('the pinned schema is strict: every property required, no extras', () => {
    expect(PINNED_SCHEMA.required).toEqual(['figures', 'paragraph']);
    expect(PINNED_SCHEMA.additionalProperties).toBe(false);
    expect(PINNED_SCHEMA.properties.figures.items.required).toEqual(['label', 'value', 'route']);
  });
});
