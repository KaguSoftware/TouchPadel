/**
 * Shared helpers for analysers (scripts/checks/*.mjs). An analyser gets the snapshot and a
 * ctx built here, so a new check reuses the same dedupe, token lookup and source mapping
 * instead of re-deriving them.
 */
import { loc } from './source-index.mjs';

/** Screens sorted for display: the start locale first, then the rest alphabetically. */
export const sortScreens = (list, startPath = '/en') =>
  [...list].sort((a, b) => (b.startsWith(startPath) - a.startsWith(startPath)) || a.localeCompare(b));

export const screenOf = (st) => (st.layer && st.layer !== 'page' ? `${st.pathname} [${st.layer}]` : st.pathname);

export const near = (a, b, tol = 0.5) => a != null && b != null && Math.abs(a - b) <= tol;
export const r1 = (n) => (n == null || Number.isNaN(n) ? '?' : Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(/\.0$/, ''));

/**
 * Element records deduped per viewport by fingerprint, each with the screens it shows on.
 * `scope`: 'all' (default), 'start' (only states reached from the start root), 'seeds'.
 */
export function uniqueElements(snapshot, { scope = 'all' } = {}) {
  const out = [];
  for (const [vpId, vp] of Object.entries(snapshot.viewports)) {
    const byFp = new Map();
    for (const st of vp.states) {
      if (scope === 'start' && st.rootKind !== 'start') continue;
      if (scope === 'seeds' && st.rootKind === 'start') continue;
      for (const fp of st.elements) {
        const rec = vp.elements[fp];
        if (!rec) continue;
        let item = byFp.get(fp);
        if (!item) {
          item = { vp: vpId, fp, rec, screens: [], staffAll: true, states: [] };
          byFp.set(fp, item);
        }
        const sc = screenOf(st);
        if (!item.screens.includes(sc)) item.screens.push(sc);
        item.states.push(st.n);
        if (!st.staff) item.staffAll = false;
      }
    }
    out.push(...byFp.values());
  }
  return out;
}

/** Same for cards. */
export function uniqueCards(snapshot) {
  const out = [];
  for (const [vpId, vp] of Object.entries(snapshot.viewports)) {
    const byFp = new Map();
    for (const st of vp.states) {
      for (const fp of st.cards) {
        const rec = vp.cards[fp];
        if (!rec) continue;
        let item = byFp.get(fp);
        if (!item) {
          item = { vp: vpId, fp, rec, screens: [], staffAll: true };
          byFp.set(fp, item);
        }
        const sc = screenOf(st);
        if (!item.screens.includes(sc)) item.screens.push(sc);
        if (!st.staff) item.staffAll = false;
      }
    }
    out.push(...byFp.values());
  }
  return out;
}

/** Resolved token values ({'--tp-x': px|rgb}) for a record. */
export const tokensOf = (snapshot, vpId, rec) => snapshot.viewports[vpId]?.tokScopes?.[rec.tok]?.values ?? {};

/** Name the token whose value equals `value` (colour string or px), among `names`. */
export function tokenNamed(values, names, value, tol = 0.5) {
  for (const n of names) {
    const v = values[n];
    if (v == null) continue;
    if (typeof v === 'number' ? typeof value === 'number' && near(v, value, tol) : v === value) return n;
  }
  return null;
}

/** BEM block-or-element class used to group components: first tp-* class without a --modifier. */
export function componentClass(classes) {
  return classes.find((c) => /^tp-[a-z0-9-]+(__[a-z0-9-]+)?$/.test(c)) ?? classes.find((c) => c.startsWith('tp-')) ?? null;
}

/** "file:line · Component.tsx:line" for a recorded element or card (classes, ancestors, tag, dir). */
export function sourceText(source, el) {
  const r = Array.isArray(el) ? source.resolve(el) : source.resolveEl(el);
  const parts = [];
  if (r.primary) parts.push(`${short(r.primary.file)}:${r.primary.line}`);
  if (r.jsx) parts.push(`${short(r.jsx.file)}:${r.jsx.line}`);
  return { text: parts.join(' · ') || 'source not found', resolved: r };
}
export const short = (file) => file.replace(/^apps\/web\//, '');

/**
 * A stable signature for grouping: the element's tp-* classes, or for a classless element
 * the contextual selector that styles it (`.tp-cattabs button`), else `.ancestor tag`.
 */
export function signatureOf(source, el) {
  const own = (el.classes ?? []).filter((c) => c.startsWith('tp-'));
  if (own.length) return `.${own.join('.')}`;
  const r = source.resolveEl(el);
  if (r.context) return r.context.replace(/:(hover|focus|active|focus-visible|where|is|not)(\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim();
  return el.ancestors?.[0] ? `.${el.ancestors[0]} ${el.tag}` : `<${el.tag}>`;
}

const VAR_RE = /var\(\s*(--tp-[A-Za-z0-9-]+)\s*(,)?/g;
const RAW_LEN = /(^|[\s(,])(-?\d*\.?\d+)(px|rem|em)\b/;
const AUDITED = /^(border-radius|border-(start|end)-(start|end)-radius|font-size|padding(-block|-inline)?(-start|-end)?|min-block-size|min-height|block-size|height)$/;

/**
 * Audit the declarations of the rules that style `classes`:
 *  - undefined: var(--tp-x) with no fallback that the family's scope does not define and
 *    no web stylesheet declares locally (renders as the property's initial value);
 *  - foreign: a token from the other family's vocabulary (contracts §2);
 *  - raw: a px/rem literal on radius, font-size, padding or height (not a token).
 * Returns [{kind, prop, value, file, line, token?}].
 */
export function auditDecls(ctx, el, family) {
  const fam = ctx.ds.families[family];
  const defined = new Set([...(ctx.snapshotDefined[family] ?? []), ...ctx.source.localVars.keys()]);
  const out = [];
  const seen = new Set();
  {
    for (const d of ctx.source.declsForEl(el)) {
      const id = `${d.file}:${d.line}:${d.prop}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const fileFam = ctx.source.familyOfFile(d.file) ?? family;
      for (const m of d.value.matchAll(VAR_RE)) {
        const name = m[1];
        const hasFallback = !!m[2];
        if (!hasFallback && defined.size && !defined.has(name)) {
          out.push({ kind: 'undefined', prop: d.prop, value: d.value, file: d.file, line: d.line, token: name });
          continue;
        }
        const forbidden = ctx.ds.families[fileFam]?.forbiddenTokenPrefixes ?? fam?.forbiddenTokenPrefixes ?? [];
        if (forbidden.some((p) => name.startsWith(p))) out.push({ kind: 'foreign', prop: d.prop, value: d.value, file: d.file, line: d.line, token: name });
      }
      if (AUDITED.test(d.prop) && !d.value.includes('var(') && !/clamp|calc|min\(|max\(/.test(d.value) && RAW_LEN.test(d.value) && !/^0(px)?$/.test(d.value.trim())) {
        const px = d.value
          .trim()
          .split(/\s+/)
          .map((t) => /^(-?\d*\.?\d+)(px|rem|em)$/.exec(t))
          .filter(Boolean)
          .map((m) => (m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16));
        out.push({ kind: 'raw', prop: d.prop, value: d.value, px, file: d.file, line: d.line, selector: d.selector });
      }
    }
  }
  return out;
}

export const declText = (d) => `${d.prop}: ${d.value} (${short(d.file)}:${d.line})`;

export { loc };
