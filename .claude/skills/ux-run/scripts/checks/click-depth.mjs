/**
 * click-depth: every interactive element must be reachable within maxClicks clicks of the
 * start page (/en). See checks/click-depth.md.
 *
 * Cost: an element first seen on a state d clicks deep costs d + 1 (visible on home = 1).
 * The minimum over every state reached from the start root, per viewport. A disabled
 * control counts as found where it is visible (disabledCountsAsReached, default true): its
 * availability depends on what the guest did, not on navigation. Set it false to measure
 * the clicks until it can actually be pressed.
 *
 * Elements past the crawl's depth: a seed root that is also a page reached from home (the
 * /en/menu seed crawls the café sheets beyond the budget) extends the measurement: cost =
 * home depth of that page + depth inside the seed + 1, with the joined path.
 */
export default {
  id: 'click-depth',
  defaults: { maxClicks: 3, exempt: false, disabledCountsAsReached: true },
  run(snapshot, cfg, ctx) {
    const findings = [];
    const info = [];
    for (const [vpId, vp] of Object.entries(snapshot.viewports)) {
      const best = new Map(); // key -> {cost, path, staff, screen}
      const pageDepth = new Map(); // pathname (layer page) -> {depth, path}
      const consider = (key, cost, path, staff, screen) => {
        const prev = best.get(key);
        if (!prev || cost < prev.cost) best.set(key, { cost, path, staff, screen });
      };
      for (const st of vp.states) {
        if (st.rootKind !== 'start') continue;
        if (st.layer === 'page' && !pageDepth.has(st.pathname)) pageDepth.set(st.pathname, { depth: st.depth, path: st.path });
        for (const fp of st.elements) {
          const e = vp.elements[fp];
          if (!e || (e.disabled && !cfg.disabledCountsAsReached)) continue;
          consider(e.key, st.depth + 1, [...st.path, e.key], st.staff, ctx.screenOf(st));
        }
      }
      const homeKeys = new Set(best.keys());
      const seedOnly = new Map(); // seed root -> Set(keys)
      for (const st of vp.states) {
        if (st.rootKind === 'start') continue;
        const rootPath = vp.roots.find((r) => r.id === st.root)?.path;
        const via = rootPath && pageDepth.get(rootPath);
        for (const fp of st.elements) {
          const e = vp.elements[fp];
          if (!e || (e.disabled && !cfg.disabledCountsAsReached)) continue;
          if (via) {
            consider(e.key, via.depth + st.depth + 1, [...via.path, ...st.path, e.key], st.staff, ctx.screenOf(st));
          } else if (!homeKeys.has(e.key)) {
            if (!seedOnly.has(st.root)) seedOnly.set(st.root, { keys: new Set(), staff: st.staff });
            seedOnly.get(st.root).keys.add(e.key);
          }
        }
      }
      const maxDepth = snapshot.meta.maxDepth;
      for (const [key, b] of [...best].sort((x, y) => y[1].cost - x[1].cost || x[0].localeCompare(y[0]))) {
        const c = ctx.cfgFor(b.staff);
        if (b.staff && c.exempt) continue;
        if (b.cost <= c.maxClicks) continue;
        const lowerBound = b.cost > maxDepth + 1;
        findings.push({
          check: 'click-depth',
          severity: 'error',
          key,
          screen: b.screen,
          viewport: vpId,
          staff: b.staff,
          message: `${key} (${b.cost} clicks): ${b.path.join(' > ')}`,
          evidence: { cost: b.cost, maxClicks: c.maxClicks, viaSeed: lowerBound || undefined },
          path: b.path,
        });
      }
      const seeded = [...seedOnly].map(([root, v]) => `${root}${v.staff ? ' [staff]' : ''} (${v.keys.size})`);
      if (seeded.length) info.push(`[${vpId}] not linked from ${snapshot.meta.startPath}, so no click cost (seeded pages): ${seeded.join(', ')}`);
      info.push(`[${vpId}] ${best.size} elements reachable from ${snapshot.meta.startPath}; deepest ${Math.max(0, ...[...best.values()].map((b) => b.cost))} clicks`);
    }
    return { findings, info };
  },
};
