/**
 * button-size: the real rendered hit area of every tap target, against the family's
 * minimum (site 48 = --tp-site-touch, contracts §5; café 44 = .tp-btn), and size
 * consistency among targets of the same kind. See checks/button-size.md.
 *
 * Hit area = the element's box, grown by a label (radio/checkbox) or by a ::before/::after
 * that deliberately stretches past it (the menu card's stretched link). WCAG 2.5.8's
 * inline exception: a link without a box sitting inside running text is not judged.
 *
 * Findings are grouped by the element's style signature (its tp-* classes, or the
 * contextual rule that styles a classless one) and the failing dimension, so the same
 * undersized pill in /en and /ar, or on twenty menu rows, is one line.
 */
import { componentClass, r1, signatureOf, sortScreens, sourceText } from '../lib/analysis.mjs';

const FIELD = new Set(['input', 'textarea', 'select']);

export default {
  id: 'button-size',
  defaults: {
    minTarget: null,
    sizeTolerancePx: 0.5,
    kindSpreadPx: 2,
    kinds: [
      { name: 'sheet / dialog icon buttons', classes: ['tp-sheet__close', 'tp-itemsheet__expand', 'tp-lightbox__close'] },
      { name: 'quantity and remove steppers', classes: ['tp-qty__step', 'tp-basket-line__remove'] },
    ],
  },
  run(snapshot, cfg, ctx) {
    const findings = [];
    const info = [];
    const items = ctx.uniqueElements(snapshot);
    const fams = ctx.ds.families;
    const sigCache = new Map();
    const sig = (e) => {
      const k = `${e.classes.join('.')}|${e.ancestors?.join('.')}|${e.tag}|${e.dir}`;
      if (!sigCache.has(k)) sigCache.set(k, signatureOf(ctx.source, e));
      return sigCache.get(k);
    };
    const checkedKeys = new Set();
    const inline = new Set();

    // 1. Below the minimum.
    const under = new Map();
    for (const it of items) {
      const e = it.rec;
      if (!e.hit) continue;
      if (e.inline) {
        inline.add(`${it.vp}|${e.key}`);
        continue;
      }
      checkedKeys.add(`${it.vp}|${e.key}`);
      const c = ctx.cfgFor(it.staffAll);
      const fam = fams[e.family];
      const tokMin = fam?.minTargetToken ? ctx.tokensOf(snapshot, it.vp, e)[fam.minTargetToken] : null;
      const min = c.minTarget ?? tokMin ?? fam?.minTarget ?? 44;
      const tol = c.sizeTolerancePx;
      const shortW = e.hit.w < min - tol;
      const shortH = e.hit.h < min - tol;
      if (!shortW && !shortH) continue;
      const s = sig(e);
      const dims = shortW && shortH ? `${r1(e.hit.w)}x${r1(e.hit.h)}` : shortH ? `${r1(e.hit.h)}px tall` : `${r1(e.hit.w)}px wide`;
      const id = `${it.vp}|${e.family}|${s}|${dims}|${it.staffAll}`;
      const u = under.get(id) ?? { vp: it.vp, e, s, dims, min, keys: new Set(), screens: new Set(), staff: it.staffAll };
      u.keys.add(e.key);
      it.screens.forEach((x) => u.screens.add(x));
      under.set(id, u);
    }
    for (const u of [...under.values()].sort((a, b) => a.e.hit.h - b.e.hit.h || a.s.localeCompare(b.s))) {
      const famLabel = fams[u.e.family]?.label ?? u.e.family;
      const keys = [...u.keys].sort();
      const screens = sortScreens([...u.screens]);
      findings.push({
        check: 'button-size',
        severity: 'error',
        key: u.s,
        screen: screens[0] + (screens.length > 1 ? ` (+${screens.length - 1} more)` : ''),
        viewport: u.vp,
        staff: u.staff,
        message: `${u.dims}, below the ${famLabel} minimum ${u.min}x${u.min}${u.e.hit.via !== 'self' ? ` (hit area via ${u.e.hit.via})` : ''}; e.g. ${keys[0]}`,
        evidence: { hit: u.e.hit, rect: u.e.rect, min: u.min, family: u.e.family, keys, screens },
        source: sourceText(ctx.source, u.e).text,
      });
    }

    // 2. Same kind, different size. Only real buttons: boxed, not fields, tabs or summaries,
    // not stretched cards, and not taller than two minimum targets (those are cards whose
    // height follows their content). Height only, both dimensions for icon-only kinds.
    const kindOf = (e) => {
      for (const k of cfg.kinds) if (e.classes.some((c) => k.classes.includes(c))) return { id: `${e.family}|${k.name}`, name: k.name, both: true };
      const comp = componentClass(e.classes);
      if (!comp) return null;
      const mods = e.classes.filter((c) => c.startsWith(`${comp}--`)).sort();
      return { id: `${e.family}|${[comp, ...mods].join('.')}`, name: [comp, ...mods].join('.'), both: comp.includes('iconbtn') };
    };
    const kinds = new Map();
    for (const it of items) {
      const e = it.rec;
      if (!e.hit || e.inline || FIELD.has(e.tag) || e.kind === 'tab' || e.kind === 'summary') continue;
      if (!e.hasBox || e.hit.via !== 'self') continue;
      const famMin = fams[e.family]?.minTarget ?? 44;
      if (e.hit.h > famMin * 2) continue;
      const k = kindOf(e);
      if (!k) continue;
      if (k.both && e.hit.w > e.hit.h * 1.5) continue; // an icon kind re-skinned as a labelled pill: button-consistency reports it
      const g = kinds.get(`${it.vp}|${k.id}`) ?? { vp: it.vp, k, sizes: new Map(), staff: true };
      const h = Math.round(e.hit.h);
      const w = Math.round(e.hit.w);
      const sk = k.both ? `${w}x${h}` : `${h}`;
      const entry = g.sizes.get(sk) ?? { sigs: new Set(), screens: new Set(), h, w, el: e };
      entry.sigs.add(sig(e));
      it.screens.forEach((s) => entry.screens.add(s));
      g.sizes.set(sk, entry);
      g.staff = g.staff && it.staffAll;
      kinds.set(`${it.vp}|${k.id}`, g);
    }
    for (const g of kinds.values()) {
      if (g.sizes.size < 2) continue;
      const vals = [...g.sizes.values()];
      const spread = Math.max(
        Math.max(...vals.map((s) => s.h)) - Math.min(...vals.map((s) => s.h)),
        g.k.both ? Math.max(...vals.map((s) => s.w)) - Math.min(...vals.map((s) => s.w)) : 0,
      );
      if (spread <= cfg.kindSpreadPx) continue;
      const parts = [...g.sizes.entries()].sort((a, b) => a[1].h - b[1].h || a[1].w - b[1].w).map(([sk, s]) => `${sk}${g.k.both ? '' : 'px tall'} (${[...s.sigs].sort().join(', ')})`);
      const screens = sortScreens([...new Set(vals.flatMap((s) => [...s.screens]))]);
      findings.push({
        check: 'button-size',
        severity: 'warn',
        key: `kind:${g.k.name}`,
        screen: screens[0] + (screens.length > 1 ? ` (+${screens.length - 1} more)` : ''),
        viewport: g.vp,
        staff: g.staff,
        message: `${g.k.name} [${fams[g.k.id.split('|')[0]]?.label}]: one kind, ${g.sizes.size} sizes: ${parts.join(' vs ')}`,
        evidence: { sizes: [...g.sizes.entries()].map(([sk, s]) => ({ size: sk, sigs: [...s.sigs], screens: [...s.screens].slice(0, 4) })) },
        source: [...new Set(vals.map((s) => sourceText(ctx.source, s.el).text))].join(' | '),
      });
    }
    info.push(`${checkedKeys.size} targets measured (element x viewport), ${inline.size} inline-in-text links exempt (WCAG 2.5.8)`);
    return { findings, info };
  },
};
