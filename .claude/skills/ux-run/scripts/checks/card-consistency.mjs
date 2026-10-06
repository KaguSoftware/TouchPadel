/**
 * card-consistency: every card in a family shares one style, the design system's card
 * (design-system.json families.<f>.card), judged property by property against the canon,
 * not against the majority. See checks/card-consistency.md.
 *
 * Cards come from the crawl (cards.known selectors, plus the surface heuristic: own ground
 * or a full border or a shadow, a radius, text and a child, at least minWidth x minHeight,
 * not a pill, not a control). They are grouped by their component class per family.
 */
import { auditDecls, componentClass, declText, near, r1, sortScreens, sourceText, tokenNamed } from '../lib/analysis.mjs';

const uniq = (arr) => [...new Set(arr)];

export default {
  id: 'card-consistency',
  defaults: { tolerancePx: 0.5, severity: null },
  run(snapshot, cfg, ctx) {
    const findings = [];
    const info = [];
    const groups = new Map();
    for (const it of ctx.uniqueCards(snapshot)) {
      const c = it.rec;
      const comp = componentClass(c.classes) ?? `<${c.tag}>`;
      const id = `${it.vp}|${c.family}|${comp}`;
      const g = groups.get(id) ?? { vp: it.vp, family: c.family, comp, members: [], screens: new Set(), staff: true };
      g.members.push(it);
      it.screens.forEach((s) => g.screens.add(s));
      g.staff = g.staff && it.staffAll;
      groups.set(id, g);
    }
    let judged = 0;
    for (const g of [...groups.values()].sort((a, b) => a.comp.localeCompare(b.comp) || a.vp.localeCompare(b.vp))) {
      const fam = ctx.ds.families[g.family];
      if (!fam?.card) continue;
      judged++;
      const canon = fam.card;
      const c = ctx.cfgFor(g.staff);
      const tol = c.tolerancePx;
      const rep = g.members[0].rec;
      const tok = ctx.tokensOf(snapshot, g.vp, rep);
      const colorNames = Object.values(fam.tokens.colors);
      const radiusNames = fam.tokens.radius;
      const issues = [];
      let sev = 'warn';
      const st = rep.style;

      // Border.
      const bw = st.borderWidth;
      const fullBorder = bw.every((w) => near(w, canon.borderWidth, tol)) && st.borderStyle.every((s) => s === 'solid');
      if (!fullBorder) {
        const desc = bw.every((w) => w === 0) ? 'no border' : `border ${uniq(bw.map(r1)).join('/')}px ${uniq(st.borderStyle).join('/')}`;
        issues.push(`${desc} (canon ${canon.borderWidth}px solid ${canon.borderColorToken})`);
      } else if (tok[canon.borderColorToken] && st.borderColor[0] !== tok[canon.borderColorToken]) {
        const named = tokenNamed(tok, colorNames, st.borderColor[0]);
        issues.push(`border colour ${named ?? st.borderColor[0]} (canon ${canon.borderColorToken})`);
      }
      // Ground.
      if (tok[canon.backgroundToken] && st.bg !== tok[canon.backgroundToken]) {
        const named = tokenNamed(tok, colorNames, st.bg);
        issues.push(`ground ${named ?? st.bg} (canon ${canon.backgroundToken})`);
      }
      // Radius.
      const want = tok[canon.radiusToken];
      const radii = uniq(st.radius.map((x) => +x.toFixed(1)));
      if (!(radii.length === 1 && near(radii[0], want, tol))) {
        const onScale = radii.every((x) => tokenNamed(tok, radiusNames, x, tol));
        const label = radii.map((x) => `${r1(x)}px${tokenNamed(tok, radiusNames, x, tol) ? ` (${tokenNamed(tok, radiusNames, x, tol)})` : ''}`).join('/');
        issues.push(`radius ${label} (canon ${r1(want)}px ${canon.radiusToken})`);
        if (!onScale) sev = 'error';
      }
      // Padding.
      const pads = st.padding;
      const badPad = pads.filter((p) => p < canon.paddingMin - tol || p > canon.paddingMax + tol);
      if (badPad.length) issues.push(`padding ${uniq(pads.map(r1)).join('/')}px (canon ${canon.paddingMin}-${canon.paddingMax}px)`);
      // Elevation.
      if (canon.shadow === 'none' && st.shadow && st.shadow !== 'none') issues.push('shadow (canon: border first, shadow only on overlays, style reference §8.3)');

      // Members of one component that disagree with each other.
      const variance = [];
      const prop = (name, f) => {
        const vals = uniq(g.members.map((m) => f(m.rec.style)));
        if (vals.length > 1) variance.push(`${name} ${vals.join(' vs ')}`);
      };
      prop('radius', (s) => s.radius.map(r1).join('/'));
      prop('border', (s) => s.borderWidth.map(r1).join('/'));
      prop('ground', (s) => s.bg);
      prop('shadow', (s) => (s.shadow === 'none' ? 'none' : 'shadow'));
      if (variance.length) issues.push(`instances differ: ${variance.join('; ')}`);

      // Source: undefined tokens, the other family's tokens, raw literals.
      const decls = auditDecls(ctx, rep, g.family);
      const bad = decls.filter((d) => d.kind === 'undefined' || d.kind === 'foreign');
      for (const d of bad) {
        issues.push(d.kind === 'undefined' ? `${d.token} is not defined for the ${fam.label} (renders as the initial value): ${declText(d)}` : `${d.token} is the other family's token (contracts §2): ${declText(d)}`);
        sev = 'error';
      }
      const raw = decls.filter((d) => d.kind === 'raw' && (/radius/.test(d.prop) || (g.family === 'cafe' && /padding/.test(d.prop))));
      for (const d of raw) issues.push(`raw literal, not a token: ${declText(d)}`);

      if (!issues.length) continue;
      const isReference = canon.reference.includes(g.comp);
      const src = sourceText(ctx.source, rep);
      const sevOut = c.severity ?? sev;
      findings.push({
        check: 'card-consistency',
        severity: sevOut,
        key: `.${g.comp}`,
        screen: sortScreens([...g.screens])[0] + (g.screens.size > 1 ? ` (+${g.screens.size - 1} more)` : ''),
        viewport: g.vp,
        staff: g.staff,
        message: `.${g.comp} [${fam.label}${isReference ? ', reference card' : ''}]: ${issues.join('; ')}`,
        evidence: {
          family: g.family,
          instances: g.members.length,
          size: `${r1(rep.rect.w)}x${r1(rep.rect.h)}`,
          style: { radius: st.radius, padding: st.padding, border: st.borderWidth, bg: st.bg, shadow: st.shadow },
          canon: { ...canon, resolved: { radius: want, border: tok[canon.borderColorToken], ground: tok[canon.backgroundToken] } },
        },
        source: src.text,
      });
    }
    info.push(`${judged} card components judged (per viewport), canon: ${Object.entries(ctx.ds.families).map(([f, v]) => `${v.label} ${v.card.reference.map((r) => `.${r}`).join('/')}`).join(', ')}`);
    return { findings, info };
  },
};

