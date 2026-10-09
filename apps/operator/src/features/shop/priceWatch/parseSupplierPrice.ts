/**
 * The supplier price watch (0322, docs/design/shop/supplier-price-watch-2026-10-08.md):
 * read ONE price in Iraqi dinars from a supplier's product page.
 *
 * Generic on purpose (Majed's call): staff paste any product page link, and
 * this reads the structured price data shops publish for search engines, in
 * order of how much it can be trusted:
 *
 *   1. JSON-LD (`<script type="application/ld+json">`): Offer / AggregateOffer
 *      prices, under a Product, an `@graph`, a ProductGroup's variants, …
 *   2. `<meta>` price tags (Open Graph / Facebook product tags, `price`).
 *   3. Microdata: any element with `itemprop="price"` and a `content` value.
 *
 * The first source that yields a price decides; the later ones are not read.
 * Within it, two different prices (a size or colour priced apart, a "from"
 * range) is `ambiguous` and a currency other than dinars is `not_iqd`: the
 * watch then says what it read instead of guessing a number the owner would
 * apply as a selling price.
 *
 * Pure string work, no DOMParser: it runs on the shop desk PC's renderer and
 * under the node test beside it. Nothing here is trusted by the server, which
 * checks the reported price's range again (record_shop_supplier_price).
 */

export type SupplierPriceSource = 'jsonld' | 'meta' | 'microdata';
export type SupplierParseError = 'no_price' | 'ambiguous' | 'not_iqd';

export type SupplierPriceRead =
  | { ok: true; priceIqd: number; source: SupplierPriceSource }
  | { ok: false; error: SupplierParseError };

/** The same ceiling record_shop_supplier_price holds a price to. */
export const MAX_SUPPLIER_PRICE_IQD = 1e12;

interface Candidate {
  value: number;
  /** Upper-case code as the page gave it; null = the page did not say. */
  currency: string | null;
  /** One end of a price range ("from 40,000"): the page has no one price. */
  range?: boolean;
  /** The JSON-LD offer's own `url`, when it gives one (Shopify: `…?variant=123`). */
  offerUrl?: string;
}

/**
 * `pageUrl`: the watched link. On a page whose JSON-LD lists one offer per
 * variant, each with its own `url` (Shopify prints every variant's offer
 * whichever `?variant=` is open), a link that names its variant picks that
 * offer's price instead of reading the page as ambiguous.
 */
export function parseSupplierPrice(html: string, pageUrl?: string): SupplierPriceRead {
  let tags: TagPrices | null = null;
  const tagsOf = () => (tags ??= tagPrices(withoutScripts(html)));
  const sources: [SupplierPriceSource, () => Candidate[]][] = [
    ['jsonld', () => jsonLdCandidates(html)],
    ['meta', () => withPageCurrency(tagsOf().meta, tagsOf().currencies)],
    ['microdata', () => withPageCurrency(tagsOf().microdata, tagsOf().currencies)],
  ];
  for (const [source, read] of sources) {
    const found = read();
    if (found.length === 0) continue;
    if (found.some((c) => c.currency !== null && !isIqd(c.currency))) return { ok: false, error: 'not_iqd' };
    const prices = new Set(found.map((c) => c.value));
    if (prices.size > 1 || found.some((c) => c.range)) {
      const mine = source === 'jsonld' && pageUrl ? offersForVariant(found, pageUrl) : [];
      if (mine.length > 0 && !mine.some((c) => c.range) && new Set(mine.map((c) => c.value)).size === 1) {
        return { ok: true, priceIqd: mine[0]!.value, source };
      }
      return { ok: false, error: 'ambiguous' };
    }
    return { ok: true, priceIqd: found[0]!.value, source };
  }
  return { ok: false, error: 'no_price' };
}

/**
 * The offers whose own `url` is the watched link's variant: the same path and
 * the same `variant` query value. None when the link names no variant (the
 * page then stays ambiguous: which size is meant is not ours to guess).
 */
function offersForVariant(found: readonly Candidate[], pageUrl: string): Candidate[] {
  const page = safeUrl(pageUrl);
  const variant = page?.searchParams.get('variant');
  if (!page || !variant) return [];
  const path = (u: URL) => u.pathname.replace(/\/+$/, '');
  return found.filter((c) => {
    const offer = c.offerUrl ? safeUrl(c.offerUrl, page.href) : null;
    return offer !== null && path(offer) === path(page) && offer.searchParams.get('variant') === variant;
  });
}

function safeUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Numbers and currencies
// ---------------------------------------------------------------------------

const IQD_MARKS = ['IQD', 'د.ع.', 'د.ع', 'دينار عراقي', 'دينار'];

function isIqd(currency: string): boolean {
  return IQD_MARKS.some((m) => m.toUpperCase() === currency);
}

/** A currency named inside a price string ("$25", "25 USD"), if any. */
function currencyIn(raw: string): string | null {
  if (raw.includes('$')) return 'USD';
  if (raw.includes('€')) return 'EUR';
  if (raw.includes('£')) return 'GBP';
  const code = /\b([A-Za-z]{3})\b/.exec(raw);
  return code ? code[1]!.toUpperCase() : null;
}

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Arabic-Indic and Persian digits as ASCII; the Arabic separators as ',' and '.'. */
function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/٬/g, ',') // ٬ Arabic thousands separator
    .replace(/٫/g, '.'); // ٫ Arabic decimal separator
}

/**
 * A price as whole dinars, or null when it is not one positive amount.
 *
 * Grouping: "25,000", "1.250.000" (a '.' only when it groups threes from a
 * non-zero lead), "25 000", "٢٥٬٠٠٠". Decimals: "25000.00", "25000,5",
 * "٢٥٠٠٠٫٠٠", and with both marks the later one is the decimal ("1.234,50").
 * Rounded to the nearest dinar: IQD has no coins in use.
 */
export function parsePriceNumber(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    let s = asciiDigits(raw);
    for (const mark of IQD_MARKS) s = s.split(mark).join('');
    s = s.replace(/[\s   ]/g, '');
    if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;
    const parsed = plainNumber(s);
    if (parsed === null) return null;
    n = parsed;
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole > 0 && whole <= MAX_SUPPLIER_PRICE_IQD ? whole : null;
}

/** Digits with ',' and '.' only, as a JS number; null when the marks do not add up. */
function plainNumber(s: string): number | null {
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    const cut = Math.max(lastComma, lastDot);
    const intPart = s.slice(0, cut);
    const frac = s.slice(cut + 1);
    if (!groupedThrees(intPart, group) || !/^\d+$/.test(frac)) return null;
    return Number(`${intPart.split(group).join('')}.${frac}`);
  }
  const sep = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null;
  if (sep === null) return Number(s);
  if (groupedThrees(s, sep)) return Number(s.split(sep).join(''));
  // Not a grouping, so one decimal mark: "25000.00", "12,5".
  const parts = s.split(sep);
  if (parts.length !== 2) return null;
  return Number(`${parts[0]}.${parts[1]}`);
}

/** "25,000" / "1.250.000": a 1–3 digit lead (not 0) and groups of exactly three. */
function groupedThrees(s: string, sep: ',' | '.'): boolean {
  if (!s.includes(sep)) return /^\d+$/.test(s);
  const parts = s.split(sep);
  return /^[1-9]\d{0,2}$/.test(parts[0]!) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

function candidate(price: unknown, currency: unknown): Candidate | null {
  const value = parsePriceNumber(price);
  if (value === null) {
    // "$25" is a price, just not in dinars: still the page's answer.
    if (typeof price === 'string') {
      const named = currencyIn(price);
      const digits = parsePriceNumber(price.replace(/[$€£]|\b[A-Za-z]{3}\b/g, ''));
      if (named && digits !== null) return { value: digits, currency: named };
    }
    return null;
  }
  const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : null;
  return { value, currency: code };
}

// ---------------------------------------------------------------------------
// 1. JSON-LD
// ---------------------------------------------------------------------------

const LD_TYPE_RE = /\btype\s*=\s*["']?application\/ld\+json\b/i;

/**
 * Every `<script>` element as its opening tag and its body. A scanner, not one
 * big regex: the page is a stranger's, and a regex that hunts for a closing
 * `>` or `</script>` from every `<script` it meets turns a page of unclosed
 * tags into minutes of work on the till's own thread. Here every search moves
 * forward, and an element left open ends the scan.
 */
function* scriptElements(html: string): Generator<{ open: string; body: string }> {
  const opener = /<script\b/gi;
  const closer = /<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    const openEnd = html.indexOf('>', m.index);
    if (openEnd < 0) return;
    closer.lastIndex = openEnd + 1;
    const close = closer.exec(html);
    if (!close) return;
    yield { open: html.slice(m.index, openEnd + 1), body: html.slice(openEnd + 1, close.index) };
    opener.lastIndex = closer.lastIndex;
  }
}

function jsonLdCandidates(html: string): Candidate[] {
  const out: Candidate[] = [];
  for (const el of scriptElements(html)) {
    if (!LD_TYPE_RE.test(el.open)) continue;
    const body = el.body
      .trim()
      .replace(/^<!--/, '')
      .replace(/-->$/, '')
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
      .trim();
    if (!body) continue;
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      continue; // A broken block is skipped; the others still count.
    }
    walk(data, false, null, out, 0);
  }
  return out;
}

