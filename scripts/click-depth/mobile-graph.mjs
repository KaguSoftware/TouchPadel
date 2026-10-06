/**
 * Click depth, mobile target — a STATIC route graph over apps/mobile.
 *
 * WHY STATIC. The guest app is Expo + expo-router with no web target, so there
 * is nothing a browser can click. Instead this reads the source with the
 * TypeScript parser (no type checker: parse only, so it runs in seconds) and
 * rebuilds what a phone would offer:
 *
 *   screens   every route file under apps/mobile/app (layouts are nodes too:
 *             the tab bar lives in (tabs)/_layout and is visible from every
 *             tab, so a layout's depth is the cheapest of its children's).
 *   elements  every interactive JSX element with a testID that a screen
 *             renders, following the component tree through apps/mobile/src
 *             per call site, so a wrapper that forwards `testID={testID}` or
 *             `${testID}.<child>` yields the CALLER's id (CLAUDE.md: shared
 *             components never mint ids, they forward them).
 *   edges     an element whose handler (followed through props, local
 *             functions, hooks and helpers that return hrefs) calls
 *             router.push / replace / navigate / dismissTo makes the target
 *             route reachable at the element's cost.
 *   overlays  an element inside a react-native <Modal>, a *Sheet/*Modal/
 *             *Dialog/*Menu/*Popover component, or a branch shown only after a
 *             press flips some useState (or a hook's state) costs one more
 *             click than the element that opens it.
 *
 * Cost of an element = depth(screen) + 1 (+1 per overlay). Roots are depth 0:
 * the guest Book tab and the staff hub (a staff session is redirected off the
 * tabs to /staff by GuestTabsGate, so staff never start on Book).
 *
 * What it deliberately does NOT model: auth and role. Both branches of every
 * signed-in / signed-out / staff / coach condition are rendered at once, and
 * gates' <Redirect>s are not presses, so they are not edges. Platform: both
 * sides of `Platform.OS === …` are rendered; file resolution prefers
 * `.android.tsx` (cfg.platform) because the iOS tab bar is NativeTabs, which
 * has no testIDs to count. Details and the honest gaps are in the notes the
 * target returns and in scripts/click-depth/report.mjs's verdict.
 *
 * Contract: `analyseMobile(name, cfg)` resolves to a TargetResult (see
 * report.mjs). It never prints verdicts or exits.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** CLAUDE.md's route-name spellings (`<route>.<element>` testIDs use these). */
const ROUTE_ALIASES = {
  '(tabs)/index': 'book',
  '(tabs)/_layout': 'tabs',
  'booking/[id]': 'booking-detail',
  'match/[id]': 'match-detail',
  'm/[token]': 'match-link',
  'coach/[id]': 'coach-detail',
  'class/[id]': 'class-detail',
  'lesson/[id]': 'lesson-detail',
};

/** react-native / expo primitives that are pressable on their own. */
const INTERACTIVE = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TextInput',
  'Switch',
  'Link',
  'AppleAuthenticationButton',
]);

/** A component by this name is an overlay: its content needs an opener press. */
const OVERLAY_NAME = /(Sheet|Modal|Dialog|Popover|Menu|Drawer)$/;

/** Handler props that never navigate on a press (layout, scroll, lifecycle). */
const NOT_A_PRESS =
  /^on(Layout|Scroll|ScrollBeginDrag|ScrollEndDrag|MomentumScroll\w*|ContentSizeChange|Load\w*|Error|TextLayout|RequestClose|Dismiss|Show|AnimationEnd|ViewableItemsChanged|EndReached|Refresh|BusyChange|Ready|Closed|Painted|Frame\w*)$/;

const NAV_CALL = /^(router|navigation)\.(push|replace|navigate|dismissTo)$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UNKNOWN = Object.freeze({ t: 'unknown' });
const HOLE = ':id';

/** Stable keys: UUIDs → ':id', digit runs → ':n'. */
export function normaliseKey(key) {
  return key.replace(UUID, ':id').replace(/\d+/g, ':n');
}

// ─── scopes ────────────────────────────────────────────────────────────────

class Env {
  constructor(parent, mod) {
    this.parent = parent;
    this.mod = mod ?? parent?.mod;
    this.vars = new Map();
    this.memo = new Map();
    this.inflight = new Set();
  }
  lookup(name) {
    for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
    return undefined;
  }
}

const isFnLike = (n) =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

const isHookName = (s) => /^use[A-Z0-9]/.test(s);

function calleeName(call) {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return '';
}

function strip(e) {
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isSatisfiesExpression?.(e) ||
      ts.isAwaitExpression(e))
  )
    e = e.expression;
  return e;
}

const jsxCache = new WeakMap();
function containsJsx(node) {
  if (jsxCache.has(node)) return jsxCache.get(node);
  let found = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
  if (!found) ts.forEachChild(node, (c) => (found ||= containsJsx(c)));
  jsxCache.set(node, found);
  return found;
}

// ─── the project: modules, imports, exports, value resolution ─────────────

class Project {
  constructor(appRoot, platform) {
    this.appRoot = appRoot;
    this.platform = platform;
    this.mods = new Map();
    this.paths = readPaths(appRoot);
    this.depthCap = 60;
  }

  inProject(file) {
    return file.startsWith(this.appRoot + sep) && !file.includes(`${sep}node_modules${sep}`);
  }

  load(file) {
    if (!file) return null;
    if (!this.mods.has(file)) this.mods.set(file, new Mod(this, file));
    return this.mods.get(file);
  }

  resolveSpecifier(from, spec) {
    let base = null;
    if (spec.startsWith('.')) base = resolvePath(dirname(from), spec);
    else
      for (const [pattern, targets] of this.paths) {
        const m = pattern.exec(spec);
        if (m) base = resolvePath(this.appRoot, targets[0].replace('*', m[1] ?? ''));
      }
    if (!base) return null;
    const p = this.platform;
    const exts = [`.${p}.tsx`, `.${p}.ts`, '.native.tsx', '.native.ts', '.tsx', '.ts', '.jsx', '.js'];
    for (const cand of [...exts.map((x) => base + x), ...exts.map((x) => join(base, 'index' + x)), base]) {
      if (existsSync(cand) && statSync(cand).isFile() && !cand.endsWith('.d.ts'))
        return this.inProject(cand) ? cand : null;
    }
    return null;
  }

  // Values: str | lit | obj | arr | fn | jsx | props | children | state | hookfn | ext | ns | unknown

  resolveBinding(b, depth = 0) {
    if (!b || depth > this.depthCap) return [UNKNOWN];
    switch (b.k) {
      case 'expr':
        return this.resolve(b.expr, b.env, depth + 1);
      case 'fn':
        return [{ t: 'fn', node: b.node, env: b.env }];
      case 'import': {
        const mod = this.load(b.file);
        const eb = mod?.exportBinding(b.name);
        return eb ? this.resolveBinding(eb, depth + 1) : [UNKNOWN];
      }
      case 'ext':
        return [{ t: 'ext', module: b.module, name: b.name }];
      case 'ns':
        return [{ t: 'ns', file: b.file }];
      case 'state':
        return [{ t: 'state', tok: b.tok, setter: b.setter }];
      case 'destr': {
        const out = b.hook ? [{ t: 'hookfn', tok: b.hook }] : [];
        const got = this.resolveBinding(b.base, depth + 1).flatMap((v) => this.member(v, b.key, depth + 1));
        out.push(...got);
        if (b.dflt && got.length === 0) out.push(...this.resolve(b.dflt.expr, b.dflt.env, depth + 1));
        return out;
      }
      case 'rest':
        return this.resolveBinding(b.base, depth + 1);
      case 'val':
        return [b.value];
      case 'absent':
        return b.dflt ? this.resolve(b.dflt.expr, b.dflt.env, depth + 1) : [];
      case 'param':
        return b.dflt ? [UNKNOWN, ...this.resolve(b.dflt.expr, b.dflt.env, depth + 1)] : [UNKNOWN];
      default:
        return [UNKNOWN];
    }
  }

