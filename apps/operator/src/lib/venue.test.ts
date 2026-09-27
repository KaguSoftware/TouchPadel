import { describe, it, expect, afterEach } from 'vitest';
import { branchTopic, pickBranch } from './venue';
import { scopeHeaders, setBranchScope, setReportAllBranches, setStationHeader } from './venueScope';

const A = 'c0000000-0000-4000-8000-000000000001';
const B = 'ee570000-0000-4000-8000-00000000be00';
const venues = [
  { id: A, status: 'open' as const },
  { id: B, status: 'preparing' as const },
];

describe('pickBranch', () => {
  it('a registered station is its branch', () => {
    expect(pickBranch({ stationBranchId: B, choice: A, mine: [A, B], venues })).toBe(B);
  });
  it('the remembered choice when the person may still use it', () => {
    expect(pickBranch({ stationBranchId: null, choice: B, mine: [A, B], venues })).toBe(B);
    expect(pickBranch({ stationBranchId: null, choice: B, mine: [A], venues })).toBe(A);
  });
  it('the only branch, else the first open one', () => {
    expect(pickBranch({ stationBranchId: null, choice: null, mine: [B], venues })).toBe(B);
    expect(pickBranch({ stationBranchId: null, choice: null, mine: [B, A], venues })).toBe(A);
    expect(pickBranch({ stationBranchId: null, choice: null, mine: [], venues })).toBeNull();
  });
  it('ignores a station at a branch the person does not work at', () => {
    expect(pickBranch({ stationBranchId: B, choice: null, mine: [A], venues })).toBe(A);
  });
});

describe('branchTopic', () => {
  it('per branch for kds, floor and courts; literal otherwise or while unknown', () => {
    expect(branchTopic('kds', A)).toBe(`kds:${A}`);
    expect(branchTopic('floor', A)).toBe(`floor:${A}`);
    expect(branchTopic('courts', A)).toBe(`courts:${A}`);
    expect(branchTopic('menu', A)).toBe('menu');
    expect(branchTopic('kds', null)).toBe('kds');
  });
});

describe('scopeHeaders', () => {
  afterEach(() => {
    setStationHeader(null);
    setBranchScope(null);
    setReportAllBranches(false);
  });
  it('names the station and the branch; "all" only on a report call while a report asks', () => {
    // venue.tsx names this machine's station at module load; start from none.
    setStationHeader(null);
    expect(scopeHeaders()).toEqual({});
    setStationHeader('TILL-1');
    setBranchScope(A);
    expect(scopeHeaders()).toEqual({ 'x-station-id': 'TILL-1', 'x-venue-scope': A });
    setReportAllBranches(true);
    const rpc = (fn: string) => `http://127.0.0.1:54321/rest/v1/rpc/${fn}`;
    // The report call carries every branch, on the page's own clock (0228)...
    expect(scopeHeaders(rpc('report_cafe'))['x-venue-scope']).toBe(`all:${A}`);
    expect(scopeHeaders(rpc('analytics_courts_summary'))['x-venue-scope']).toBe(`all:${A}`);
    // ...and nothing else does: badges, heartbeats and table reads stay on the rail's branch.
    expect(scopeHeaders(rpc('heartbeat'))['x-venue-scope']).toBe(A);
    expect(scopeHeaders('http://127.0.0.1:54321/rest/v1/courts?select=id')['x-venue-scope']).toBe(A);
  });
});
