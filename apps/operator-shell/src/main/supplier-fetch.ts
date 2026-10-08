import * as dns from 'node:dns';
import type { IncomingHttpHeaders } from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import type { SupplierPageResult } from '../ipc-channels';

/**
 * The shop desk's supplier price check: GET one supplier product page and hand
 * its HTML to the renderer, which reads the price out of it
 * (apps/operator/src/features/shop/priceWatch). Only a station whose mode is
 * `shop` may call it — index.ts refuses everyone else.
 *
 * The URL is typed by shop staff, so this is a fetch of an arbitrary address
 * from a PC that sits on the venue LAN, next to the till, the printers and the
 * router. Everything below exists so it can only ever reach the public web:
 *
 *  - The URL is held to the server's rule (app.set_shop_price_watch): https,
 *    port 443, no userinfo, a dotted public-looking name, never an IP literal.
 *  - The name is resolved HERE and refused if ANY answer is not a global
 *    unicast address (RFC1918, loopback, link-local, CGNAT, multicast, the
 *    documentation and benchmarking blocks, ULA, IPv4-mapped private, NAT64…).
 *  - The connection is PINNED to the addresses that were vetted (a custom
 *    `lookup` on the request), so a second DNS answer — a rebinding attack —
 *    cannot swap in 192.168.1.1 between the check and the connect. TLS still
 *    verifies the certificate against the hostname (servername/Host).
 *  - Redirects are followed by hand, at most four, and every hop goes through
 *    the same URL rule and the same resolve-and-vet.
 *  - 15 s for the whole thing, 3 MB of decompressed body, one fetch at a time.
 *
 * node:https, not Electron's `net` (that goes through the session's webRequest
 * and Chromium's own resolver, so the address could not be pinned) and not the
 * global fetch (undici, same problem).
 */

/** Overall budget for one page, redirects included. */
export const SUPPLIER_FETCH_TIMEOUT_MS = 15_000;
/** After decompression — a product page is well under 1 MB; this is a bound on a bomb. */
export const SUPPLIER_FETCH_MAX_BYTES = 3 * 1024 * 1024;
export const SUPPLIER_FETCH_MAX_REDIRECTS = 4;
export const SUPPLIER_URL_MAX = 2000;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Names that only ever mean something on a private network. */
const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa'];

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** What the transport hands back: status, headers and the RAW (still encoded) body. */
export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Readable;
}

export interface PinnedRequest {
  url: URL;
  /**
   * Every address the name resolved to, all of them vetted: the socket may
   * connect to these and nothing else. All of them, not just the first, so
   * happy-eyeballs can still fall back to IPv4 on a venue line with no IPv6.
   */
  addresses: ResolvedAddress[];
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface SupplierFetchDeps {
  appVersion: string;
  /** Every address the name resolves to. Default: dns.lookup({ all: true }). */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** One GET, connected to one of `addresses`. Default: node:https with a pinned lookup. */
  request?: (req: PinnedRequest) => Promise<RawResponse>;
  timeoutMs?: number;
  maxBytes?: number;
}

// --- the URL rule (mirrors app.set_shop_price_watch) ---------------------------

/**
 * The supplier URL, parsed, or null when the rule refuses it. The same rule
 * the server applies when staff save the link; applied again here to every
 * redirect hop, which the server never sees.
 */
export function checkSupplierUrl(raw: string): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > SUPPLIER_URL_MAX) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // WHATWG drops the default port, so '' is 443 and anything else is not.
  if (url.port !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.href.length > SUPPLIER_URL_MAX) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // An IP literal in any spelling — WHATWG already turned 0x7f.1 or
  // 2130706433 into dotted form, and IPv6 arrives in brackets.
  if (net.isIP(host.replace(/^\[|\]$/g, '')) !== 0) return null;
  if (host === 'localhost') return null;
  if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return null;
  if (!host.includes('.')) return null;
  return url;
}

// --- address vetting -------------------------------------------------------------

function parseIpv4(s: string): number[] | null {
  if (!net.isIPv4(s)) return null;
  return s.split('.').map(Number);
}

/** Eight 16-bit groups, or null. Accepts '::', an embedded dotted IPv4 tail and a zone id. */
export function parseIpv6(input: string): number[] | null {
  let s = input.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  if (halves.length === 1) {
    if (groups.length !== 8) return null;
    return groups.map((g) => parseInt(g, 16));
  }
  if (groups.length > 7) return null;
  const zeros = new Array<number>(8 - groups.length).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...zeros, ...rest.map((g) => parseInt(g, 16))];
}