  member(v, key, depth = 0) {
    switch (v.t) {
      case 'obj':
        return this.getProp(v.node, key, v.env, depth + 1);
      case 'props': {
        if (v.map.has(key)) return this.resolveBinding(v.map.get(key), depth + 1);
        let unknown = false;
        for (const s of v.spreads) {
          const got = this.resolve(s.expr, s.env, depth + 1).flatMap((sv) => this.member(sv, key, depth + 1));
          const known = got.filter((g) => g.t !== 'unknown');
          if (known.length) return known;
          if (got.length) unknown = true;
        }
        return unknown ? [UNKNOWN] : [];
      }
      case 'arr': {
        const i = Number(key);
        const el = Number.isInteger(i) ? v.node.elements[i] : undefined;
        return el ? this.resolve(el, v.env, depth + 1) : [UNKNOWN];
      }
      case 'ns': {
        const eb = this.load(v.file)?.exportBinding(key);
        return eb ? this.resolveBinding(eb, depth + 1) : [UNKNOWN];
      }
      case 'ext':
        return [{ t: 'ext', module: v.module, name: v.name ? `${v.name}.${key}` : key }];
      case 'hookfn':
        return [];
      default:
        return [UNKNOWN];
    }
  }

  getProp(objNode, key, env, depth) {
    let unknown = false;
    const props = objNode.properties;
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (ts.isSpreadAssignment(p)) {
        const got = this.resolve(p.expression, env, depth + 1).flatMap((v) => this.member(v, key, depth + 1));
        const known = got.filter((g) => g.t !== 'unknown');
        if (known.length) return known;
        if (got.length) unknown = true;
        continue;
      }
      const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null);
      if (name !== key) continue;
      if (ts.isPropertyAssignment(p)) return this.resolve(p.initializer, env, depth + 1);
      if (ts.isShorthandPropertyAssignment(p)) return this.resolve(p.name, env, depth + 1);
      if (ts.isMethodDeclaration(p)) return [{ t: 'fn', node: p, env }];
    }
    return unknown ? [UNKNOWN] : [];
  }

  resolve(expr, env, depth = 0) {
    if (!expr) return [];
    if (depth > this.depthCap) return [UNKNOWN];
    if (env.memo.has(expr)) return env.memo.get(expr);
    if (env.inflight.has(expr)) return [UNKNOWN];
    env.inflight.add(expr);
    const out = dedupe(this.resolveUncached(expr, env, depth)).slice(0, 48);
    env.inflight.delete(expr);
    env.memo.set(expr, out);
    return out;
  }

  resolveUncached(expr, env, depth) {
    const e = strip(expr);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [{ t: 'str', s: e.text }];
    if (ts.isNumericLiteral(e)) return [{ t: 'str', s: e.text }];
    if (e.kind === ts.SyntaxKind.TrueKeyword) return [{ t: 'lit', v: true }];
    if (e.kind === ts.SyntaxKind.FalseKeyword) return [{ t: 'lit', v: false }];
    if (e.kind === ts.SyntaxKind.NullKeyword) return [];
    if (ts.isTemplateExpression(e)) return this.template(e, env, depth);
    if (ts.isIdentifier(e)) {
      if (e.text === 'undefined') return [];
      const b = env.lookup(e.text);
      return b ? this.resolveBinding(b, depth + 1) : [UNKNOWN];
    }
    if (ts.isPropertyAccessExpression(e))
      return this.resolve(e.expression, env, depth + 1).flatMap((v) => this.member(v, e.name.text, depth + 1));
    if (ts.isElementAccessExpression(e)) {
      const arg = strip(e.argumentExpression);
      const base = this.resolve(e.expression, env, depth + 1);
      if (arg && (ts.isStringLiteral(arg) || ts.isNumericLiteral(arg)))
        return base.flatMap((v) => this.member(v, arg.text, depth + 1));
      // A lookup table indexed by a runtime key: every entry is a candidate.
      return base.flatMap((v) => {
        if (v.t === 'obj')
          return v.node.properties.flatMap((p) =>
            ts.isPropertyAssignment(p) ? this.resolve(p.initializer, v.env, depth + 1) : [],
          );
        if (v.t === 'arr') return v.node.elements.flatMap((el) => this.resolve(el, v.env, depth + 1));
        return [UNKNOWN];
      });
    }
    if (ts.isCallExpression(e)) return this.evalCall(e, env, depth);
    if (ts.isConditionalExpression(e))
      return [...this.resolve(e.whenTrue, env, depth + 1), ...this.resolve(e.whenFalse, env, depth + 1)];
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
        return [...this.resolve(e.left, env, depth + 1), ...this.resolve(e.right, env, depth + 1)];
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return this.resolve(e.right, env, depth + 1);
      if (op === ts.SyntaxKind.PlusToken) {
        const l = this.resolve(e.left, env, depth + 1);
        const r = this.resolve(e.right, env, depth + 1);
        return concatStrings([l, r]);
      }
      return [UNKNOWN];
    }
    if (isFnLike(e)) return [{ t: 'fn', node: e, env }];
    if (ts.isObjectLiteralExpression(e)) return [{ t: 'obj', node: e, env }];
    if (ts.isArrayLiteralExpression(e)) return [{ t: 'arr', node: e, env }];
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return [{ t: 'jsx', node: e, env }];
    return [UNKNOWN];
  }

  template(e, env, depth) {
    const parts = [[{ t: 'str', s: e.head.text }]];
    for (const span of e.templateSpans) {
      let vals = this.resolve(span.expression, env, depth + 1);
      const strs = vals.filter((v) => v.t === 'str');
      // An id we cannot know statically is a hole; a small closed set is spelled out.
      vals = strs.length && strs.length === vals.length && strs.length <= 12 ? strs : [{ t: 'str', s: HOLE }];
      parts.push(vals, [{ t: 'str', s: span.literal.text }]);
    }
    return concatStrings(parts);
  }

  evalCall(call, env, depth) {
    const name = calleeName(call);
    const args = call.arguments;
    const callee = call.expression;
    // Array plumbing that keeps the elements: the receiver stands in for the result.
    if (ts.isPropertyAccessExpression(callee) && ['filter', 'slice', 'sort', 'reverse', 'toSorted'].includes(name))
      return this.resolve(callee.expression, env, depth + 1).filter((v) => v.t === 'arr' || v.t === 'unknown');
    const out = [];
    for (const v of this.resolve(callee, env, depth + 1)) {
      if (v.t === 'ext') {
        const last = v.name.split('.').pop();
        if (last === 'useCallback' || last === 'memo' || last === 'forwardRef')
          out.push(...this.resolve(args[0], env, depth + 1));
        else if (last === 'useMemo')
          out.push(
            ...this.resolve(args[0], env, depth + 1).flatMap((f) =>
              f.t === 'fn' ? this.returnsOf(f, [], depth + 1) : [UNKNOWN],
            ),
          );
        else if (last === 'useRouter') out.push({ t: 'ext', module: 'expo-router', name: 'router' });
        else if (last === 'useNavigation') out.push({ t: 'ext', module: 'expo-router', name: 'navigation' });
        else out.push(UNKNOWN);
      } else if (v.t === 'fn') {
        out.push(...this.returnsOf(v, args.map((a) => ({ k: 'expr', expr: a, env })), depth + 1));
      } else out.push(UNKNOWN);
    }
    return out;
  }

  returnsOf(fnv, args, depth) {
    if (depth > this.depthCap || !fnv.node.body) return [UNKNOWN];
    const fenv = this.fnEnv(fnv.node, fnv.env, args);
    const body = fnv.node.body;
    if (!ts.isBlock(body)) return this.resolve(body, fenv, depth + 1);
    const out = [];
    walkOwn(body, (n) => {
      if (ts.isReturnStatement(n) && n.expression) out.push(...this.resolve(n.expression, fenv, depth + 1));
    });
    return out;
  }

  /** A function's scope: params bound to `args` (null = unknown callers), then its own declarations. */
  fnEnv(node, parent, args) {
    const env = new Env(parent);
    node.parameters?.forEach((p, i) => {
      const dflt = p.initializer ? { expr: p.initializer, env } : undefined;
      let src;
      if (args === null) src = { k: 'param', dflt };
      else if (args[i]) src = args[i];
      else src = { k: 'absent', dflt };
      if (src.k !== 'param' && src.k !== 'absent' && dflt) src = { k: 'withDefault', main: src, dflt };
      bindPattern(p.name, src.k === 'withDefault' ? defaulted(src) : src, env);
    });
    if (node.body && ts.isBlock(node.body)) collectDecls(node.body, env);
    return env;
  }
}

