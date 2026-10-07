/**
 * Source index: maps a rendered `tp-*` class back to the line that styles it and the
 * component that renders it.
 *
 * Why it exists: apps/web styles everything with hand-written BEM classes in template-string
 * CSS (src/styles/**\/*.css.ts, inlined as <style>), with no CSS modules, no hashing and no
 * debug ids. So "where does this button come from" can only be answered statically: the
 * index parses every *.css.ts rule (selector, line, declarations) and greps every .tsx for
 * the class. It also knows every custom property the CSS declares locally, which the token
 * audit needs to tell a local helper var (--tp-btn-hover) from an undefined token
 * (--tp-radius-ctl on a café page).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const CLASS_RE = /\.(tp-[A-Za-z0-9_-]+)/g;

function walk(dir, test, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

/** Blank /* comments *\/ (keeping newlines, so offsets still map to lines). */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Split at top-level commas (not inside parentheses). */
function splitTop(s, ch) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ch && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * Normalise a selector the way page-probe.mjs normalises the CSSOM's selectorText (keep the
 * two in step): one space, double quotes, quoted attribute values, no space around
 * combinators and commas or inside parentheses.
 */
export function normSel(x) {
  return x
    .replace(/\s+/g, ' ')
    .replace(/'/g, '"')
    .replace(/\[\s*([\w-]+)\s*([~|^$*]?=)\s*"?([^"\]]*?)"?\s*\]/g, '[$1$2"$3"]')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/(^|[ >+~(,])\*(?=[:.\[#])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

/** The last compound of a complex selector (the element the rule styles). */
function subjectOf(sel) {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) last = i + 1;
  }
  return sel.slice(last).trim();
}

/**
 * Parse one *.css.ts file: every template literal is CSS. Returns rules with
 * { file, line, selector, selectors[], media, decls: [{prop, value, line}] }.
 */
export function parseCssTs(file, root) {
  const raw = readFileSync(file, 'utf8');
  const text = blankComments(raw);
  const rel = path.relative(root, file);
  const lineAt = (() => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return (off) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= off) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };
  })();
  const rules = [];
  const localVars = new Map(); // --name -> [{file, line}]
  // Template literal regions.
  const regions = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') continue;
    let j = i + 1;
    while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
    regions.push([i + 1, j]);
    i = j;
  }
  for (const [a, b] of regions) {
    const stack = [];
    let selStart = a;
    for (let i = a; i < b; i++) {
      const c = text[i];
      if (c === '{') {
        const selector = text.slice(selStart, i).trim();
        const line = lineAt(selStart + (text.slice(selStart, i).length - text.slice(selStart, i).trimStart().length));
        if (selector.startsWith('@')) stack.push({ at: selector });
        else stack.push({ selector, line, bodyStart: i + 1 });
        selStart = i + 1;
      } else if (c === '}') {
        const top = stack.pop();
        if (top && !top.at) {
          const body = text.slice(top.bodyStart, i);
          const decls = [];
          let off = top.bodyStart;
          for (const part of body.split(';')) {
            const m = /^(\s*)([-A-Za-z]+)\s*:\s*([\s\S]*)$/.exec(part);
            if (m) {
              const prop = m[2].toLowerCase();
              const value = m[3].trim();
              const declLine = lineAt(off + m[1].length);
              decls.push({ prop, value, line: declLine });
              if (prop.startsWith('--tp-')) {
                if (!localVars.has(prop)) localVars.set(prop, []);
                localVars.get(prop).push({ file: rel, line: declLine });
              }
            }
            off += part.length + 1;
          }
          const media = stack.filter((s) => s.at).map((s) => s.at);
          rules.push({ file: rel, line: top.line, selector: top.selector.replace(/\s+/g, ' '), selectors: splitTop(top.selector.replace(/\s+/g, ' '), ','), media, decls });
        }
        selStart = i + 1;
      } else if (c === ';' && (stack.length === 0 || stack[stack.length - 1].at)) {
        selStart = i + 1;
      }
    }
  }
  return { rules, localVars };
}

/**
 * Build the index. `root` is the repo root.
 *   rulesByClass:  class -> rules whose SUBJECT compound carries the class
 *   ownRule(cls):  the rule whose subject is exactly `.cls` (optionally with pseudo/attr), first one
 *   jsxByClass:    class -> [{file, line}] in .tsx (tests excluded)
 *   localVars:     custom properties declared somewhere in the web CSS
 *   familyOfFile:  'padel' for styles/site, 'cafe' for styles/cafe, null otherwise
 */
