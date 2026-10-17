import { describe, expect, it } from 'vitest';
import { openingChoice, parseChoices } from '../rememberedLogic';

const STORES = ['cafe', 'bakery', 'shop'] as const;

describe('openingChoice', () => {
  it('opens on the default with nothing remembered', () => {
    expect(openingChoice(STORES, 'cafe', undefined)).toBe('cafe');
  });
  it('opens on what was picked last time', () => {
    expect(openingChoice(STORES, 'cafe', 'bakery')).toBe('bakery');
  });
  it('lets a link win over the remembered choice', () => {
    expect(openingChoice(STORES, 'cafe', 'bakery', 'shop')).toBe('shop');
  });
  it('ignores a remembered or linked value the page no longer offers', () => {
    expect(openingChoice(STORES, 'cafe', 'kitchen')).toBe('cafe');
    expect(openingChoice(STORES, 'cafe', 'bakery', 'nowhere')).toBe('bakery');
  });
});

describe('parseChoices', () => {
  it('reads a string map and drops anything else', () => {
    expect(parseChoices('{"stock.store":"bakery","n":3}')).toEqual({ 'stock.store': 'bakery' });
  });
  it('turns nothing, junk or a non-map into an empty map', () => {
    expect(parseChoices(null)).toEqual({});
    expect(parseChoices('not json')).toEqual({});
    expect(parseChoices('["a"]')).toEqual({});
  });
});
