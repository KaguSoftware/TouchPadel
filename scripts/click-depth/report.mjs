/**
 * Click depth — shared verdict + printing for every target.
 *
 * A target module (operator-crawl.mjs, mobile-graph.mjs) returns a TargetResult:
 *
 *   {
 *     elements: Array<{ key: string, cost: number, path: string[] }>,
 *                 // one row per distinct element key, at its MINIMUM cost;
 *                 // `path` is the shortest click path, ending with the key itself
 *     screens:  number,   // distinct screens / states checked
 *     notes:    string[], // crawl caveats worth printing (budget hit, skipped, …)
 *     unreachable?: Array<{ key: string, reason: string }>,
 *                 // things the target knows exist but could not reach at all
 *   }
 *
 * This file turns that into PASS/FAIL against the target's maxClicks + exempt.
 */

/** Exempt entries are exact keys, or /regex/ strings. */
export function compileExempt(list = []) {
  return list.map((entry) => {
    const m = /^\/(.*)\/([a-z]*)$/.exec(entry);
    return m ? new RegExp(m[1], m[2]) : entry;
  });
}

export function isExempt(key, exempt) {
  return exempt.some((e) => (typeof e === 'string' ? e === key : e.test(key)));
}

/** Prints the target's verdict; returns true when it passes. */
export function report(name, cfg, result) {
  const max = cfg.maxClicks;
  const exempt = compileExempt(cfg.exempt);
  const over = result.elements.filter((e) => e.cost > max);
  const violations = over.filter((e) => !isExempt(e.key, exempt));
  const exempted = over.length - violations.length;
  const unreachable = (result.unreachable ?? []).filter((u) => !isExempt(u.key, exempt));

  for (const note of result.notes ?? []) console.log(`NOTE  [${name}] ${note}`);

  if (violations.length === 0 && unreachable.length === 0) {
    const deepest = result.elements.reduce((m, e) => Math.max(m, e.cost), 0);
    console.log(
      `PASS  [${name}] ${result.elements.length} buttons across ${result.screens} screens, ` +
        `all within ${max} clicks (deepest ${deepest})` +
        (exempted ? `, ${exempted} exempt` : '') +
        '.',
    );
    return true;
  }

  if (violations.length) {
    console.log(`FAIL  [${name}] ${violations.length} button(s) take more than ${max} clicks:`);
    violations
      .sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key))
      .forEach((v) => console.log(`        ${v.key} (${v.cost} clicks): ${v.path.join(' > ')}`));
  }
  if (unreachable.length) {
    console.log(`FAIL  [${name}] ${unreachable.length} button(s) are not reachable by clicking at all:`);
    unreachable.forEach((u) => console.log(`        ${u.key}: ${u.reason}`));
  }
  console.log(
    `\n      Checked ${result.elements.length} buttons across ${result.screens} screens. ` +
      `Fix the navigation, or add the key to targets.${name}.exempt in click-depth.config.json.`,
  );
  return false;
}
