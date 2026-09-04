/**
 * Web hardening regression lock — Security Layer 1, Block 4 · Web (SEC-25).
 *
 * The headers, the CSP and the table-token cookie exchange all landed together.
 * Every one of them is a few lines that a later change could remove without any
 * test going red — the app renders perfectly well with no CSP at all. This is
 * the gate that notices.
 *
 * It also writes down the PWA rule as CODE rather than as a sentence in a
 * document. `/manifest.webmanifest` ships today with no service worker
 * ("No service worker by design", web-slice §7). The moment someone adds one —
 * and offline menu browsing is an obvious thing to want — the default
 * `next-pwa`/Workbox setup caches every navigation, including `/t`. A cached
 * table page is one guest's session served to the next guest who opens the app
 * on that phone, and a cached `/t/{token}` is the credential itself sitting in
 * the Cache Storage API where page script CAN read it.
 *
 * Usage:  node scripts/security/check-web-security.mjs   (exit 1 on violation)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WEB = path.join(ROOT, 'apps/web');

const read = (rel) => {
  const p = path.join(WEB, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const failures = [];
const passes = [];

const require_ = (label, ok, why) => (ok ? passes.push(label) : failures.push({ label, why }));

// ── next.config.ts ────────────────────────────────────────────────────────────
const nextConfig = read('next.config.ts');
if (!nextConfig) {
  failures.push({ label: 'next.config.ts present', why: 'the file is gone' });
} else {
  require_(
    'next.config.ts ships security headers',
    /async\s+headers\s*\(/.test(nextConfig) && /STATIC_SECURITY_HEADERS/.test(nextConfig),
    'the headers() block is how HSTS, nosniff, frame-ancestors and Permissions-Policy reach\n' +
      '      static assets and error responses, which the proxy matcher skips.',
  );
  require_(
    'image optimizer is not a wildcard proxy',
    !/hostname:\s*['"`]\*\./.test(nextConfig),
    'a wildcard remotePattern lets anyone pass /_next/image?url=https://<their>.supabase.co/…\n' +
      '      and have this origin fetch, resize and serve their bytes under the venue\'s own domain\n' +
      '      and TLS certificate — a free CDN, billed here, laundering the content\'s origin.',
  );
  require_(
    'table routes carry their own stricter headers',
    /TABLE_ROUTE_HEADERS/.test(nextConfig),
    'no-referrer and no-store on /t/* is what stops a QR card printed before the cookie\n' +
      '      exchange from leaking its token in a Referer header.',
  );
}

// ── proxy.ts ──────────────────────────────────────────────────────────────────
const proxy = read('proxy.ts');
if (!proxy) {
  failures.push({ label: 'proxy.ts present', why: 'the request-time security envelope is gone' });
} else {
  require_(
    'CSP is set per request with a nonce',
    /buildCsp\(/.test(proxy) && /content-security-policy/i.test(proxy),
    'the nonce must be unguessable and single-use, so the CSP cannot be a static header.\n' +
      '      Without it the only way to allow Next\'s inline bootstrap scripts is unsafe-inline,\n' +
      '      which disables script CSP entirely.',
  );
  require_(
    'the nonce reaches the renderer',
    /x-nonce/.test(proxy),
    'Next stamps its own inline scripts from the request CSP header, and the layout reads\n' +
      '      x-nonce for its inline <style>. Drop it and the page renders unstyled.',
  );
  require_(
    'the table token is exchanged for a cookie',
    /exchangeTableToken/.test(proxy) && /TABLE_COOKIE/.test(proxy),
    'without the exchange the table\'s bearer credential sits in the address bar for the whole\n' +
      '      session — sent in Referer to every third party, captured as $current_url, and left in\n' +
      '      browser history.',
  );
}

// ── CSP content ───────────────────────────────────────────────────────────────
const headersTs = read('src/lib/security/headers.ts');
if (!headersTs) {
  failures.push({ label: 'src/lib/security/headers.ts present', why: 'the policy definition is gone' });
} else {
  // 'unsafe-inline' is tolerated for style-src and nowhere else. Strip the
  // style-src directive before looking, so a genuine script-src regression
  // cannot hide behind the permitted one.
  const scriptSrcLine = headersTs.match(/'script-src':\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  require_(
    "script-src has no 'unsafe-inline'",
    !/unsafe-inline/.test(scriptSrcLine),
    "'unsafe-inline' in script-src makes the entire policy decorative: an injected <script> runs\n" +
      '      exactly like a legitimate one. This is the single line the whole CSP exists for.',
  );
  require_(
    "frame-ancestors is 'none'",
    /'frame-ancestors':\s*\["'none'"\]/.test(headersTs.replace(/\s+/g, ' ').replace(/\[ /g, '[')) ||
      /frame-ancestors[\s\S]{0,40}'none'/.test(headersTs),
    'clickjacking: without it the menu can be framed invisibly over an attacker\'s page.',
  );
  require_(
    'HSTS includes subdomains',
    /Strict-Transport-Security[\s\S]{0,200}includeSubDomains/.test(headersTs),
    'without includeSubDomains a subdomain served over http is still a downgrade path.',
  );
  require_(
    'the table cookie is HttpOnly + SameSite',
    /httpOnly:\s*true/.test(headersTs) && /sameSite:\s*'lax'/.test(headersTs),
    'the cookie holds the table\'s bearer credential; HttpOnly keeps document.cookie away from it\n' +
      '      and SameSite=Lax survives the cross-site arrival a QR scan from a messaging app produces.',
  );
}

// ── the PWA rule ──────────────────────────────────────────────────────────────
const SW_HINTS = [
  { re: /next-pwa|workbox|serwist/i, what: 'a service-worker build plugin' },
  { re: /navigator\.serviceWorker\.register/, what: 'a service-worker registration' },
];
const swFiles = [];
for (const dir of ['public', 'app', 'src']) {
  const abs = path.join(WEB, dir);
  if (!existsSync(abs)) continue;
  const stack = [abs];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/^(sw|service-worker)\.(js|ts)$/.test(e.name)) swFiles.push(path.relative(WEB, p));
    }
  }
}
const pkg = read('package.json') ?? '';
const swPlugins = SW_HINTS.filter((h) => h.re.test(pkg) || (nextConfig && h.re.test(nextConfig)));

if (swFiles.length === 0 && swPlugins.length === 0) {
  passes.push('no service worker (PWA rule holds vacuously)');
} else {
  // A service worker MAY exist — but it must exclude the table route.
  const swText = swFiles.map((f) => read(f) ?? '').join('\n') + '\n' + (nextConfig ?? '');
  const excludesTableRoute = /\/t\b[\s\S]{0,120}(exclude|denylist|navigateFallbackDenylist|skip)/i.test(swText) ||
    /(exclude|denylist|navigateFallbackDenylist|skip)[\s\S]{0,120}\/t\b/i.test(swText);
  require_(
    'service worker excludes /t from caching',
    excludesTableRoute,
    'A service worker now exists (' +
      [...swFiles, ...swPlugins.map((p) => p.what)].join(', ') +
      ')\n' +
      '      but nothing shows /t being excluded from it. A cached table page is one guest\'s\n' +
      '      session served to the next person who opens the app on that phone, and a cached\n' +
      '      /t/{token} puts the credential in Cache Storage, where page script CAN read it —\n' +
      '      undoing the HttpOnly cookie entirely.\n' +
      '      FIX: exclude /t (and /t/*) from precache and from any navigation fallback.',
  );
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('Web hardening lock — apps/web\n');
for (const p of passes) console.log(`  ok    ${p}`);
if (failures.length === 0) {
  console.log('\nPASS  headers, CSP, cookie exchange and the PWA rule all intact.');
  process.exit(0);
}
console.error('');
console.error(`FAIL  ${failures.length} web hardening regression(s):\n`);
for (const f of failures) {
  console.error(`  ${f.label}`);
  console.error(`      ${f.why}`);
  console.error('');
}
process.exit(1);
