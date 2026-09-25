import { describe, expect, it } from 'vitest';
import { AppRpcError } from '../../lib/appRpc';
import { EdgeError } from '../../lib/edge';
import { protocolErrorKey, refusalCode, refusalHint } from './errors';

describe('protocol refusals', () => {
  it('says an RPC’s code the way every screen does', () => {
    expect(protocolErrorKey(new AppRpcError('CANNOT_DECIDE_OWN', 'CANNOT_DECIDE_OWN'))).toBe('op.errors.CANNOT_DECIDE_OWN');
    expect(protocolErrorKey(new AppRpcError('SOMETHING_NEW', 'SOMETHING_NEW'))).toBe('errors.generic');
  });

  it('says the engine’s own code when the launch function passes it back (§3 "Edge failures")', () => {
    expect(protocolErrorKey(new EdgeError(400, 'UNKNOWN', 'RELEASE_NOT_READY', 'RELEASE_NOT_READY'))).toBe('op.errors.RELEASE_NOT_READY');
    expect(protocolErrorKey(new EdgeError(403, 'FORBIDDEN', 'no', 'FORBIDDEN'))).toBe('op.errors.FORBIDDEN');
    // A body code the catalog does not have is the edge failure it is.
    expect(protocolErrorKey(new EdgeError(502, 'UPSTREAM', 'photo copy failed', 'UPSTREAM'))).toBe('op.errors.EDGE_UPSTREAM');
    expect(protocolErrorKey(new EdgeError(500, 'UPSTREAM', 'x'))).toBe('op.errors.EDGE_UPSTREAM');
  });

  it('keeps the code and the field a record refusal names', () => {
    const e = new AppRpcError('RECORD_INVALID', 'RECORD_INVALID', 'category_id');
    expect(refusalCode(e)).toBe('RECORD_INVALID');
    expect(refusalHint(e)).toBe('category_id');
    expect(refusalCode(new EdgeError(400, 'UNKNOWN', 'x', 'RECORD_INVALID'))).toBe('RECORD_INVALID');
    expect(refusalCode(new Error('x'))).toBeNull();
  });
});