const MAX_DEPTH = 40;

const typesOf = (node: Record<string, unknown>): string[] =>
  (Array.isArray(node['@type']) ? node['@type'] : [node['@type']])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, ''));

/** A price that is not what the item sells for now (a strike-through "was" price). */
const NOT_SELLING_PRICE = /(ListPrice|StrikethroughPrice|MSRP|SRP|InvoicePrice|MinimumAdvertisedPrice)$/i;

/**
 * Every offer price under `node`. `asOffer`: the node sits under an `offers`
 * key, so it is an offer whether or not it says so (Shopify and Salla often
 * leave `@type` off).
 */
function walk(node: unknown, asOffer: boolean, inheritedCurrency: string | null, out: Candidate[], depth: number): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, asOffer, inheritedCurrency, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const types = typesOf(obj);
  const isAggregate = types.includes('AggregateOffer');
  const isOffer = asOffer || isAggregate || types.includes('Offer');
  if (!isOffer) {
    for (const [key, value] of Object.entries(obj)) {
      if (key === '@context') continue;
      walk(value, key === 'offers', null, out, depth + 1);
    }
    return;
  }

  const currency = typeof obj.priceCurrency === 'string' ? obj.priceCurrency : inheritedCurrency;
  const before = out.length;
  if (obj.price !== undefined && obj.price !== null && obj.price !== '') {
    pushCandidate(out, obj.price, currency);
  } else if (isAggregate || obj.lowPrice !== undefined || obj.highPrice !== undefined) {
    // A range: one price when both ends agree, ambiguous when they do not.
    const ends = [obj.lowPrice, obj.highPrice].filter((end) => end !== undefined && end !== null && end !== '');
    for (const end of ends) pushCandidate(out, end, currency);
    // One end alone over several offers is a "from" price, not this size's.
    // Listed offers, when there are any, say for themselves (read below).
    if (ends.length === 1 && Number(obj.offerCount) !== 1 && !obj.offers) {
      for (let k = before; k < out.length; k++) out[k] = { ...out[k]!, range: true };
    }
  }
  if (out.length === before && obj.priceSpecification) {
    const specs = Array.isArray(obj.priceSpecification) ? obj.priceSpecification : [obj.priceSpecification];
    for (const spec of specs) {
      if (!spec || typeof spec !== 'object') continue;
      const s = spec as Record<string, unknown>;
      if (typeof s.priceType === 'string' && NOT_SELLING_PRICE.test(s.priceType)) continue;
      if (s.price === undefined || s.price === null || s.price === '') continue;
      pushCandidate(out, s.price, typeof s.priceCurrency === 'string' ? s.priceCurrency : currency);
    }
  }
  // An AggregateOffer may list its own offers; an Offer may sit on a
  // ProductGroup's variants. Either way, read them as offers too.
  // The candidates this offer gave carry its own link (a variant's page).
  if (typeof obj.url === 'string' && obj.url) {
    for (let k = before; k < out.length; k++) out[k] = { ...out[k]!, offerUrl: obj.url };
  }
  if (obj.offers) walk(obj.offers, true, currency, out, depth + 1);
}

function pushCandidate(out: Candidate[], price: unknown, currency: unknown) {
  const c = candidate(price, currency);
  if (c) out.push(c);
}

// ---------------------------------------------------------------------------
// 2. <meta> tags and 3. microdata
// ---------------------------------------------------------------------------

/**
 * Scripts and styles out, so a template string inside one is not read as a
 * tag. Scanned forward like scriptElements; an element left open drops the
 * rest of the page.
 */
function withoutScripts(html: string): string {
  const opener = /<(script|style)\b/gi;
  let out = '';
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    out += html.slice(from, m.index) + ' ';
    const closer = new RegExp(`</${m[1]}\\s*>`, 'gi');
    closer.lastIndex = m.index + m[0].length;
    const close = closer.exec(html);
    if (!close) return out;
    from = opener.lastIndex = closer.lastIndex;
  }
  return out + html.slice(from);
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const ENDS_NAME = new Set([' ', '\n', '\t', '\r', '\f', '=', '/', '>', '"', "'"]);

