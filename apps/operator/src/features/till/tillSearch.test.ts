import { describe, expect, it } from 'vitest';
import { validateTillSearch } from './tillSearch';

const ID = '3f2b7c1e-8d4a-4b9c-9e1f-0a1b2c3d4e5f';

describe('validateTillSearch', () => {
  it('drops everything that is not a uuid', () => {
    expect(validateTillSearch({})).toEqual({});
    expect(validateTillSearch({ tab: 'T8' })).toEqual({});
    expect(validateTillSearch({ tab: 42, reservation: null })).toEqual({});
    expect(validateTillSearch({ tab: 'local:abc' })).toEqual({});
  });

  it('keeps valid ids, lower-cased', () => {
    expect(validateTillSearch({ tab: ID.toUpperCase() })).toEqual({ tab: ID });
    expect(validateTillSearch({ reservation: ID })).toEqual({ reservation: ID });
    expect(validateTillSearch({ tab: ID, reservation: ID, junk: 'x' })).toEqual({ tab: ID, reservation: ID });
  });
});