/** True for every IPv4 address that is not plain public unicast. */
function isBlockedIpv4(a: number[]): boolean {
  const [o1, o2, o3] = a as [number, number, number, number];
  return (
    o1 === 0 || // 0.0.0.0/8 "this network"
    o1 === 10 || // RFC1918
    (o1 === 100 && o2 >= 64 && o2 <= 127) || // 100.64/10 CGNAT
    o1 === 127 || // loopback
    (o1 === 169 && o2 === 254) || // link-local
    (o1 === 172 && o2 >= 16 && o2 <= 31) || // RFC1918
    (o1 === 192 && o2 === 0 && o3 === 0) || // 192.0.0/24 IETF protocol assignments
    (o1 === 192 && o2 === 0 && o3 === 2) || // TEST-NET-1
    (o1 === 192 && o2 === 88 && o3 === 99) || // 6to4 relay anycast
    (o1 === 192 && o2 === 168) || // RFC1918
    (o1 === 198 && (o2 === 18 || o2 === 19)) || // benchmarking
    (o1 === 198 && o2 === 51 && o3 === 100) || // TEST-NET-2
    (o1 === 203 && o2 === 0 && o3 === 113) || // TEST-NET-3
    o1 >= 224 // multicast 224/4, reserved 240/4, broadcast 255.255.255.255
  );
}

/**
 * True for every IPv6 address that is not public unicast. An allowlist: only
 * 2000::/3 (global unicast) gets through, minus the special blocks inside it,
 * plus an IPv4-mapped address whose IPv4 is itself public.
 */
function isBlockedIpv6(g: number[]): boolean {
  // ::ffff:a.b.c.d — the socket would really connect to a.b.c.d.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isBlockedIpv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  // Outside 2000::/3: ::, ::1, ::/96, 64:ff9b:: NAT64, 100::/64, fc00::/7,
  // fe80::/10, fec0::/10, ff00::/8 — none of it is a supplier's web server.
  if ((g[0]! & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1]! < 0x200) return true; // 2001::/23 IETF (Teredo, ORCHID, benchmarking)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return true; // 6to4 — embeds an IPv4 we would have to vet
  if (g[0] === 0x3fff && g[1]! < 0x1000) return true; // 3fff::/20 documentation
  return false;
}

/** Whether an address a supplier's name resolved to must be refused. Fails closed. */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isBlockedIpv4(v4);
  const v6 = net.isIPv6(address.replace(/%.*$/, '')) ? parseIpv6(address) : null;
  if (v6) return isBlockedIpv6(v6);
  return true;
}

// --- transport ---------------------------------------------------------------

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/**
 * The connect-time lookup: always the vetted addresses, never a fresh DNS
 * answer. Node 20's happy-eyeballs (autoSelectFamily) asks with `all: true`
 * and wants the list back; the plain form wants the first (address, family).
 */
export function pinnedLookup(vetted: ResolvedAddress[]): net.LookupFunction {
  const first = vetted[0]!;
  return ((
    _host: string,
    opts: dns.LookupOptions,
    cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ) => {
    if (opts && opts.all) cb(null, vetted.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, first.address, first.family);
  }) as unknown as net.LookupFunction;
}

function defaultRequest(req: PinnedRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        method: 'GET',
        protocol: 'https:',
        hostname: req.url.hostname,
        port: 443,
        path: `${req.url.pathname}${req.url.search}`,
        headers: { ...req.headers, Host: req.url.host },
        servername: req.url.hostname,
        lookup: pinnedLookup(req.addresses),
        // No pooled socket: a kept-alive connection belongs to whichever
        // address it was opened to, and that is not this check's to reuse.
        agent: false,
        signal: req.signal,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    r.on('error', reject);
    r.end();
  });
}

// --- the fetch -----------------------------------------------------------------

