import * as net from 'node:net';
import WebSocket from 'ws';
import type { DiscoverResult } from '../ipc-channels';
import { LAN_KDS_PORT } from './lan-kds-server';
import { hostsIn24, localSubnets } from './lan-net';

/**
 * Till discovery for an unconfigured kitchen screen (first-run setup).
 *
 * Staff type the pairing code the till shows; nobody types an IP. The sweep
 * is outbound TCP from the KDS to every host on its own /24 at port 47810,
 * then a real WebSocket handshake with the code as bearer against each host
 * that answered. Outbound-only on purpose: the till already needs one inbound
 * firewall allowance for its server, the kitchen screen should need none.
 *
 * ~1.2 s for a full /24 at 64 × 300 ms; typically far less because most hosts
 * refuse immediately. Legitimate outcomes: one till (the normal case), several
 * tills sharing the venue code (the setup screen asks which), no host with the
 * port open, or a host that answered but rejected the code (4401 → the code is
 * wrong, not the network).
 */

export const SCAN_CONCURRENCY = 64;
export const SCAN_CONNECT_TIMEOUT_MS = 300;
export const SCAN_HANDSHAKE_TIMEOUT_MS = 1_500;
/** Sweeping more than this many /24s means the machine is not on a venue LAN. */
export const SCAN_MAX_SUBNETS = 4;

export function probeTcp(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(open);
    };
    const onAbort = () => done(false);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export type ConfirmOutcome = 'ok' | 'bad-code' | 'unreachable';

/**
 * A real handshake. The server accepts the upgrade before it checks the
 * bearer, so `open` fires for a wrong code too; the verdict is the FIRST
 * FRAME (the snapshot, sent right after auth) versus a close with 4401.
 */
export function confirmTill(host: string, port: number, code: string, timeoutMs: number): Promise<ConfirmOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(`ws://${host}:${port}`, {
      headers: { authorization: `Bearer ${code}` },
      handshakeTimeout: timeoutMs,
    });
    const done = (outcome: ConfirmOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.close();
      resolve(outcome);
    };
    const timer = setTimeout(() => done('unreachable'), timeoutMs);
    ws.once('message', () => done('ok'));
    ws.once('close', (closeCode) => done(closeCode === 4401 ? 'bad-code' : 'unreachable'));
    ws.once('error', () => done('unreachable'));
  });
}

export interface DiscoverOpts {
  port?: number;
  /** Test seam / Advanced path: the hosts to try instead of the local /24s. */
  hosts?: string[];
  concurrency?: number;
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  signal?: AbortSignal;
}

export async function discoverTill(code: string, opts: DiscoverOpts = {}): Promise<DiscoverResult> {
  const port = opts.port ?? LAN_KDS_PORT;
  const concurrency = opts.concurrency ?? SCAN_CONCURRENCY;
  const connectTimeoutMs = opts.connectTimeoutMs ?? SCAN_CONNECT_TIMEOUT_MS;
  const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? SCAN_HANDSHAKE_TIMEOUT_MS;
  const signal = opts.signal;

  let hosts = opts.hosts;
  if (!hosts) {
    const subnets = localSubnets().slice(0, SCAN_MAX_SUBNETS);
    hosts = subnets.flatMap((s) => hostsIn24(s.base, s.self));
  }
  if (hosts.length === 0) return { status: 'no-lan' };

  // Fixed-size worker pool over the host list; each worker pulls the next index.
  const open: string[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < hosts.length) {
      if (signal?.aborted) return;
      const host = hosts[next++]!;
      if (await probeTcp(host, port, connectTimeoutMs, signal)) open.push(host);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  if (signal?.aborted) return { status: 'none' };

  const tills: string[] = [];
  const rejected: string[] = [];
  for (const host of open) {
    if (signal?.aborted) return { status: 'none' };
    const outcome = await confirmTill(host, port, code, handshakeTimeoutMs);
    if (outcome === 'ok') tills.push(host);
    else if (outcome === 'bad-code') rejected.push(host);
  }
  if (tills.length > 0) return { status: 'found', tills };
  if (rejected.length > 0) return { status: 'bad-code', candidates: rejected };
  return { status: 'none' };
}
