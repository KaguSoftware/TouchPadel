/**
 * button-consistency: buttons of one kind look the same everywhere. Judged against the
 * family's shared button (design-system.json families.<f>.buttons), not the majority.
 * See checks/button-consistency.md.
 *
 *  - hand-built: a boxed button/link that does not use the family's button class
 *    (.tp-site-btn / .tp-site-iconbtn on the site, .tp-btn in the café);
 *  - foreign: a site button wearing the café's .tp-btn (or the reverse);
 *  - drift: a shared button whose rendered height, radius, type or border differs from its
 *    variant's canon, naming the rule that sets the value;
 *  - kind: a control that is its own design-system component, not a text button (FAB, café
 *    icon button, chip/tab pill, language pill: design-system.json buttons.kinds), judged
 *    against that kind's canon instead of the text-button canon (warning);
 *  - allowlisted look-alikes (cfg.allow, with the reason) are only compared.
 *
 * Type (font, weight, case, tracking, size) is read from the element that holds the label
 * text (page-probe `label`), and skipped for icon-only controls. A border is compared only
 * where someone can see it: a canon border of `1px solid transparent` vs no border is not a
 * difference, a visible border where the canon's is transparent is.
 *
 * Grouped per viewport by style signature; LTR and RTL instances of one signature are one
 * finding (RTL differences that LTR does not have are appended).
 */
import { declText, near, r1, signatureOf, sortScreens, sourceText, tokenNamed } from '../lib/analysis.mjs';

const PROP_RE = {
  minHeight: /^(min-block-size|min-height|block-size|height)$/,
  minWidth: /^(min-inline-size|min-width|inline-size|width)$/,
  radius: /radius/,
  fontWeight: /^(font-weight|font)$/,
  textTransform: /^text-transform$/,
  letterSpacingEm: /^letter-spacing$/,
  fontSize: /^(font-size|font)$/,
  borderWidth: /^border(-width|-block|-inline)?(-(start|end))?(-width)?$/,
  border: /^border(-width|-style|-block|-inline)?(-(start|end))?(-(width|style))?$/,
  fontFamily: /^(font-family|font)$/,
};
const LABEL = { minHeight: 'min height', minWidth: 'min width', radius: 'radius', fontWeight: 'weight', textTransform: 'case', letterSpacingEm: 'tracking', fontSize: 'font size', borderWidth: 'border', border: 'border', fontFamily: 'font' };
const TYPE_PROPS = new Set(['fontWeight', 'textTransform', 'letterSpacingEm', 'fontSize', 'fontFamily']);
const NOT_COMPARED = new Set(['borderStyle', 'borderTransparent', 'radiusShape', 'fontFamilyToken']);

