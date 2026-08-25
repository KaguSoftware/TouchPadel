import { describe, expect, it } from 'vitest';
import { scrollSpyPick, type SectionOffset } from './scrollSpy';

const SECTIONS: SectionOffset[] = [
  { id: 'coffee', top: 0, bottom: 400 },
  { id: 'pastry', top: 400, bottom: 900 },
  { id: 'cold', top: 900, bottom: 1_000 },
];

describe('scrollSpyPick', () => {
  it('returns null with no sections', () => {
    expect(scrollSpyPick([], { scrollTop: 0 })).toBeNull();
  });

  it('activates the section under the activation line', () => {
    expect(scrollSpyPick(SECTIONS, { scrollTop: 0 })).toBe('coffee');
    expect(scrollSpyPick(SECTIONS, { scrollTop: 399 })).toBe('coffee');
    expect(scrollSpyPick(SECTIONS, { scrollTop: 400 })).toBe('pastry');
    expect(scrollSpyPick(SECTIONS, { scrollTop: 899 })).toBe('pastry');
    expect(scrollSpyPick(SECTIONS, { scrollTop: 900 })).toBe('cold');
  });

  it('honours the sticky-pill offset', () => {
    expect(scrollSpyPick(SECTIONS, { scrollTop: 340, offset: 0 })).toBe('coffee');
    expect(scrollSpyPick(SECTIONS, { scrollTop: 340, offset: 60 })).toBe('pastry');
  });

  it('keeps the first section active above the content', () => {
    expect(scrollSpyPick(SECTIONS, { scrollTop: -50 })).toBe('coffee');
  });

  it('gives a short trailing section the win at the bottom', () => {
    expect(scrollSpyPick(SECTIONS, { scrollTop: 500, atBottom: true })).toBe('cold');
  });
});