export function buildSourceIndex(root) {
  const web = path.join(root, 'apps/web');
  const cssFiles = [
    ...walk(path.join(web, 'src'), (f) => f.endsWith('.css.ts') && !f.includes('.test.')),
  ];
  const allRules = [];
  const localVars = new Map();
  for (const f of cssFiles) {
    const { rules, localVars: lv } = parseCssTs(f, root);
    allRules.push(...rules);
    for (const [k, v] of lv) localVars.set(k, [...(localVars.get(k) ?? []), ...v]);
  }
  const rulesByClass = new Map();
  const contextRules = []; // subject has no class: `.tp-cattabs button`, `.tp-site-tools > *`
  for (const rule of allRules) {
    for (const sel of rule.selectors) {
      const subject = subjectOf(sel);
      if (!/\.tp-/.test(subject) && /\.tp-/.test(sel)) {
        const tag = /^([a-z][a-z0-9]*|\*)/i.exec(subject)?.[1]?.toLowerCase() ?? '*';
        // :where(.tp-site) a is a zero-specificity reset, not the element's own styling.
        const strong = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
        contextRules.push({ ...rule, subjectSel: sel, tag, context: [...sel.matchAll(CLASS_RE)].map((m) => m[1]), reset: !/\.tp-/.test(strong) });
      }
      for (const m of subject.matchAll(CLASS_RE)) {
        const cls = m[1];
        if (!rulesByClass.has(cls)) rulesByClass.set(cls, []);
        const exact = new RegExp(`^\\.${cls.replace(/[-]/g, '\\-')}((:{1,2}[-a-z]+(\\([^)]*\\))?)|\\[[^\\]]*\\])*$`).test(subject);
        rulesByClass.get(cls).push({ ...rule, subjectSel: sel, exact });
      }
    }
  }
  const tsx = walk(web, (f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.includes(`${path.sep}test${path.sep}`));
  const tsxLines = tsx.map((f) => ({ file: path.relative(root, f), lines: readFileSync(f, 'utf8').split(/\r?\n/) }));
  const tsxText = new Map(tsxLines.map((t) => [t.file, t.lines.join('\n')]));
  const jsxCache = new Map();
  const jsxByClass = (cls) => {
    if (jsxCache.has(cls)) return jsxCache.get(cls);
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${cls.replace(/[-]/g, '\\-')}($|[^A-Za-z0-9_-])`);
    const hits = [];
    for (const { file, lines } of tsxLines) {
      lines.forEach((l, i) => {
        if (re.test(l) && !/^\s*(\/\/|\*)/.test(l)) hits.push({ file, line: i + 1 });
      });
    }
    jsxCache.set(cls, hits);
    return hits;
  };

  const familyOfFile = (file) =>
    file.includes('/styles/site/') ? 'padel' : file.includes('/styles/cafe/') ? 'cafe' : null;

  /**
   * Live-stylesheet filter. The crawl records, per page, every selector its stylesheets
   * hold (setCssSets). A rule is attributed to an element only when its selector was live on
   * the element's page; a selector built with \${...} cannot be compared and is kept.
   */
  let cssSets = new Map();
  function setCssSets(sets) {
    cssSets = new Map(Object.entries(sets ?? {}).map(([id, list]) => [id, new Set(list)]));
  }
  const live = (rule, cssId) => {
    if (!cssId || !cssSets.has(cssId)) return true;
    if (rule.subjectSel.includes('${')) return true;
    rule.norm ??= normSel(rule.subjectSel);
    return cssSets.get(cssId).has(rule.norm);
  };

  function ownRule(cls, cssId = null) {
    const rules = (rulesByClass.get(cls) ?? []).filter((r) => live(r, cssId));
    return rules.find((r) => r.exact && !/:(hover|focus|active|focus-visible|disabled)/.test(r.subjectSel) && !r.media.length) ?? rules.find((r) => r.exact) ?? rules[0] ?? null;
  }

  /**
   * Where an element's look comes from. Classes in DOM order; the first one that has
   * its own rule is the "component" class. The JSX site is taken from the most specific
   * class (fewest .tsx hits), which is usually the one a single component writes.
   */
  function resolve(classes, ancestors = [], cssId = null) {
    const tp = classes.filter((c) => c.startsWith('tp-'));
    let primary = null;
    for (const c of tp) {
      const r = ownRule(c, cssId);
      if (r) {
        primary = { cls: c, file: r.file, line: r.line, selector: r.subjectSel };
        break;
      }
    }
    const rules = tp.map((c) => ({ cls: c, rule: ownRule(c, cssId) })).filter((x) => x.rule);
    // The JSX line: among lines naming the most specific class, prefer the one naming the
    // most of the element's other classes, in a file that also names a near ancestor.
    let jsx = null;
    let best = Infinity;
    let spec = null;
    for (const c of tp) {
      const hits = jsxByClass(c);
      if (hits.length && hits.length < best) {
        best = hits.length;
        spec = { c, hits };
      }
    }
    if (spec) {
      const near = ancestors.slice(0, 4);
      let top = null;
      for (const h of spec.hits) {
        const text = tsxText.get(h.file) ?? '';
        const line = text.split(/\r?\n/)[h.line - 1] ?? '';
        const score = tp.filter((c) => line.includes(c)).length + (near.some((a) => text.includes(a)) ? 0.5 : 0);
        if (!top || score > top.score) top = { ...h, score };
      }
      jsx = { cls: spec.c, file: top.file, line: top.line, more: spec.hits.length - 1 };
    }
    return { primary, jsx, rules: rules.map((x) => ({ cls: x.cls, file: x.rule.file, line: x.rule.line })) };
  }

  /**
   * Does a selector plausibly apply to this element? Every class it names must be on the
   * element or an ancestor, and a [dir='rtl'] context only applies in RTL. Pseudo-element
   * rules (::before) never style the element's own box.
   */
  function applies(sel, el) {
    if (sel.includes('::')) return false;
    const have = new Set([...(el.classes ?? []), ...(el.ancestors ?? [])]);
    for (const m of sel.matchAll(CLASS_RE)) if (!have.has(m[1])) return false;
    if (/\[dir=['"]?rtl/.test(sel) && el.dir !== 'rtl') return false;
    if (/\[dir=['"]?ltr/.test(sel) && el.dir === 'rtl') return false;
    return true;
  }

  /** Contextual rules (tag/universal subject) that apply to the element, most specific first. */
  function contextFor(el) {
    return contextRules
      .filter((r) => (r.tag === '*' || r.tag === el.tag) && applies(r.subjectSel, el) && live(r, el.css))
      .sort((a, b) => a.reset - b.reset || (a.tag === '*') - (b.tag === '*') || b.context.length - a.context.length);
  }

  /**
   * resolve() for a recorded element: its own classes first; a classless element falls back
   * to the contextual rule that styles it (`.tp-legal__nav a`) and the JSX that renders the
   * nearest ancestor class.
   */
  function resolveEl(el) {
    const own = resolve(el.classes ?? [], el.ancestors ?? [], el.css ?? null);
    if (own.primary) return own;
    const ctxRule = contextFor(el).find((r) => !r.reset && !/:(hover|focus|active)/.test(r.subjectSel));
    let jsx = null;
    for (const c of el.ancestors ?? []) {
      const hits = jsxByClass(c);
      if (hits.length) {
        jsx = { cls: c, ...hits[0], more: hits.length - 1 };
        break;
      }
    }
    return {
      primary: ctxRule ? { cls: null, file: ctxRule.file, line: ctxRule.line, selector: ctxRule.subjectSel } : null,
      jsx,
      rules: [],
      context: ctxRule?.subjectSel ?? null,
    };
  }

  /** Declarations that apply to the element: its classes' rules plus contextual rules. */
  function declsForEl(el) {
    const own = (el.classes ?? [])
      .filter((c) => c.startsWith('tp-'))
      .flatMap((c) => (rulesByClass.get(c) ?? []).filter((r) => applies(r.subjectSel, el) && live(r, el.css)).flatMap((r) => r.decls.map((d) => ({ ...d, file: r.file, selector: r.subjectSel }))));
    const ctx = contextFor(el).flatMap((r) => r.decls.map((d) => ({ ...d, file: r.file, selector: r.subjectSel })));
    return [...own, ...ctx];
  }

  /** Every declaration that styles `cls` (own and compound rules), for raw-literal audits. */
  function declsFor(cls) {
    return (rulesByClass.get(cls) ?? []).flatMap((r) => r.decls.map((d) => ({ ...d, file: r.file, selector: r.subjectSel })));
  }

  return { rules: allRules, rulesByClass, contextRules, localVars, ownRule, resolve, resolveEl, declsFor, declsForEl, applies, jsxByClass, familyOfFile, setCssSets };
}

/** "file:line" short form used in reports. */
export const loc = (s) => (s ? `${s.file}:${s.line}` : '?');
