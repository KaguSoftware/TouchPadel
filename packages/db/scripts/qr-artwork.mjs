#!/usr/bin/env node
/**
 * qr-artwork — print-ready per-table QR cards (SoW: "Print-ready QR artwork
 * supplied for every table, in Touch's branding").
 *
 * For every ACTIVE cafe_table it calls app.generate_table_token(table_id)
 * (owner-only HMAC signer; SERVICE ROLE key required — run this on a trusted
 * machine only, never ship the key) and renders an A6 SVG card:
 * Touch Cafe palette (#3360AB blue / #603813 brown — packages/ui/src/tokens/
 * palette.ts is the source of truth), the table number huge, and a QR of
 * `${SITE_URL}/t/${token}`.
 *
 * Output: packages/db/artwork/table-<number>.svg  (generated, NOT committed —
 * artwork/ should be gitignored; tokens die on token_version rotation anyway:
 * rotation = bump + re-run this script + reprint).
 *
 * Usage:
 *   pnpm --filter @touch/db qr:artwork
 * Env (packages/db/.env or root .env.local, else defaults to the local stack):
 *   SUPABASE_URL                (default http://127.0.0.1:54321)
 *   SUPABASE_SERVICE_ROLE_KEY   (required)
 *   SITE_URL                    (the public web app origin printed into the QR;
 *                                default http://localhost:3000 — DO NOT print
 *                                real cards from the default)
 *
 * NOTE font: brand faces (Next Art / Frutiger LT Arabic) are not in hand yet
 * (HANDOFF "Fonts"); the card uses a generic sans stack. Re-render when the
 * licensed fonts land — SVG text, one-line swap below.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import QRCode from 'qrcode';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '.env') });
loadEnv({ path: path.join(here, '..', '..', '..', '.env.local') });

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT_DIR = path.join(here, '..', 'artwork');

// Touch Cafe identity — keep in sync with packages/ui/src/tokens/palette.ts (cafePalette).
const BLUE = '#3360AB';
const BROWN = '#603813';
const WARM_BG = '#F8F5F1';
const WARM_BORDER = '#E0D8CE';

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set (packages/db/.env or root .env.local).');
  process.exit(1);
}
if (!process.env.SITE_URL) {
  console.warn(`WARNING: SITE_URL not set — encoding ${SITE_URL} (dev only, do not print).`);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchActiveTables() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cafe_tables?select=id,table_number,zone,token_version&is_active=eq.true&order=table_number.asc`,
    { headers },
  );
  if (!res.ok) throw new Error(`cafe_tables fetch failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function generateToken(tableId) {
  // app.* is exposed via PostgREST (config.toml api.schemas) — select it per call.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generate_table_token`, {
    method: 'POST',
    headers: { ...headers, 'Content-Profile': 'app' },
    body: JSON.stringify({ p_table_id: tableId }),
  });
  if (!res.ok) {
    throw new Error(`generate_table_token(${tableId}) failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const token = typeof data === 'string' ? data : data?.token;
  if (!token) throw new Error(`generate_table_token(${tableId}): unexpected response ${JSON.stringify(data)}`);
  return token;
}

/** One <path> of 1-unit squares for the QR's dark modules. */
function qrPath(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { d, size };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A6 portrait card, 105mm x 148mm (4 SVG units per mm -> viewBox 420 x 592).
 * Layout: blue header band / huge table number / QR with quiet zone / bilingual footer.
 */
function renderCard({ tableNumber, zone, qrUrl }) {
  const { d, size } = qrPath(qrUrl);
  const qrBox = 224; // px; ~56mm printed — comfortable phone-scan size
  const qrX = (420 - qrBox) / 2;
  const qrY = 258;
  const quiet = 4; // modules of quiet zone on each side
  const scale = qrBox / (size + quiet * 2);
  const n = String(tableNumber);
  const numSize = n.length <= 2 ? 96 : n.length <= 4 ? 72 : 52;
  const sans = "'Helvetica Neue', Arial, sans-serif"; // brand fonts pending (see header)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="105mm" height="148mm" viewBox="0 0 420 592">
  <!-- Touch Cafe table card — table ${esc(n)}${zone ? ` (${esc(zone)})` : ''} — generated by qr-artwork.mjs -->
  <rect width="420" height="592" fill="${WARM_BG}"/>
  <rect x="10" y="10" width="400" height="572" rx="18" fill="#FFFFFF" stroke="${WARM_BORDER}" stroke-width="2"/>

  <!-- header band -->
  <path d="M10 28a18 18 0 0 1 18-18h364a18 18 0 0 1 18 18v70H10z" fill="${BLUE}"/>
  <text x="210" y="55" text-anchor="middle" fill="#FFFFFF" font-family="${sans}"
        font-size="30" font-weight="700" letter-spacing="6">TOUCH CAFE</text>
  <text x="210" y="86" text-anchor="middle" fill="#FFFFFF" font-family="${sans}"
        font-size="17" opacity="0.9">Scan &#183; Order &#183; Relax</text>

  <!-- table number, huge -->
  <text x="210" y="136" text-anchor="middle" fill="${BROWN}" font-family="${sans}"
        font-size="20" font-weight="600" letter-spacing="3">TABLE &#1591;&#1575;&#1608;&#1604;&#1577;</text>
  <text x="210" y="234" text-anchor="middle" fill="${BLUE}"
        font-family="${sans}" font-size="${numSize}" font-weight="800">${esc(n)}</text>

  <!-- QR (quiet zone is the surrounding white) -->
  <rect x="${qrX - 10}" y="${qrY - 10}" width="${qrBox + 20}" height="${qrBox + 20}" rx="12"
        fill="#FFFFFF" stroke="${WARM_BORDER}" stroke-width="2"/>
  <g transform="translate(${qrX + quiet * scale} ${qrY + quiet * scale}) scale(${scale})">
    <path d="${d}" fill="${BROWN}"/>
  </g>

  <!-- bilingual footer -->
  <text x="210" y="${qrY + qrBox + 44}" text-anchor="middle" fill="${BROWN}"
        font-family="${sans}" font-size="19" font-weight="600">Scan to see the menu &amp; order</text>
  <text x="210" y="${qrY + qrBox + 72}" text-anchor="middle" fill="${BROWN}"
        font-family="${sans}" font-size="19" font-weight="600" direction="rtl"
        >&#1575;&#1605;&#1587;&#1581; &#1575;&#1604;&#1585;&#1605;&#1586; &#1604;&#1593;&#1585;&#1590; &#1575;&#1604;&#1602;&#1575;&#1574;&#1605;&#1577; &#1608;&#1575;&#1604;&#1591;&#1604;&#1576;</text>
  <text x="210" y="574" text-anchor="middle" fill="${WARM_BORDER}" font-family="${sans}" font-size="10">
    ${esc(new URL(qrUrl).host)}</text>
</svg>
`;
}

const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '_');

async function main() {
  const tables = await fetchActiveTables();
  if (!Array.isArray(tables) || tables.length === 0) {
    console.error('No active cafe_tables found — apply fixtures (or client data) first.');
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  for (const t of tables) {
    const token = await generateToken(t.id);
    const qrUrl = `${SITE_URL}/t/${token}`;
    const svg = renderCard({ tableNumber: t.table_number, zone: t.zone, qrUrl });
    const file = path.join(OUT_DIR, `table-${safeName(t.table_number)}.svg`);
    await writeFile(file, svg, 'utf8');
    console.log(`  ${t.table_number.padEnd(6)} v${t.token_version}  ->  ${path.relative(process.cwd(), file)}`);
  }
  console.log(`\n${tables.length} card(s) in ${OUT_DIR}`);
  console.log('Rotation reminder: bumping cafe_tables.token_version kills printed QRs — re-run + reprint.');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