/**
 * A tag's `name=value` attributes (the first of a repeated name wins). Read
 * by hand, left to right, for the same reason as tagsIn: an attribute regex
 * backtracks over every start inside a long run of junk.
 */
function attrsOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let i = 1;
  while (i < tag.length && !ENDS_NAME.has(tag[i]!)) i++; // the tag's own name
  while (i < tag.length) {
    if (ENDS_NAME.has(tag[i]!)) {
      i++;
      continue;
    }
    const nameStart = i;
    while (i < tag.length && !ENDS_NAME.has(tag[i]!)) i++;
    const name = tag.slice(nameStart, i).toLowerCase();
    while (isSpace(tag[i])) i++;
    if (tag[i] !== '=') continue; // a bare attribute (itemscope): nothing to read
    i++;
    while (isSpace(tag[i])) i++;
    let value: string;
    const quote = tag[i];
    if (quote === '"' || quote === "'") {
      const close = tag.indexOf(quote, i + 1);
      if (close < 0) break; // an unclosed value: the rest of the tag is not attributes
      value = tag.slice(i + 1, close);
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < tag.length && !isSpace(tag[i]) && tag[i] !== '>' && tag[i] !== '"' && tag[i] !== "'") i++;
      value = tag.slice(valueStart, i);
    }
    if (!attrs.has(name)) attrs.set(name, decodeEntities(value));
  }
  return attrs;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

const META_PRICE_KEYS = new Set(['product:price:amount', 'og:price:amount', 'price']);
const META_CURRENCY_KEYS = new Set(['product:price:currency', 'og:price:currency', 'pricecurrency']);

interface TagPrices {
  /** `<meta>` price amounts (Open Graph, product tags, `itemprop="price"` on a meta). */
  meta: string[];
  /** `itemprop="price" content=…` on any other element. */
  microdata: string[];
  /** Every currency the tags name, meta or microdata: one page, one currency. */
  currencies: string[];
}

/** No price or currency tag is this long; a longer one is skipped unread. */
const MAX_TAG_LENGTH = 4096;

/**
 * Every opening tag, scanned forward (each `<` to the next `>`), so a page of
 * unclosed tags costs one pass, not one pass per `<`.
 */
function* tagsIn(html: string): Generator<string> {
  const start = /<[a-z]/gi;
  let m: RegExpExecArray | null;
  while ((m = start.exec(html)) !== null) {
    const end = html.indexOf('>', m.index);
    if (end < 0) return;
    if (end - m.index < MAX_TAG_LENGTH) yield html.slice(m.index, end + 1);
    start.lastIndex = end + 1;
  }
}

/** One pass over the page's tags for both tag sources. */
function tagPrices(html: string): TagPrices {
  const out: TagPrices = { meta: [], microdata: [], currencies: [] };
  for (const tag of tagsIn(html)) {
    const isMeta = /^<meta\b/i.test(tag);
    if (!isMeta && !/\bitemprop\s*=/i.test(tag)) continue;
    const attrs = attrsOf(tag);
    const content = attrs.get('content');
    if (content === undefined) continue;
    const keys = (isMeta ? [attrs.get('property'), attrs.get('name'), attrs.get('itemprop')] : [attrs.get('itemprop')])
      .filter((k): k is string => typeof k === 'string')
      .flatMap((k) => k.toLowerCase().split(/\s+/));
    if (keys.some((k) => (isMeta ? META_PRICE_KEYS.has(k) : k === 'price'))) (isMeta ? out.meta : out.microdata).push(content);
    else if (keys.some((k) => META_CURRENCY_KEYS.has(k)) && content.trim()) out.currencies.push(content);
  }
  return out;
}

/**
 * Tags carry the currency apart from the amount, so every currency the page
 * names applies to every amount: one non-dinar currency makes it not_iqd.
 */
function withPageCurrency(prices: string[], currencies: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of prices) {
    const c = candidate(p, null);
    if (!c) continue;
    if (c.currency !== null) out.push(c);
    else if (currencies.length === 0) out.push(c);
    else for (const cur of currencies) out.push({ value: c.value, currency: cur.trim().toUpperCase() });
  }
  return out;
}
