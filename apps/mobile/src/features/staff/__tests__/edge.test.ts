import { describe, expect, it } from 'vitest';
import { StaffEdgeError, edgeErrorCode, mapStaffError } from '../edge';

/**
 * Edge refusals on the staff phone (build-contracts-2026-09-23 §3): the body's
 * `error` read through rpcErrorCode, onto the same string as the RPC refusal.
 */
describe('edgeErrorCode', () => {
  it('reads the body’s error, and nothing else', () => {
    expect(edgeErrorCode({ error: 'RELEASE_NOT_READY', message: 'names' })).toBe('RELEASE_NOT_READY');
    expect(edgeErrorCode({ error: ' EMAIL_IN_USE ' })).toBe('EMAIL_IN_USE');
    expect(edgeErrorCode({ message: 'no code' })).toBeNull();
    expect(edgeErrorCode({ error: 42 })).toBeNull();
    expect(edgeErrorCode('text')).toBeNull();
    expect(edgeErrorCode(null)).toBeNull();
  });
});

describe('mapStaffError', () => {
  it('maps an edge refusal by its code, as the RPC refusal it came from', () => {
    expect(mapStaffError(new StaffEdgeError('RELEASE_NOT_READY', 409))).toBe('op.errors.RELEASE_NOT_READY');
    expect(mapStaffError(new StaffEdgeError('EMAIL_IN_USE', 409))).toBe('op.errors.EMAIL_IN_USE');
    expect(mapStaffError(new StaffEdgeError('FORBIDDEN', 403))).toBe('errors.forbidden');
  });

  it('reads BAD_REQUEST as a form problem, and an unknown code as generic, never as offline', () => {
    expect(mapStaffError(new StaffEdgeError('BAD_REQUEST', 400))).toBe('errors.validation');
    expect(mapStaffError(new StaffEdgeError('SOMETHING_NEW', 500))).toBe('errors.generic');
    expect(mapStaffError(new StaffEdgeError(null, 502))).toBe('errors.generic');
  });

  it('maps everything else through the app’s one mapper', () => {
    expect(mapStaffError({ message: 'STEP_NOT_OPEN', code: 'P0001' })).toBe('op.errors.STEP_NOT_OPEN');
    expect(mapStaffError(new TypeError('Network request failed'))).toBe('errors.network');
  });

  it('keeps the code as the error message, for telemetry and the retry policy', () => {
    expect(new StaffEdgeError('NOT_STEP_ACTOR', 403).message).toBe('NOT_STEP_ACTOR');
  });
});
