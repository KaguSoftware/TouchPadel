import * as os from 'node:os';

/**
 * Pure LAN address helpers shared by the till's server bind (lan-kds-server),
 * the kitchen screen's till discovery (lan-discover) and the IPC validators.
 * No sockets here — this file is what the tests hand fake interface maps to.
 */

export const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** RFC1918 — PSK + non-routable bind is the LAN threat model (design-arch §2.4). */
export function isPrivateIpv4(addr: string): boolean {
  if (!ipv4Regex.test(addr)) return false;
  return /^10\./.test(addr) || /^192\.168\./.test(addr) || /^172\.(1[6-9]|2\d|3[01])\./.test(addr);
}

export interface LocalSubnet {
  /** This machine's own address on the interface. */
  self: string;
  /** The /24 network address, e.g. '192.168.4.0'. */
  base: string;
}

/**
 * Every private IPv4 this machine holds, with its /24. Loopback, link-local
 * and public addresses are skipped. A venue LAN is a /24 in practice; a wider
 * mask would only add hosts that a 254-address sweep cannot reach anyway.
 */
export function localSubnets(
  ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LocalSubnet[] {
  const out: LocalSubnet[] = [];
  const seen = new Set<string>();
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (!isPrivateIpv4(addr.address)) continue;
      const base = addr.address.replace(/\.\d+$/, '.0');
      if (seen.has(base)) continue;
      seen.add(base);
      out.push({ self: addr.address, base });
    }
  }
  return out;
}

/** 'a.b.c.1' … 'a.b.c.254' for a /24 base, minus this machine's own address. */
export function hostsIn24(base: string, self?: string): string[] {
  const prefix = base.replace(/\.\d+$/, '');
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const host = `${prefix}.${i}`;
    if (host !== self) hosts.push(host);
  }
  return hosts;
}