/** `{ x = 'a' }` style defaults over a known source: the default fills only an absent value. */
function defaulted(src) {
  return { k: 'destr', base: { k: 'val', value: { t: 'props', map: new Map([['v', src.main]]), spreads: [] } }, key: 'v', dflt: src.dflt };
}

function dedupe(vals) {
  const seen = new Set();
  return vals.filter((v) => {
    const id = v.t === 'str' ? `s:${v.s}` : v.t === 'unknown' ? 'u' : null;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function concatStrings(parts) {
  let acc = [''];
  for (const vals of parts) {
    const strs = vals.filter((v) => v.t === 'str').map((v) => v.s);
    if (strs.length !== vals.length || strs.length === 0) return [UNKNOWN];
    const next = [];
    for (const a of acc) for (const s of strs) next.push(a + s);
    acc = next.length > 24 ? [...new Set(next.map(() => HOLE))] : next;
  }
  return acc.map((s) => ({ t: 'str', s }));
}

/** Visits a function body without entering nested functions. */
function walkOwn(node, fn) {
  ts.forEachChild(node, (c) => {
    if (isFnLike(c) || ts.isClassLike(c)) return;
    fn(c);
    walkOwn(c, fn);
  });
}

function collectDecls(body, env) {
  walkOwn(body, (n) => {
    if (ts.isVariableDeclaration(n)) bindDecl(n, env);
  });
  ts.forEachChild(body, function fns(c) {
    if (ts.isFunctionDeclaration(c) && c.name) env.vars.set(c.name.text, { k: 'fn', node: c, env });
    else if (!isFnLike(c) && !ts.isClassLike(c)) ts.forEachChild(c, fns);
  });
}

function bindDecl(decl, env) {
  const init = decl.initializer && strip(decl.initializer);
  if (init && ts.isCallExpression(init)) {
    const name = calleeName(init);
    if ((name === 'useState' || name === 'useReducer') && ts.isArrayBindingPattern(decl.name)) {
      // One token per component instance: the state a press flips and the
      // condition that reads it meet on this object.
      const tok = { name: decl.name.elements[0]?.name?.getText?.() ?? 'state', init: init.arguments[0], env };
      decl.name.elements.forEach((el, i) => {
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name))
          env.vars.set(el.name.text, { k: 'state', tok, setter: i === 1 });
      });
      return;
    }
    if (isHookName(name) && !['useCallback', 'useMemo', 'useRef'].includes(name) && !ts.isIdentifier(decl.name)) {
      bindPattern(decl.name, { k: 'expr', expr: decl.initializer, env }, env, { name, decl });
      return;
    }
  }
  bindPattern(decl.name, init ? { k: 'expr', expr: decl.initializer, env } : { k: 'param' }, env);
}

function bindPattern(name, src, env, hook) {
  if (ts.isIdentifier(name)) {
    env.vars.set(name.text, src);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    name.elements.forEach((el, i) => {
      if (ts.isOmittedExpression(el)) return;
      const dflt = el.initializer ? { expr: el.initializer, env } : undefined;
      if (el.dotDotDotToken) return bindPattern(el.name, { k: 'rest', base: src }, env);
      const key = ts.isArrayBindingPattern(name)
        ? String(i)
        : (el.propertyName ?? el.name).getText().replace(/^['"]|['"]$/g, '');
      bindPattern(el.name, { k: 'destr', base: src, key, dflt, hook }, env, hook);
    });
  }
}

class Mod {
  constructor(project, file) {
    this.project = project;
    this.file = file;
    const text = readFileSync(file, 'utf8');
    const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    this.sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    this.env = new Env(null, this);
    this.exports = new Map();
    this.stars = [];
    this.index();
  }

  index() {
    const { env, project } = this;
    for (const st of this.sf.statements) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly) {
        const spec = st.moduleSpecifier.text;
        const file = project.resolveSpecifier(this.file, spec);
        const bind = (local, name) =>
          env.vars.set(local, file ? { k: 'import', file, name } : { k: 'ext', module: spec, name: name === 'default' ? '' : name });
        const c = st.importClause;
        if (c.name) bind(c.name.text, 'default');
        const nb = c.namedBindings;
        if (nb && ts.isNamespaceImport(nb))
          env.vars.set(nb.name.text, file ? { k: 'ns', file } : { k: 'ext', module: spec, name: '' });
        if (nb && ts.isNamedImports(nb))
          for (const el of nb.elements) bind(el.name.text, (el.propertyName ?? el.name).text);
      } else if (ts.isFunctionDeclaration(st)) {
        const name = st.name?.text ?? '*default*';
        env.vars.set(name, { k: 'fn', node: st, env });
        if (exported) this.exports.set(isDefault ? 'default' : name, { local: name });
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          bindDecl(d, env);
          if (exported && ts.isIdentifier(d.name)) this.exports.set(d.name.text, { local: d.name.text });
        }
      } else if (ts.isExportAssignment(st)) {
        env.vars.set('*default*', { k: 'expr', expr: st.expression, env });
        this.exports.set('default', { local: '*default*' });
      } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
        const spec = st.moduleSpecifier?.text;
        const from = spec ? project.resolveSpecifier(this.file, spec) : null;
        if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            const inner = (el.propertyName ?? el.name).text;
            if (!spec) this.exports.set(el.name.text, { local: inner });
            else this.exports.set(el.name.text, from ? { from, name: inner } : { ext: spec, name: inner });
          }
        } else if (from) this.stars.push(from);
      } else if (ts.isClassDeclaration(st) && st.name) {
        env.vars.set(st.name.text, { k: 'unknown' });
      }
    }
  }

  exportBinding(name, seen = new Set()) {
    if (seen.has(this.file)) return undefined;
    seen.add(this.file);
    const e = this.exports.get(name);
    if (e?.local) return this.env.lookup(e.local);
    if (e?.from) return this.project.load(e.from)?.exportBinding(e.name, seen);
    if (e?.ext) return { k: 'ext', module: e.ext, name: e.name === 'default' ? '' : e.name };
    for (const s of this.stars) {
      const b = this.project.load(s)?.exportBinding(name, seen);
      if (b) return b;
    }
    return undefined;
  }
}

