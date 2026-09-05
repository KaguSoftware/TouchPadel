import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import { confirmTill, discoverTill, probeTcp } from './lan-discover';
import { hostsIn24, isPrivateIpv4, localSubnets } from './lan-net';
import { startLanKdsServer, type LanKdsServer } from './lan-kds-server';

// The kitchen screen's half of first-run pairing: given only the code, find the
// till on the LAN and prove the code opens it. Loopback stands in for the LAN.

const CODE = 'ABCDEFGHJK';
// Test-only ports, kept clear of lan-kds.test.ts (47899) which runs in parallel;
// the real one is 47810.
const PORT = 47880;
const CLOSED_PORT = 47881;
const DUMMY_PORT = 47882;

let server: LanKdsServer | null = null;

beforeEach(() => {
  server = startLanKdsServer(
    { stationId: 'TILL1', mode: 'till', lanPsk: CODE, lanBind: '127.0.0.1', configured: true, appVersion: 't' },
    { port: PORT },
  );
  expect(server).not.toBeNull();
});

afterEach(() => {
  server?.close();
  server = null;
});

describe('lan-net helpers', () => {
  it('isPrivateIpv4 accepts RFC1918 and nothing else', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('192.168.4.7')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.254')).toBe(true);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('127.0.0.1')).toBe(false);
    expect(isPrivateIpv4('169.254.1.1')).toBe(false);
    expect(isPrivateIpv4('192.168.1')).toBe(false);
    expect(isPrivateIpv4('192.168.1.256')).toBe(false);
    expect(isPrivateIpv4('not an ip')).toBe(false);
  });

  it('localSubnets keeps one entry per private /24, skipping loopback, link-local and public', () => {
    const iface = (address: string, internal = false) => ({
      address,
      netmask: '255.255.255.0',
      family: 'IPv4' as const,
      mac: '00:00:00:00:00:00',
      internal,
      cidr: `${address}/24`,
    });
    const subnets = localSubnets({
      lo: [iface('127.0.0.1', true)],
      eth0: [iface('192.168.4.7'), { ...iface('192.168.4.7'), family: 'IPv6' as const, address: 'fe80::1' }],
      wifi: [iface('169.254.10.2')],
      vpn: [iface('203.0.113.9')],
      docker: [iface('172.17.0.1')],
      eth1: [iface('192.168.4.200')],
    });
    expect(subnets).toEqual([
      { self: '192.168.4.7', base: '192.168.4.0' },
      { self: '172.17.0.1', base: '172.17.0.0' },
    ]);
  });

  it('hostsIn24 lists .1 to .254 without the machine itself', () => {
    const hosts = hostsIn24('10.0.0.0', '10.0.0.5');
    expect(hosts).toHaveLength(253);
    expect(hosts[0]).toBe('10.0.0.1');
    expect(hosts.at(-1)).toBe('10.0.0.254');
    expect(hosts).not.toContain('10.0.0.5');
    expect(hostsIn24('192.168.1.0')).toHaveLength(254);
  });
});

describe('probeTcp / confirmTill', () => {
  it('sees the open port and a closed one', async () => {
    expect(await probeTcp('127.0.0.1', PORT, 300)).toBe(true);
    expect(await probeTcp('127.0.0.1', CLOSED_PORT, 300)).toBe(false);
  });

  it('resolves false at once when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await probeTcp('127.0.0.1', PORT, 300, ac.signal)).toBe(false);
  });

  it('distinguishes the right code, the wrong code and nobody home', async () => {
    expect(await confirmTill('127.0.0.1', PORT, CODE, 1000)).toBe('ok');
    expect(await confirmTill('127.0.0.1', PORT, 'WRONGCODE0', 1000)).toBe('bad-code');
    expect(await confirmTill('127.0.0.1', CLOSED_PORT, CODE, 1000)).toBe('unreachable');
  });

  it('a plain TCP listener that never speaks WebSocket is unreachable, not a till', async () => {
    const dummy = net.createServer(() => {}).listen(DUMMY_PORT, '127.0.0.1');
    await new Promise((r) => dummy.once('listening', r));
    try {
      expect(await confirmTill('127.0.0.1', DUMMY_PORT, CODE, 500)).toBe('unreachable');
    } finally {
      dummy.close();
    }
  });
});

describe('discoverTill', () => {
  it('finds the till behind the code', async () => {
    const r = await discoverTill(CODE, { port: PORT, hosts: ['127.0.0.1'] });
    expect(r).toEqual({ status: 'found', tills: ['127.0.0.1'] });
  });

  it('reports a wrong code as bad-code, naming the host that refused it', async () => {
    const r = await discoverTill('WRONGCODE0', { port: PORT, hosts: ['127.0.0.1'] });
    expect(r).toEqual({ status: 'bad-code', candidates: ['127.0.0.1'] });
  });

  it('reports none when no host has the port open', async () => {
    const r = await discoverTill(CODE, { port: CLOSED_PORT, hosts: ['127.0.0.1'] });
    expect(r).toEqual({ status: 'none' });
  });

  it('reports no-lan for an empty host list', async () => {
    expect(await discoverTill(CODE, { port: PORT, hosts: [] })).toEqual({ status: 'no-lan' });
  });

  it('stops early when aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await discoverTill(CODE, { port: PORT, hosts: ['127.0.0.1'], signal: ac.signal });
    expect(r).toEqual({ status: 'none' });
  });

  it('sweeps many hosts with the pool and still finds the one till', async () => {
    // Unroutable TEST-NET addresses time out rather than refuse — the sweep
    // must not serialise on them.
    const hosts = Array.from({ length: 40 }, (_, i) => `192.0.2.${i + 1}`).concat('127.0.0.1');
    const started = Date.now();
    const r = await discoverTill(CODE, { port: PORT, hosts, connectTimeoutMs: 200 });
    expect(r).toEqual({ status: 'found', tills: ['127.0.0.1'] });
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 10_000);
});
