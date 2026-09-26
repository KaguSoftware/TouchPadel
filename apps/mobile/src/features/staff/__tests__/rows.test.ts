import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import { STAFF_ROW_DEFS, staffRows } from '../rows';

/**
 * Today's rows (build-contracts-2026-09-23 §6.1). A row's push is not a
 * literal, so routes.test.ts cannot see it: this is its "every push points at
 * a route that exists" check.
 */
const APP = join(__dirname, '..', '..', '..', '..', 'app');

describe('Today rows', () => {
  it('open a screen that exists under app/', () => {
    for (const row of STAFF_ROW_DEFS) {
      expect(existsSync(join(APP, `${row.href.slice(1)}.tsx`)), row.href).toBe(true);
    }
  });

  it('have distinct names and ids under the staff route', () => {
    expect(new Set(STAFF_ROW_DEFS.map((r) => r.id)).size).toBe(STAFF_ROW_DEFS.length);
    expect(new Set(STAFF_ROW_DEFS.map((r) => r.testID)).size).toBe(STAFF_ROW_DEFS.length);
    for (const row of STAFF_ROW_DEFS) {
      expect(row.testID === 'staff.requests' || row.testID === `staff.row.${row.id}`, row.testID).toBe(true);
    }
  });

  it('give every role the requests row, the smoke primary of Today', () => {
    for (const role of STAFF_ROLES) {
      expect(staffRows(role).map((r) => r.testID), role).toContain('staff.requests');
    }
  });
});