const alpha = (c) => {
  if (!c || c === 'transparent') return 0;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return 1;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean);
  return parts.length >= 4 ? parseFloat(parts[3]) : 1;
};
export const firstFamily = (stack) => String(stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');

function measured(e) {
  const s = e.style;
  const t = e.label && !e.label.self ? e.label : s;
  const mh = parseFloat(s.minHeight);
  const bw = Math.max(...s.borderWidth);
  const side = s.borderWidth.indexOf(bw);
  // Visible = drawn, not transparent, and not the same colour as the button's own ground
  // (a 3D style - outset, inset, groove, ridge - shades its colour, so it always shows).
  const shaded = (st) => ['outset', 'inset', 'groove', 'ridge'].includes(st);
  const visible = s.borderWidth.some(
    (w, i) => w > 0 && !['none', 'hidden'].includes(s.borderStyle?.[i]) && alpha(s.borderColor?.[i]) > 0 && (shaded(s.borderStyle?.[i]) || s.borderColor?.[i] !== s.bg),
  );
  return {
    minHeight: Number.isFinite(mh) && mh > 0 ? mh : e.rect.h,
    minWidth: e.rect.w,
    radius: Math.max(...s.radius),
    fontWeight: t.fontWeight,
    textTransform: t.textTransform,
    letterSpacingEm: t.fontSize ? +(t.letterSpacing / t.fontSize).toFixed(3) : 0,
    fontSize: t.fontSize,
    fontFamily: firstFamily(t.fontFamily ?? s.fontFamily),
    borderWidth: bw,
    borderStyle: s.borderStyle?.[side] ?? 'none',
    borderVisible: visible,
    hasText: e.hasText !== false,
    typeFrom: e.label && !e.label.self ? (String(e.label.cls).startsWith('tp-') ? `.${e.label.cls}` : `<${e.label.cls}>`) : null,
  };
}

/** A kind's canon: base, then each variant class it carries, then RTL overrides. */
function expectedForKind(kind, classes, rtl) {
  let want = { ...(kind.canon ?? {}) };
  for (const c of classes) if (kind.variants?.[c]) want = { ...want, ...kind.variants[c] };
  if (rtl) {
    want = { ...want, ...(kind.rtl?.base ?? {}) };
    for (const c of classes) if (kind.rtl?.[c]) want = { ...want, ...kind.rtl[c] };
  }
  return want;
}

function expectedFor(fam, classes, rtl, base) {
  const canon = fam.buttons.canon;
  const comp = base ?? fam.buttons.componentClasses.find((c) => classes.includes(c));
  let want = { ...(canon[comp] ?? {}) };
  for (const c of classes) if (c !== comp && canon[c]) want = { ...want, ...canon[c] };
  if (rtl) {
    const r = fam.buttons.rtl ?? {};
    if (r[comp]) want = { ...want, ...r[comp] };
    for (const c of classes) if (c !== comp && r[c]) want = { ...want, ...r[c] };
  }
  return want;
}

function diff(got, want, tok, rect, tol) {
  const out = [];
  const height = rect.h;
  const uaFont = !!got.uaFont;
  for (const [k, w] of Object.entries(want)) {
    if (NOT_COMPARED.has(k) && k !== 'radiusShape' && k !== 'fontFamilyToken') continue;
    if (!got.hasText && (TYPE_PROPS.has(k) || k === 'fontFamilyToken')) continue; // icon-only: no type to judge
    if (k === 'radiusShape') {
      if (w === 'round' && !(got.radius >= Math.min(rect.h, rect.w) / 2 - 0.5)) out.push({ prop: 'radius', got: `${r1(got.radius)}px`, want: 'round (circle/pill)' });
      continue;
    }
    if (k === 'fontFamilyToken') {
      const v = tok[w];
      if (!v) continue;
      const canonFam = firstFamily(v);
      if (canonFam.toLowerCase() !== String(got.fontFamily).toLowerCase()) {
        out.push({ prop: 'fontFamily', got: `${got.fontFamily}${uaFont ? ` ${r1(got.fontSize)}px, the browser's default button font (no font rule reaches it)` : ''}`, want: `${canonFam} ${w}` });
      }
      continue;
    }
    if (k === 'borderWidth') {
      // Judge the border a person sees. Canon "1.5px solid transparent" vs no border: same look.
      const style = want.borderStyle ?? 'solid';
      const ua = got.borderStyle === 'outset' || got.borderStyle === 'inset';
      const gotTxt = `${r1(got.borderWidth)}px ${got.borderStyle}${ua ? ", the browser's default button border" : ''}`;
      if (want.borderTransparent) {
        if (got.borderVisible) out.push({ prop: 'border', got: gotTxt, want: w > 0 ? `${r1(w)}px ${style} transparent` : 'none' });
      } else if (!got.borderVisible) {
        out.push({ prop: 'border', got: 'none', want: `${r1(w)}px ${style}` });
      } else if (!near(got.borderWidth, w, tol) || got.borderStyle !== style) {
        out.push({ prop: 'border', got: gotTxt, want: `${r1(w)}px ${style}` });
      }
      continue;
    }
    if (k === 'radiusToken') {
      const v = tok[w];
      if (v == null) continue;
      const pill = v >= 999;
      const ok = pill ? got.radius >= height / 2 - 0.5 : near(got.radius, v, tol);
      if (!ok) out.push({ prop: 'radius', got: `${r1(got.radius)}px`, want: `${pill ? 'pill' : `${r1(v)}px`} ${w}` });
      continue;
    }
    const g = got[k];
    if (g === undefined) continue;
    const same = typeof w === 'number' ? near(g, w, k === 'letterSpacingEm' ? 0.006 : tol) : g === w;
    const fmt = (v) => (typeof v !== 'number' ? v : k === 'letterSpacingEm' ? `${v}em` : k === 'fontWeight' ? `${v}` : `${r1(v)}px`);
    if (!same) out.push({ prop: k, got: `${fmt(g)}${got.typeFrom && TYPE_PROPS.has(k) ? ` (on its label ${got.typeFrom})` : ''}`, want: fmt(w) });
  }
  return out;
}

/** The declaration that sets `prop` on this element: section/page overrides first, then the shared rules. */
function setter(ctx, e, prop, canonical, gotPx) {
  if (!PROP_RE[prop]) return null;
  const decls = ctx.source.declsForEl(e).filter((d) => PROP_RE[prop]?.test(d.prop) && !/:(hover|focus|active|disabled|focus-visible)/.test(d.selector));
  const isCanon = (d) => canonical.some((c) => new RegExp(`^\\.${c}$`).test(d.selector));
  // 1. a literal that renders exactly the measured value; 2. the last section/page
  // override; 3. the last shared rule (source order approximates the cascade).
  const literal = typeof gotPx === 'number'
    ? decls.filter((d) => [...d.value.matchAll(/(-?\d*\.?\d+)(px|rem)\b/g)].some((m) => near(m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16, gotPx, 0.25)))
    : [];
  return literal.at(-1) ?? decls.filter((d) => !isCanon(d)).at(-1) ?? decls.filter(isCanon).at(-1) ?? null;
}

export default {
  id: 'button-consistency',
  defaults: {
    tolerancePx: 0.5,
    severity: null,
    roles: ['button', 'link'],
    allow: [
      { class: 'tp-lost__btn', reason: 'the 404/error fallback must not import the site sheet (apps/web/CLAUDE.md)', compareTo: ['tp-site-btn'] },
      { class: 'tp-payret__open', reason: 'standalone page inlines its own sheet', compareTo: ['tp-site-btn', 'tp-site-btn--lg'] },
      { class: 'tp-minv__open', reason: 'standalone page inlines its own sheet', compareTo: ['tp-site-btn', 'tp-site-btn--lg'] },
      { class: 'tp-clink__open', reason: 'standalone page inlines its own sheet', compareTo: ['tp-site-btn', 'tp-site-btn--lg'] },
      { class: 'tp-tpage__open', reason: 'standalone page inlines its own sheet', compareTo: ['tp-site-btn', 'tp-site-btn--lg'] },
    ],
  },
  run(snapshot, cfg, ctx) {
    const findings = [];
    const info = [];
    const fams = ctx.ds.families;
    const allComp = new Map();
    for (const [f, v] of Object.entries(fams)) for (const c of v.buttons.componentClasses) allComp.set(c, f);
    const groups = new Map();
    const checked = new Set();
    const knownCards = (ctx.config.cards?.known ?? []).map((k) => /^\.([\w-]+)$/.exec(k)?.[1]).filter(Boolean);
    const kindFor = (fam, e, sig) =>
      (fam.buttons.kinds ?? []).find((k) => (k.classes ?? []).some((c) => e.classes.includes(c)) || (k.signatures ?? []).includes(sig)) ?? null;
    for (const it of ctx.uniqueElements(snapshot)) {
      const e = it.rec;
      if (!e.style || e.inline) continue;
      const role = e.kind === 'link' || e.kind === 'button' ? e.kind : null;
      if (!role || !cfg.roles.includes(role)) continue;
      const fam = fams[e.family];
      if (!fam) continue;
      const own = e.classes.filter((c) => fam.buttons.componentClasses.includes(c));
      const foreign = e.classes.filter((c) => allComp.has(c) && allComp.get(c) !== e.family);
      const sig = signatureOf(ctx.source, e);
      const kindDef = own.length || foreign.length ? null : kindFor(fam, e, sig);
      if (!e.hasBox && !own.length && !foreign.length && !kindDef) continue; // a text link, not a button
      if (knownCards.some((k) => e.classes.includes(k))) continue; // a button card: card-consistency judges it
      checked.add(`${it.vp}|${e.key}`);
      const id = `${it.vp}|${e.family}|${sig}`;
      const g = groups.get(id) ?? { vp: it.vp, family: e.family, sig, byDir: new Map(), screens: new Set(), staff: true, own, foreign, kindDef, n: 0 };
      if (!g.byDir.has(e.dir)) g.byDir.set(e.dir, e);
      g.n++;
      it.screens.forEach((s) => g.screens.add(s));
      g.staff = g.staff && it.staffAll;
      groups.set(id, g);
    }

    for (const g of [...groups.values()].sort((a, b) => a.sig.localeCompare(b.sig) || a.vp.localeCompare(b.vp))) {
      const fam = fams[g.family];
      const c = ctx.cfgFor(g.staff);
      const tol = c.tolerancePx;
      const first = g.byDir.get('ltr') ?? g.byDir.get('rtl') ?? [...g.byDir.values()][0];
      const classes = first.classes;
      const allow = c.allow.find((a) => classes.includes(a.class));
      let kind;
      let sev;
      if (g.own.length) [kind, sev] = ['drift', 'warn'];
      else if (g.foreign.length) [kind, sev] = ['foreign', 'error'];
      else if (g.kindDef) [kind, sev] = ['kind', 'warn'];
      else if (allow) [kind, sev] = ['allowed', 'warn'];
      else [kind, sev] = ['hand-built', 'error'];
      const base = kind === 'drift' || kind === 'kind' ? null : (allow?.compareTo ?? [fam.buttons.componentClasses[0]]);
      const canonical = kind === 'kind' ? g.kindDef.classes ?? [] : [...fam.buttons.componentClasses, ...fam.buttons.variantClasses, ...fam.buttons.sizeClasses];
      const fontNames = (fam.tokens.font ?? []);

      const describe = (e) => {
        const rtl = e.dir === 'rtl';
        const tok = ctx.tokensOf(snapshot, g.vp, e);
        const got = measured(e);
        // A <button> in the UA font at the UA size: no rule sets its font.
        const famFonts = fontNames.map((n) => tok[n]).filter(Boolean).map((v) => firstFamily(v).toLowerCase());
        got.uaFont = e.tag === 'button' && famFonts.length > 0 && !famFonts.includes(String(got.fontFamily).toLowerCase()) && near(got.fontSize, 13.333, 0.05);
        const want = kind === 'drift' ? expectedFor(fam, e.classes, rtl) : kind === 'kind' ? expectedForKind(g.kindDef, e.classes, rtl) : expectedFor(fam, base, rtl, base[0]);
        const diffs = diff(got, want, tok, e.rect, tol);
        const out = diffs.map((d) => {
          const s = kind === 'hand-built' || kind === 'foreign' ? null : setter(ctx, e, d.prop, canonical, typeof got[d.prop] === 'number' ? got[d.prop] : null);
          return { prop: d.prop, text: `${LABEL[d.prop] ?? d.prop} ${d.got} (canon ${d.want})${s ? ` set by ${declText(s)}` : ''}` };
        });
        const radiusOk = got.radius === 0 || got.radius >= e.rect.h / 2 - 0.5 || tokenNamed(tok, fam.tokens.radius, got.radius, tol);
        const fsScale = [...fam.tokens.fontSize.map((n) => tok[n]).filter((v) => v != null), ...(fam.rawScale?.fontSize ?? [])];
        if (!radiusOk && !diffs.some((d) => d.prop === 'radius')) out.push({ prop: 'radius*', text: `radius ${r1(got.radius)}px is not a ${fam.label} radius token` });
        if (got.hasText && !fsScale.some((v) => near(v, got.fontSize, tol)) && !diffs.some((d) => d.prop === 'fontSize')) {
          out.push({ prop: 'fontSize*', text: `font size ${r1(got.fontSize)}px${got.typeFrom ? ` (on its label ${got.typeFrom})` : ''} is off the ${fam.label} type scale` });
        }
        return { got, want, out };
      };
      const main = describe(first);
      const other = first.dir !== 'rtl' && g.byDir.get('rtl') ? describe(g.byDir.get('rtl')) : null;
      const extra = other ? other.out.filter((o) => !main.out.some((m) => m.prop === o.prop)) : [];
      if ((kind === 'drift' || kind === 'allowed' || kind === 'kind') && !main.out.length && !extra.length) continue;

      const famBtn = fam.buttons.componentClasses.map((x) => `.${x}`).join('/');
      const head =
        kind === 'hand-built'
          ? `hand-built button, not ${famBtn}`
          : kind === 'foreign'
            ? `uses the other family's ${g.foreign.map((x) => `.${x}`).join('/')} inside the ${fam.label}`
            : kind === 'allowed'
              ? `allowlisted look-alike (${allow.reason}) but differs from ${allow.compareTo.map((x) => `.${x}`).join('')}`
              : kind === 'kind'
                ? `${g.kindDef.label} (its own component, not a text button) differs from the ${g.kindDef.label} canon`
                : 'drifts from its canon';
      const versus = base && kind !== 'allowed' ? ` vs .${base[0]}` : '';
      const body = [...main.out.map((o) => o.text), ...(extra.length ? [`in RTL also ${extra.map((o) => o.text).join(', ')}`] : [])];
      const dirs = [...g.byDir.keys()].sort().join('+');
      const screens = sortScreens([...g.screens]);
      findings.push({
        check: 'button-consistency',
        severity: c.severity ?? sev,
        key: g.sig,
        screen: screens[0] + (screens.length > 1 ? ` (+${screens.length - 1} more)` : ''),
        viewport: g.vp,
        staff: g.staff,
        message: `${g.sig} [${fam.label}, ${dirs}]: ${head}${body.length ? `${versus}: ${body.join('; ')}` : ''}`,
        evidence: { kind, kindId: g.kindDef?.id ?? null, instances: g.n, got: main.got, want: main.want, size: `${r1(first.rect.w)}x${r1(first.rect.h)}`, screens },
        source: sourceText(ctx.source, first).text,
      });
    }
    info.push(`${checked.size} boxed buttons/links (element x viewport) in ${groups.size} style signatures, compared with ${Object.values(fams).map((f) => f.buttons.componentClasses.map((x) => `.${x}`).join('/')).join(' and ')}`);
    return { findings, info };
  },
};