function readPaths(appRoot) {
  try {
    const raw = readFileSync(join(appRoot, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const paths = JSON.parse(raw).compilerOptions?.paths ?? {};
    return Object.entries(paths).map(([k, v]) => [
      new RegExp('^' + k.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)') + '$'),
      v,
    ]);
  } catch {
    return [];
  }
}

// ─── one screen: walk the rendered tree, collect elements and overlays ────

class ScreenWalk {
  constructor(project, node, notes) {
    this.p = project;
    this.node = node; // { id, label, layoutDir? }
    this.notes = notes;
    this.elements = [];
    this.visited = new Set();
    this.unresolved = [];
    this.navCount = 0;
  }

  where(n) {
    const sf = n.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
    return `${relative(REPO, sf.fileName)}:${line + 1}`;
  }

  run(fnVals) {
    const ctx = { frames: [], stack: [], screenName: null, condSources: null };
    for (const fv of fnVals) if (fv.t === 'fn') this.walkFn(fv, [{ k: 'val', value: { t: 'props', map: new Map(), spreads: [] } }], ctx);
  }

  walkFn(fnv, args, ctx) {
    if (!fnv.node.body || ctx.stack.includes(fnv.node) || ctx.stack.length > 40) return;
    if (!this.p.inProject(fnv.node.getSourceFile().fileName)) return;
    this.visited.add(fnv.node);
    const env = this.p.fnEnv(fnv.node, fnv.env, args);
    const inner = { ...ctx, stack: [...ctx.stack, fnv.node] };
    const locals = [];
    inner.locals = locals;
    this.visit(fnv.node.body, env, inner);
    // Render helpers declared in the body but used in ways the walk could not
    // follow (handed to a list, say) still render: visit them where declared.
    for (const l of locals) if (!this.visited.has(l.node)) this.visitLocal(l, inner);
  }

  visitLocal(l, ctx) {
    this.visited.add(l.node);
    if (isFnLike(l.node)) this.visitFnBody(l.node, l.env, null, ctx);
    else this.visit(l.node, l.env, ctx);
  }

  visitFnBody(fnNode, env, args, ctx) {
    if (!fnNode.body || ctx.stack.includes(fnNode)) return;
    this.visited.add(fnNode);
    this.visit(fnNode.body, this.p.fnEnv(fnNode, env, args), { ...ctx, stack: [...ctx.stack, fnNode] });
  }

  visit(node, env, ctx) {
    if (!node) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return this.jsx(node, env, ctx);
    if (ts.isJsxExpression(node)) return node.expression && this.valueExpr(node.expression, env, ctx);
    if (ts.isConditionalExpression(node) && containsJsx(node)) return this.branch(node.condition, node.whenTrue, node.whenFalse, env, ctx);
    if (ts.isBinaryExpression(node) && containsJsx(node.right)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return this.branch(node.left, node.right, null, env, ctx);
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken)
        return this.branch(node.left, null, node.right, env, ctx);
    }
    if (ts.isCallExpression(node)) return this.call(node, env, ctx);
    if (ts.isVariableDeclaration(node)) {
      const init = node.initializer && strip(node.initializer);
      if (init && (isFnLike(init) || ts.isJsxElement(init) || ts.isJsxSelfClosingElement(init) || ts.isJsxFragment(init) || isWrappedFn(init))) {
        if (containsJsx(init)) ctx.locals?.push({ node: isWrappedFn(init) ? strip(init.arguments[0]) : init, env });
        return;
      }
      return this.visit(node.initializer, env, ctx);
    }
    if (ts.isFunctionDeclaration(node)) {
      if (containsJsx(node)) ctx.locals?.push({ node, env });
      return;
    }
    if (isFnLike(node)) {
      if (containsJsx(node)) this.visitFnBody(node, env, null, ctx);
      return;
    }
    if ((ts.isIdentifier(node) && node.text === 'children') || (ts.isPropertyAccessExpression(node) && node.name.text === 'children'))
      return this.valueExpr(node, env, ctx);
    ts.forEachChild(node, (c) => this.visit(c, env, ctx));
  }

  /** `{expr}` in JSX: a const holding JSX, a children prop, or plain code. */
  valueExpr(expr, env, ctx) {
    const e = strip(expr);
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
      for (const v of this.p.resolve(e, env)) {
        if (v.t === 'jsx' && !ctx.stack.includes(v.node)) {
          this.visited.add(v.node);
          this.visit(v.node, v.env, { ...ctx, stack: [...ctx.stack, v.node] });
        } else if (v.t === 'children') this.children(v, ctx);
      }
      return;
    }
    this.visit(e, env, ctx);
  }

  children(v, ctx) {
    if (ctx.stack.includes(v)) return;
    v.consumed = true;
    for (const c of v.nodes) this.visit(c, v.env, { ...ctx, stack: [...ctx.stack, v] });
  }

  /**
   * A branch of `c ? a : b`, `c && a`, `c || a`. When the branch is hidden at
   * first (evaluated with every useState at its initial value) and the
   * condition reads state some press can flip, the branch is an overlay level
   * whose opener is found later; an undecidable condition adds nothing.
   */
  branch(cond, whenTrue, whenFalse, env, ctx) {
    const truth = this.initialTruth(cond, env, 0);
    const sources = this.sourcesOf(cond, env, new Set(), 0);
    const go = (body, hidden) => {
      if (!body) return;
      if (hidden && sources.size) {
        const frame = { kind: 'cond', label: cond.getText().slice(0, 40), sources, where: this.where(cond) };
        this.visit(body, env, { ...ctx, frames: [...ctx.frames, frame], condSources: null });
      } else this.visit(body, env, { ...ctx, condSources: sources.size ? sources : ctx.condSources });
    };
    go(whenTrue, truth === false);
    go(whenFalse, truth === true);
  }

  call(node, env, ctx) {
    const callee = node.expression;
    const fnArg = node.arguments[0] && strip(node.arguments[0]);
    if (ts.isPropertyAccessExpression(callee) && ['map', 'flatMap'].includes(callee.name.text) && fnArg && containsJsx(fnArg)) {
      // Rows from a literal array are walked once per element, so a
      // `${testID}.${o.value}` id spells out each option.
      const fns = isFnLike(fnArg) ? [{ t: 'fn', node: fnArg, env }] : this.p.resolve(fnArg, env).filter((v) => v.t === 'fn');
      const arrays = this.p.resolve(callee.expression, env).filter((v) => v.t === 'arr');
      const total = arrays.reduce((n, a) => n + a.node.elements.length, 0);
      for (const f of fns) {
        if (arrays.length && total <= 40 && arrays.every((a) => a.node.elements.every((el) => !ts.isSpreadElement(el))))
          for (const a of arrays) for (const el of a.node.elements) this.visitFnBody(f.node, f.env, [{ k: 'expr', expr: el, env: a.env }], ctx);
        else this.visitFnBody(f.node, f.env, null, ctx);
      }
      this.visit(callee.expression, env, ctx);
      return;
    }
    // A render helper called inline: `{renderRow(item)}`.
    if (containsJsxCallee(this.p, callee, env)) {
      for (const v of this.p.resolve(callee, env))
        if (v.t === 'fn' && containsJsx(v.node) && !isHookName(fnName(v.node)))
          this.visitFnBody(v.node, v.env, node.arguments.map((a) => ({ k: 'expr', expr: a, env })), ctx);
    }
    for (const a of node.arguments) this.visit(a, env, ctx);
    if (!ts.isIdentifier(callee)) this.visit(callee, env, ctx);
  }

  jsx(node, env, ctx, fanned = false) {
    const open = ts.isJsxElement(node) ? node.openingElement : node;
    const tagText = open.tagName.getText();
    const simple = tagText.split('.').pop();
    const attrs = new Map();
    const spreads = [];
    for (const a of open.attributes.properties) {
      if (ts.isJsxSpreadAttribute(a)) spreads.push({ expr: a.expression, env });
      else {
        const init = a.initializer;
        const expr = !init ? ts.factory.createTrue() : ts.isJsxExpression(init) ? init.expression : init;
        if (expr) attrs.set(a.name.getText(), expr);
      }
    }
    const kids = ts.isJsxElement(node) ? [...node.children] : [];
    if (simple === 'Redirect' || simple === 'Fragment') {
      kids.forEach((c) => this.visit(c, env, ctx));
      return;
    }

    const tid = attrs.get('testID');
    if (tid && !fanned) {
      const fan = this.fanOut(tid, env);
      if (fan) {
        for (const shadow of fan) this.jsx(node, shadow, ctx, true);
        return;
      }
    }

    let frames = ctx.frames;
    const top = frames[frames.length - 1];
    const tagVals = /^[A-Z]/.test(tagText) ? this.p.resolve(open.tagName, env) : [];
    const projFns = tagVals.filter((v) => v.t === 'fn' && this.p.inProject(v.node.getSourceFile().fileName));
    if (simple === 'Modal' && projFns.length === 0) {
      const sources = this.sourcesOf(attrs.get('visible'), env, new Set(), 0);
      if (top?.mergeable) {
        // `<FooSheet>` already opened a level and this Modal is its body.
        top.mergeable = false;
        sources.forEach((s) => top.sources.add(s));
      } else frames = [...frames, { kind: 'modal', label: 'Modal', sources, where: this.where(open) }];
    } else if (OVERLAY_NAME.test(simple) && simple !== 'Modal' || (simple === 'Modal' && projFns.length)) {
      const sources = new Set(ctx.condSources ?? []);
      for (const [k, x] of attrs) if (k !== 'testID') this.sourcesOf(x, env, sources, 0);
      frames = [...frames, { kind: 'name', label: simple, sources, where: this.where(open), mergeable: true }];
    }
    let screenName = ctx.screenName;
    const nameAttr = attrs.get('name');
    if (simple === 'Screen' && nameAttr && ts.isStringLiteral(nameAttr) && this.node.layoutDir !== undefined) screenName = nameAttr.text;
    const inner = { ...ctx, frames, screenName, condSources: null };

    if (projFns.length) {
      const map = new Map();
      for (const [k, x] of attrs) map.set(k, { k: 'expr', expr: x, env });
      const childVal = kids.length ? { t: 'children', nodes: kids, env, consumed: false } : null;
      if (childVal) map.set('children', { k: 'val', value: childVal });
      const props = { t: 'props', map, spreads };
      for (const f of projFns) this.walkFn(f, [{ k: 'val', value: props }], inner);
      if (childVal && !childVal.consumed) kids.forEach((c) => this.visit(c, env, inner));
      for (const [k, x] of attrs) if (k !== 'testID' && containsJsx(x) && !this.visited.has(strip(x))) this.visit(x, env, inner);
      return;
    }

    if (tid) {
      const keys = this.keys(tid, env);
      const interactive =
        INTERACTIVE.has(simple) ||
        TESTID_ELEMENTS.has(simple) ||
        [...attrs.keys()].some((k) => k === 'href' || (/^on[A-Z]/.test(k) && !NOT_A_PRESS.test(k)));
      if (interactive && keys.length) this.emit(keys, attrs, env, inner, open);
      else if (interactive) this.unresolved.push(`testID ${tid.getText()} at ${this.where(open)}`);
    }
    for (const [k, x] of attrs) {
      if (k === 'testID') continue;
      if (containsJsx(x)) this.visit(x, env, inner);
      else if (ts.isIdentifier(strip(x)) || ts.isPropertyAccessExpression(strip(x)))
        // A render prop handed down from a caller (`renderItem={renderRow}`).
        for (const v of this.p.resolve(x, env)) {
          if (v.t === 'fn' && containsJsx(v.node) && this.p.inProject(v.node.getSourceFile().fileName)) this.visitFnBody(v.node, v.env, null, inner);
          else if (v.t === 'jsx' && !inner.stack.includes(v.node)) {
            this.visited.add(v.node);
            this.visit(v.node, v.env, { ...inner, stack: [...inner.stack, v.node] });
          }
        }
    }
    kids.forEach((c) => this.visit(c, env, inner));
  }

  /**
   * `testID={row.testID}` over data the walk cannot see (a role-filtered list
   * from a hook): use the row tables themselves, i.e. object literals with a
   * string `testID` in this file or a file it imports directly, and bind the
   * row to each in turn so `onOpen(row)` → `router.push(row.href)` resolves.
   */
  fanOut(tid, env) {
    const e = strip(tid);
    if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.expression)) return null;
    const vals = this.p.resolve(e, env);
    if (vals.some((v) => v.t === 'str')) return null;
    const tables = rowTables(this.p, env.mod, e.name.text);
    if (!tables.length) return null;
    return tables.map(({ node, mod }) => {
      const shadow = new Env(env);
      shadow.vars.set(e.expression.text, { k: 'val', value: { t: 'obj', node, env: mod.env } });
      return shadow;
    });
  }

  keys(tid, env) {
    return [...new Set(this.p.resolve(tid, env).filter((v) => v.t === 'str' && v.s !== HOLE).map((v) => normaliseKey(v.s)))];
  }

  emit(keys, attrs, env, ctx, open) {
    const acc = { calls: new Set(), targets: [], seen: new Set() };
    for (const [k, x] of attrs) {
      if (k === 'href') this.targets(x, env, acc);
      else if (/^on[A-Z]/.test(k) && !NOT_A_PRESS.test(k)) this.handlerValue(x, env, acc, 0);
    }
    if (ctx.screenName) acc.targets.push({ route: this.node.layoutDir ? `${this.node.layoutDir}/${ctx.screenName}` : ctx.screenName });
    this.elements.push({ keys, frames: ctx.frames, calls: acc.calls, targets: acc.targets, where: this.where(open) });
  }

  handlerValue(x, env, acc, depth) {
    for (const v of this.p.resolve(x, env)) {
      if (v.t === 'fn') this.navWalk(v, null, acc, depth);
      else if ((v.t === 'state' && v.setter) || v.t === 'hookfn') acc.calls.add(v.tok);
    }
  }

  navWalk(fnv, args, acc, depth) {
    if (depth > 10 || acc.seen.has(fnv.node) || !fnv.node.body) return;
    if (!this.p.inProject(fnv.node.getSourceFile().fileName)) return;
    acc.seen.add(fnv.node);
    this.navVisit(fnv.node.body, this.p.fnEnv(fnv.node, fnv.env, args), acc, depth);
  }

  navVisit(node, env, acc, depth) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return;
    if (isFnLike(node)) return this.navWalk({ node, env }, null, acc, depth);
    if (ts.isCallExpression(node)) {
      for (const v of this.p.resolve(node.expression, env)) {
        if (v.t === 'ext' && v.module === 'expo-router' && NAV_CALL.test(v.name)) {
          this.navCount++;
          this.targets(node.arguments[0], env, acc);
        } else if ((v.t === 'state' && v.setter) || v.t === 'hookfn') acc.calls.add(v.tok);
        else if (v.t === 'fn') this.navWalk(v, node.arguments.map((a) => ({ k: 'expr', expr: a, env })), acc, depth + 1);
      }
      // Callbacks handed over by name: `.then(goNext)`, `confirm(doSave)`.
      for (const a of node.arguments) {
        const s = strip(a);
        if (ts.isIdentifier(s) || ts.isPropertyAccessExpression(s)) this.handlerValue(s, env, acc, depth + 1);
      }
    }
    if (ts.isPropertyAssignment(node) && /^on[A-Z]/.test(node.name.getText()) && ts.isIdentifier(strip(node.initializer)))
      this.handlerValue(node.initializer, env, acc, depth + 1);
    ts.forEachChild(node, (c) => this.navVisit(c, env, acc, depth));
  }

  targets(x, env, acc) {
    if (!x) return;
    for (const v of this.p.resolve(x, env)) {
      if (v.t === 'str') acc.targets.push({ href: v.s, where: this.where(x) });
      else if (v.t === 'obj') {
        const paths = this.p.getProp(v.node, 'pathname', v.env, 0);
        for (const pv of paths) {
          if (pv.t === 'str') acc.targets.push({ href: pv.s, where: this.where(x) });
          else this.unresolved.push(`navigation ${x.getText().slice(0, 60)} at ${this.where(x)}`);
        }
      } else this.unresolved.push(`navigation ${x.getText().slice(0, 60)} at ${this.where(x)}`);
    }
  }

  /** The state tokens a condition reads (useState values, hook outputs), through consts and props. */
  sourcesOf(expr, env, out, depth) {
    if (!expr || depth > 8) return out;
    const visitId = (id, envAt) => {
      const b = envAt.lookup(id.text);
      this.bindingSources(b, out, depth + 1);
    };
    const walk = (n) => {
      if (ts.isIdentifier(n)) visitId(n, env);
      else if (ts.isPropertyAccessExpression(n)) {
        // `props.open` → the caller's expression for `open`.
        for (const v of this.p.resolve(n.expression, env))
          if (v.t === 'props' && v.map.has(n.name.text)) this.bindingSources(v.map.get(n.name.text), out, depth + 1);
        walk(n.expression);
      } else ts.forEachChild(n, walk);
    };
    walk(expr);
    return out;
  }

  bindingSources(b, out, depth) {
    if (!b || depth > 8) return;
    if (b.k === 'state' && !b.setter) out.add(b.tok);
    else if (b.k === 'expr') this.sourcesOf(b.expr, b.env, out, depth + 1);
    else if (b.k === 'destr') {
      if (b.hook) out.add(b.hook);
      for (const v of this.p.resolveBinding(b.base))
        if (v.t === 'props' && v.map.has(b.key)) this.bindingSources(v.map.get(b.key), out, depth + 1);
      if (b.base.k === 'expr') this.sourcesOf(b.base.expr, b.base.env, out, depth + 1);
    }
  }

  /** Truthiness at first render, every useState at its initial value: true | false | null (unknown). */
  initialTruth(expr, env, depth) {
    const e = strip(expr);
    if (!e || depth > 10) return null;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return false;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text !== '';
    if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
    if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e) || isFnLike(e)) return true;
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
      const t = this.initialTruth(e.operand, env, depth + 1);
      return t === null ? null : !t;
    }
    if (ts.isIdentifier(e)) {
      if (e.text === 'undefined') return false;
      const b = env.lookup(e.text);
      if (b?.k === 'state' && !b.setter) return this.initialTruth(stateInit(b.tok), b.tok.env, depth + 1);
      if (b?.k === 'expr') return this.initialTruth(b.expr, b.env, depth + 1);
      return null;
    }
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      return this.initialTruth(e.expression, env, depth + 1) === false ? false : null;
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      const L = () => this.initialTruth(e.left, env, depth + 1);
      const R = () => this.initialTruth(e.right, env, depth + 1);
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        const l = L();
        if (l === false) return false;
        const r = R();
        if (r === false) return false;
        return l === true && r === true ? true : null;
      }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        const l = L();
        if (l === true) return true;
        const r = R();
        if (r === true) return true;
        return l === false && r === false ? false : null;
      }
      const eq = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(op);
      const ne = [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op);
      if (eq || ne) {
        const l = this.initialLiteral(e.left, env, depth + 1);
        const r = this.initialLiteral(e.right, env, depth + 1);
        if (l === NOPE || r === NOPE) return null;
        // `x == null` also matches undefined.
        const same = l === r || (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken ? l == r : false);
        return eq ? same : !same;
      }
    }
    return null;
  }

  initialLiteral(expr, env, depth) {
    const e = strip(expr);
    if (!e || depth > 10) return NOPE;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(e)) {
      if (e.text === 'undefined') return undefined;
      const b = env.lookup(e.text);
      if (b?.k === 'state' && !b.setter) return this.initialLiteral(stateInit(b.tok) ?? ts.factory.createIdentifier('undefined'), b.tok.env, depth + 1);
      if (b?.k === 'expr' && b.env.mod === env.mod) return this.initialLiteral(b.expr, b.env, depth + 1);
    }
    return NOPE;
  }
}