class FetchFailure extends Error {
  constructor(readonly result: SupplierPageResult & { ok: false }) {
    super(result.error);
  }
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const v = headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** Resolve, then refuse unless EVERY answer is public. Returns the answers to connect to. */
async function resolveVetted(
  hostname: string,
  lookup: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress[]> {
  let answers: ResolvedAddress[];
  try {
    answers = await lookup(hostname.replace(/\.$/, ''));
  } catch {
    throw new FetchFailure({ ok: false, error: 'fetch_failed' });
  }
  if (answers.length === 0) throw new FetchFailure({ ok: false, error: 'fetch_failed' });
  // ANY, not the first: a name that answers both a public and a private
  // address is a name built to get past exactly this check.
  if (answers.some((a) => isBlockedAddress(a.address))) {
    throw new FetchFailure({ ok: false, error: 'blocked_url' });
  }
  return answers;
}

function decompressor(encoding: string): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip();
  if (encoding === 'deflate') return zlib.createInflate();
  if (encoding === 'br') return zlib.createBrotliDecompress();
  throw new FetchFailure({ ok: false, error: 'fetch_failed' });
}

/** The decoded body, or 'too_large' the moment it passes the cap (the stream is torn down). */
function readBody(body: Readable, encoding: string, maxBytes: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const inflate = encoding === '' || encoding === 'identity' ? null : decompressor(encoding);
    const stream: Readable = inflate ?? body;
    if (inflate) {
      body.on('error', (e) => inflate.destroy(e));
      body.pipe(inflate);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        body.destroy();
        inflate?.destroy();
        resolve('too_large');
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

/** Decode with the charset the server declared; unknown or absent → UTF-8. */
export function decodeHtml(buf: Buffer, contentType: string): string {
  const declared = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(buf);
    } catch {
      // A label TextDecoder does not know (RangeError) — fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(buf);
}

async function walk(start: URL, deps: SupplierFetchDeps, signal: AbortSignal): Promise<SupplierPageResult> {
  const lookup = deps.lookup ?? defaultLookup;
  const request = deps.request ?? defaultRequest;
  const maxBytes = deps.maxBytes ?? SUPPLIER_FETCH_MAX_BYTES;
  const headers = {
    'User-Agent': `TouchPadelShop/${deps.appVersion} (supplier price check)`,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Encoding': 'gzip, deflate, br',
  };

  let current = start;
  for (let hop = 0; ; hop++) {
    const addresses = await resolveVetted(current.hostname, lookup);
    const res = await request({ url: current, addresses, headers, signal });

    if (REDIRECTS.has(res.status)) {
      res.body.destroy();
      if (hop >= SUPPLIER_FETCH_MAX_REDIRECTS) return { ok: false, error: 'fetch_failed' };
      const location = header(res.headers, 'location');
      if (!location) return { ok: false, error: 'fetch_failed' };
      let next: URL | null;
      try {
        next = checkSupplierUrl(new URL(location, current).href);
      } catch {
        next = null;
      }
      if (!next) return { ok: false, error: 'blocked_url' };
      current = next;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      res.body.destroy();
      return { ok: false, error: 'http_error', status: res.status };
    }

    const contentType = header(res.headers, 'content-type');
    if (!/html/i.test(contentType)) {
      res.body.destroy();
      return { ok: false, error: 'not_html' };
    }

    const encoding = header(res.headers, 'content-encoding').trim().toLowerCase();
    const declaredLength = Number(header(res.headers, 'content-length'));
    if ((encoding === '' || encoding === 'identity') && declaredLength > maxBytes) {
      res.body.destroy();
      return { ok: false, error: 'too_large' };
    }

    const body = await readBody(res.body, encoding, maxBytes);
    if (body === 'too_large') return { ok: false, error: 'too_large' };
    return { ok: true, html: decodeHtml(body, contentType), finalUrl: current.href };
  }
}

async function fetchOnce(rawUrl: string, deps: SupplierFetchDeps): Promise<SupplierPageResult> {
  const start = checkSupplierUrl(rawUrl);
  if (!start) return { ok: false, error: 'blocked_url' };

  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<SupplierPageResult>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve({ ok: false, error: 'timeout' });
    }, deps.timeoutMs ?? SUPPLIER_FETCH_TIMEOUT_MS);
  });
  const fetched = walk(start, deps, abort.signal).catch((error: unknown): SupplierPageResult => {
    if (error instanceof FetchFailure) return error.result;
    if (abort.signal.aborted) return { ok: false, error: 'timeout' };
    return { ok: false, error: 'fetch_failed' };
  });
  try {
    return await Promise.race([fetched, timedOut]);
  } finally {
    clearTimeout(timer);
    // Tears down a request still in flight after the timeout; a no-op after success.
    abort.abort();
  }
}

/** One fetch in flight at a time: the crawler walks the list, it never fans out. */
let inFlight: Promise<unknown> = Promise.resolve();

export function fetchSupplierPage(rawUrl: string, deps: SupplierFetchDeps): Promise<SupplierPageResult> {
  const run = inFlight.then(() => fetchOnce(rawUrl, deps));
  inFlight = run.catch(() => undefined);
  return run;
}