const NOPE = Symbol('unknown literal');

function stateInit(tok) {
  const init = tok.init && strip(tok.init);
  // useState(() => x): the lazy initialiser's value.
  if (init && ts.isArrowFunction(init) && !ts.isBlock(init.body)) return init.body;
  return init ?? ts.factory.createIdentifier('undefined');
}

function isWrappedFn(init) {
  return ts.isCallExpression(init) && ['useCallback', 'useMemo', 'memo', 'forwardRef'].includes(calleeName(init)) && init.arguments[0] && isFnLike(strip(init.arguments[0]));
}

function fnName(node) {
  if (node.name) return node.name.getText();
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p)) return p.name.getText();
  return '';
}

function containsJsxCallee(project, callee, env) {
  const e = strip(callee);
  return (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) && !isHookName(e.getText().split('.').pop());
}

const tableCache = new Map();
function rowTables(project, mod, prop) {
  const key = `${mod.file}#${prop}`;
  if (tableCache.has(key)) return tableCache.get(key);
  const files = [mod.file];
  for (const b of mod.env.vars.values()) if (b.k === 'import' || b.k === 'ns') files.push(b.file);
  const out = [];
  for (const f of new Set(files)) {
    if (f.includes(`${sep}__tests__${sep}`)) continue;
    const m = project.load(f);
    const walk = (n) => {
      if (ts.isObjectLiteralExpression(n)) {
        const p = n.properties.find((q) => ts.isPropertyAssignment(q) && q.name.getText() === prop);
        if (p && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) out.push({ node: n, mod: m });
      }
      ts.forEachChild(n, walk);
    };
    walk(m.sf);
  }
  tableCache.set(key, out);
  return out;
}

/** The testID lint rule's element list (packages/config/src/eslint.js), read rather than copied. */
const TESTID_ELEMENTS = (() => {
  try {
    const src = readFileSync(join(REPO, 'packages/config/src/eslint.js'), 'utf8');
    const block = /const testIdElements = \[([\s\S]*?)\]/.exec(src)?.[1] ?? '';
    return new Set([...block.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
})();

// ─── routes ────────────────────────────────────────────────────────────────

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listFiles(join(dir, d.name)) : [join(dir, d.name)],
  );
}

function routeLabel(id) {
  if (ROUTE_ALIASES[id]) return ROUTE_ALIASES[id];
  return id
    .split('/')
    .filter((s) => !/^\(.*\)$/.test(s))
    .join('-')
    .replace(/^\+/, '');
}

function routeSegments(id) {
  const segs = id.split('/').filter((s) => !/^\(.*\)$/.test(s));
  if (segs[segs.length - 1] === 'index') segs.pop();
  return segs;
}

/** An href → route ids. `:id` holes match dynamic segments, or the hole inside a static one. */
function matchHref(routes, href) {
  if (/^[a-z]+:/i.test(href)) return [];
  const segs = href.split(/[?#]/)[0].split('/').filter((s) => s && !/^\(.*\)$/.test(s));
  let best = [];
  let bestScore = -1;
  for (const r of routes) {
    if (r.segs.length !== segs.length || r.id.startsWith('+')) continue;
    let score = 0;
    let ok = true;
    r.segs.forEach((rs, i) => {
      const hs = segs[i];
      if (rs === hs) score += 2;
      else if (/^\[.*\]$/.test(rs) && (hs === HOLE || /^\[.*\]$/.test(hs) || !hs.includes(':'))) score += 1;
      else if (hs.includes(HOLE) && hs !== HOLE && new RegExp('^' + hs.split(HOLE).map(escapeRe).join('.+') + '$').test(rs)) score += 0;
      else ok = false;
    });
    if (!ok) continue;
    if (score > bestScore) [best, bestScore] = [[r.id], score];
    else if (score === bestScore) best.push(r.id);
  }
  return best;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findRoute(routes, ref) {
  return routes.find((r) => r.id === ref || r.label === ref) ?? routes.find((r) => matchHref(routes, ref).includes(r.id));
}

// ─── per-screen costs: overlays and their openers ─────────────────────────

/**
 * Relative cost of each element on its screen (1 = on screen), with the
 * clicks it takes. An overlay level costs its opener's cost + 1; the opener is
 * the cheapest element outside that level whose handler flips a state the
 * level's condition reads. A conditional branch with no such opener is just
 * data arriving, not a click, and adds nothing; a Modal or *Sheet with no
 * traceable opener still costs one click, labelled `(open X)`.
 */
function relativeCosts(walk, notes) {
  const memo = new Map();
  const els = walk.elements;
  const openerOf = new Map();
  const unknownOpeners = new Set();

  const costOf = (el, i) => {
    if (memo.has(el)) return memo.get(el);
    memo.set(el, { rel: Infinity, path: [] }); // cycle guard
    const res = costWithin(el, el.frames.length, i);
    memo.set(el, res);
    return res;
  };

  // Cost of reaching `el` with its first `n` frames open.
  const costWithin = (el, n) => {
    if (n === 0) return { rel: 1, path: [el.keys[0]] };
    const f = el.frames[n - 1];
    if (!openerOf.has(f)) {
      let best = null;
      for (const o of els) {
        if (o === el || o.frames.includes(f)) continue;
        let hit = false;
        for (const s of f.sources) if (o.calls.has(s)) hit = true;
        if (!hit) continue;
        const c = costOf(o);
        if (!best || c.rel < best.c.rel || (c.rel === best.c.rel && o.keys[0] < best.o.keys[0])) best = { o, c };
      }
      openerOf.set(f, best);
    }
    const best = openerOf.get(f);
    const outer = costWithin(el, n - 1);
    if (best && Number.isFinite(best.c.rel)) {
      // The opener's own path, plus any outer level it does not already sit in.
      const extra = el.frames.slice(0, n - 1).filter((g) => !best.o.frames.includes(g) && g.kind !== 'cond').length;
      return { rel: best.c.rel + 1 + extra, path: [...best.c.path.slice(0, -1), best.o.keys[0], el.keys[0]].filter(Boolean) };
    }
    if (f.kind === 'cond') return outer;
    unknownOpeners.add(`${f.label} at ${f.where}`);
    return { rel: outer.rel + 1, path: [...outer.path.slice(0, -1), `(open ${f.label})`, el.keys[0]] };
  };

  const rows = [];
  for (const el of els) {
    const base = costOf(el);
    for (const key of el.keys) rows.push({ key, rel: base.rel, path: [...base.path.slice(0, -1), key], targets: el.targets });
  }
  return { rows, unknownOpeners };
}

// ─── the target ────────────────────────────────────────────────────────────

/**
 * cfg (all optional but maxClicks, which report.mjs reads):
 *   app          the Expo app, repo-relative (default 'apps/mobile')
 *   roots        depth-0 home screens, as route ids, labels or hrefs
 *                (default ['book', 'staff']; an empty list means the default)
 *   entryRoutes  extra depth-0 screens only a link or the system opens
 *   ignoreRoutes screens left out entirely
 *   platform     'android' (default) or 'ios': which `.platform.tsx` wins
 */
export async function analyseMobile(name, cfg = {}) {
  const started = Date.now();
  const appRoot = resolvePath(REPO, cfg.app ?? 'apps/mobile');
  const appDir = join(appRoot, 'app');
  const platform = cfg.platform ?? 'android';
  const project = new Project(appRoot, platform);
  const notes = [];

  const routes = [];
  const layouts = [];
  for (const file of listFiles(appDir).sort()) {
    if (!/\.tsx$/.test(file) || /\.(ios|android|web)\.tsx$/.test(file)) continue;
    const id = relative(appDir, file).split(sep).join('/').replace(/\.tsx$/, '');
    const base = id.split('/').pop();
    if (base === '_layout') layouts.push({ id, dir: id.split('/').slice(0, -1).join('/'), file, label: routeLabel(id) });
    else if (!/^\+(html|native-intent|api)/.test(base)) routes.push({ id, file, label: routeLabel(id), segs: routeSegments(id) });
  }
  const ignore = new Set((cfg.ignoreRoutes ?? []).map((r) => findRoute(routes, r)?.id ?? r));
  const live = routes.filter((r) => !ignore.has(r.id));

  // Walk every screen and layout.
  const nodes = new Map();
  const unresolved = new Set();
  let navCalls = 0;
  const unknownOpeners = new Set();
  for (const r of [...live, ...layouts]) {
    const isLayout = layouts.includes(r);
    const mod = project.load(r.file);
    const walk = new ScreenWalk(project, { id: r.id, label: r.label, layoutDir: isLayout ? r.dir : undefined }, notes);
    const def = mod.exportBinding('default');
    walk.run(def ? project.resolveBinding(def) : []);
    walk.unresolved.forEach((u) => unresolved.add(u));
    navCalls += walk.navCount;
    const { rows, unknownOpeners: uo } = relativeCosts(walk, notes);
    uo.forEach((u) => unknownOpeners.add(u));
    const nodeId = isLayout ? `layout:${r.dir}` : r.id;
    nodes.set(nodeId, { id: nodeId, label: r.label, rows, isLayout, dir: r.dir });
  }

  // Resolve every element's targets to route ids once.
  const badHrefs = new Set();
  let edges = 0;
  for (const n of nodes.values())
    for (const row of n.rows) {
      const ids = new Set();
      for (const t of row.targets) {
        if (t.route) {
          const hit = live.find((r) => r.id === t.route);
          if (hit) ids.add(hit.id);
          continue;
        }
        const hits = matchHref(live, t.href);
        if (hits.length === 0 && !/^[a-z]+:/i.test(t.href) && !ignoreHref(routes, ignore, t.href)) badHrefs.add(`${t.href} at ${t.where}`);
        hits.forEach((h) => ids.add(h));
      }
      row.to = [...ids];
      edges += row.to.length;
    }

  // Dijkstra over screens; costs are small integers, so a bucket queue.
  const depth = new Map();
  const pathTo = new Map();
  const buckets = [];
  const push = (id, d, path) => {
    if (depth.has(id) && depth.get(id) <= d) return;
    depth.set(id, d);
    pathTo.set(id, path);
    (buckets[d] ??= []).push(id);
  };
  let roots = (cfg.roots?.length ? cfg.roots : ['book', 'staff']).map((r) => findRoute(live, r));
  if (roots.some((r) => !r)) notes.push(`a root in targets.${name}.roots matches no route: ${JSON.stringify(cfg.roots)}`);
  roots = roots.filter(Boolean);
  for (const r of roots) push(r.id, 0, [r.label]);
  for (const ref of cfg.entryRoutes ?? []) {
    const r = findRoute(live, ref);
    if (r) push(r.id, 0, [r.label]);
    else notes.push(`entry route "${ref}" matches no route`);
  }
  const layoutsOf = (routeId) =>
    layouts.filter((l) => l.dir === '' || routeId === l.dir || routeId.startsWith(l.dir + '/')).map((l) => `layout:${l.dir}`);
  const best = new Map();
  const done = new Set();
  for (let d = 0; d < buckets.length; d++) {
    for (const id of buckets[d] ?? []) {
      if (done.has(id) || depth.get(id) !== d) continue;
      done.add(id);
      const n = nodes.get(id);
      if (!n) continue;
      const base = pathTo.get(id);
      if (!n.isLayout) for (const l of layoutsOf(id)) push(l, d, base);
      for (const row of n.rows) {
        const cost = d + row.rel;
        const path = [...base, ...row.path];
        const cur = best.get(row.key);
        if (!cur || cost < cur.cost) best.set(row.key, { key: row.key, cost, path });
        for (const t of row.to) push(t, cost, path);
      }
    }
  }

  // What could not be reached by pressing, with the code that does go there.
  const codeNav = scanCodeNavigation(project, appRoot, live);
  const unreachable = [];
  for (const r of live) {
    if (depth.has(r.id)) continue;
    const n = nodes.get(r.id);
    const buttons = new Set(n.rows.map((x) => x.key)).size;
    const from = codeNav.get(r.id) ?? [];
    unreachable.push({
      key: `screen:${r.label}`,
      reason:
        `no press leads to app/${r.id}.tsx (${buttons} button(s) on it)` +
        (from.length
          ? `; code opens it outside a traced press at ${from.slice(0, 3).join(', ')}${from.length > 3 ? ` +${from.length - 3}` : ''}`
          : '; nothing in the code navigates to it (deep link / system only?)'),
    });
  }

  const elements = [...best.values()].sort((a, b) => a.key.localeCompare(b.key));
  const reachedScreens = live.filter((r) => depth.has(r.id)).length;
  notes.push(
    `static model, ${platform} files, auth/role not modelled (every gated branch rendered, <Redirect>s are not presses): ` +
      `${live.length} screens (${reachedScreens} reached) + ${layouts.length} layouts, ${elements.length} buttons, ` +
      `${edges} press→screen edges from ${navCalls} traced router calls, ${(Date.now() - started) / 1000}s`,
  );
  if (unresolved.size) notes.push(`${unresolved.size} navigation target(s) or testID(s) not resolved statically: ${[...unresolved].sort().join('; ')}`);
  if (badHrefs.size) notes.push(`${badHrefs.size} href(s) match no route: ${[...badHrefs].sort().join('; ')}`);
  if (unknownOpeners.size) notes.push(`${unknownOpeners.size} overlay(s) with no traceable opener, counted as one click: ${[...unknownOpeners].sort().join('; ')}`);
  return { elements, screens: live.length, notes, unreachable };
}

function ignoreHref(routes, ignore, href) {
  return matchHref(routes, href).some((id) => ignore.has(id));
}

/**
 * Literal navigations anywhere in the app (effects, gates, push handlers,
 * redirects), so an unreachable screen's reason can say who opens it.
 */
function scanCodeNavigation(project, appRoot, routes) {
  const out = new Map();
  const add = (href, node) => {
    for (const id of matchHref(routes, href)) {
      const sf = node.getSourceFile();
      const at = `${relative(REPO, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      (out.get(id) ?? out.set(id, []).get(id)).push(at);
    }
  };
  const lit = (x) => {
    const e = x && strip(x);
    if (!e) return null;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isObjectLiteralExpression(e)) {
      const p = e.properties.find((q) => ts.isPropertyAssignment(q) && q.name.getText() === 'pathname');
      return p ? lit(p.initializer) : null;
    }
    return null;
  };
  for (const file of [...listFiles(join(appRoot, 'app')), ...listFiles(join(appRoot, 'src'))]) {
    if (!/\.tsx?$/.test(file) || file.includes(`${sep}__tests__${sep}`) || file.includes(`${sep}smoke${sep}`) || file.includes(`${sep}test${sep}`)) continue;
    const sf = project.load(file).sf;
    const walk = (n) => {
      if (ts.isCallExpression(n) && /\.(push|replace|navigate|dismissTo)$/.test(n.expression.getText())) {
        const h = lit(n.arguments[0]);
        if (h?.startsWith('/')) add(h, n);
      } else if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && /^(Redirect|Link)$/.test(n.tagName.getText())) {
        const a = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === 'href');
        const h = a && lit(a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer);
        if (h) add(h, n);
      } else if (ts.isPropertyAssignment(n) && /^(href|pathname)$/.test(n.name.getText())) {
        const h = lit(n.initializer);
        if (h?.startsWith('/')) add(h, n);
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  return out;
}
