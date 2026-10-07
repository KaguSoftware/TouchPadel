/**
 * The in-page half of the crawl. `pageProbe` is serialised into the browser with
 * page.evaluate, so it must stay self-contained (no imports, no closures).
 *
 * Light mode (every replay step): what a person could press right now, with stable keys,
 * so the crawler can find "the same button" again in a fresh context.
 * Full mode (once per NEW state): the same list plus rendered geometry, the effective hit
 * area, the computed styles the size/consistency checks judge, the resolved design tokens
 * at that element, and every card-like surface on the screen.
 *
 * Keys (apps/web has no data-testid): a config override by selector, else a group key for
 * repeated lists, else `<role>:<accessible name>[ <href path>]`, with screen-reader-only
 * cues dropped, numbers -> :n, uuids -> :id. textContent is used, not innerText, because
 * innerText follows CSS text-transform (the site's buttons are uppercase).
 */
export function pageProbe(a) {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const norm = (s, max = 60) => {
    const out = String(s ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(UUID, ':id')
      .replace(/[+\-−]?\d[\d,.]*%?/g, ':n');
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
  };
  const normPath = (p) => p.replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
  const srSel = a.srOnly.join(',');
  const vw = innerWidth;
  const vh = innerHeight;
  const docW = Math.max(document.documentElement.scrollWidth, vw);

  const visibleText = (el) => {
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.data;
        else if (child.nodeType === 1) {
          const tag = child.tagName.toLowerCase();
          if (tag === 'svg' || tag === 'style' || tag === 'script' || tag === 'template') continue;
          if (child.getAttribute('aria-hidden') === 'true') continue;
          if (srSel && child.matches(srSel)) continue;
          walk(child);
          out += ' ';
        }
      }
    };
    walk(el);
    return out;
  };
  const byIds = (ids) =>
    ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(visibleText).join(' ');
  const labelFor = (el) => (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
  const nameOf = (el) => {
    if (el.getAttribute('aria-labelledby')) {
      const t = byIds(el.getAttribute('aria-labelledby'));
      if (t.trim()) return t;
    }
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label');
    if (el.matches('input,select,textarea')) {
      const lab = labelFor(el);
      if (lab && visibleText(lab).trim()) return visibleText(lab);
      return el.getAttribute('placeholder') || el.getAttribute('name') || el.type || '';
    }
    const t = visibleText(el);
    if (t.trim()) return t;
    return el.getAttribute('title') || el.querySelector('img[alt]')?.alt || '';
  };
  const kindOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'input') return `input-${el.type || 'text'}`;
    return tag;
  };
  const alpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
  };
  const px = (v) => (typeof v === 'string' && v.endsWith('px') ? parseFloat(v) : NaN);

  // ---- visibility + top layer -----------------------------------------------
  const visible = (el, r) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (r.width < 2 || r.height < 2) return false;
    const top = r.top + scrollY;
    const left = r.left + scrollX;
    if (top + r.height <= 0 || left + r.width <= 0 || left >= docW) return false; // parked off-page (skip link)
    return true;
  };
  const modals = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].filter((m) => {
    const r = m.getBoundingClientRect();
    return visible(m, r);
  });
  const modal = modals[modals.length - 1] ?? null;
  const hitOk = (el, r) => {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  // A full-viewport fixed cover (backdrop) without aria-modal still blocks the page.
  const coverOf = (x, y) => {
    let found = null;
    for (let n = document.elementFromPoint(x, y); n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position !== 'fixed') continue;
      const b = n.getBoundingClientRect();
      if (b.width >= vw * 0.9 && b.height >= vh * 0.9) found = n;
    }
    return found;
  };
  let cover = null;
  if (!modal) {
    const votes = new Map();
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
      const c = coverOf(vw * fx, vh * fy);
      if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    cover = [...votes].sort((x, y) => y[1] - x[1]).find(([, n]) => n >= 3)?.[0] ?? null;
    // A sticky/fixed header or a page-wide wrapper is not a cover: it must hold no main.
    if (cover && cover.querySelector('main')) cover = null;
  }
  const layerRoot = modal ?? cover;
  const layerName = layerRoot
    ? norm(
        layerRoot.getAttribute('aria-label') ||
          (layerRoot.getAttribute('aria-labelledby') && byIds(layerRoot.getAttribute('aria-labelledby'))) ||
          layerRoot.querySelector('h1,h2,h3')?.textContent ||
          [...layerRoot.classList].find((c) => c.startsWith('tp-')) ||
          layerRoot.getAttribute('role') ||
          'overlay',
        40,
      )
    : null;

  const neverSel = a.neverSel.join(',');
  const neverText = a.neverText.map((s) => new RegExp(s, 'i'));
  const recordOnlySel = a.recordOnly.join(',');
  const volatileSel = (a.volatile ?? []).join(',');


  // ---- full mode helpers ------------------------------------------------------
  function scopeOf(el) {
    const t = el.closest('[data-theme]');
    const m = el.closest('[data-mode]');
    return {
      family: t?.getAttribute('data-theme') ?? 'none',
      mode: m?.getAttribute('data-mode') ?? '-',
      dir: el.closest('[dir]')?.getAttribute('dir') ?? 'ltr',
    };
  }
  function hitRect(el, target, r) {
    let box = { l: r.left, t: r.top, rr: r.right, b: r.bottom };
    let via = target === el ? 'self' : 'label';
    const union = (b) => {
      box = { l: Math.min(box.l, b.left), t: Math.min(box.t, b.top), rr: Math.max(box.rr, b.right), b: Math.max(box.b, b.bottom) };
    };
    if (target === el && el.matches('input[type=radio],input[type=checkbox]')) {
      const lab = labelFor(el);
      if (lab) {
        union(lab.getBoundingClientRect());
        via = 'label';
      }
    }
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      if (ps.position !== 'absolute' || ps.pointerEvents === 'none') continue;
      let cb = el;
      const positioned = (n) => {
        const s = getComputedStyle(n);
        return s.position !== 'static' || s.transform !== 'none' || s.contain.includes('layout');
      };
      if (!positioned(el)) {
        cb = el.parentElement;
        while (cb && cb !== document.body && !positioned(cb)) cb = cb.parentElement;
      }
      if (!cb) continue;
      const c = cb.getBoundingClientRect();
      const T = px(ps.top);
      const L = px(ps.left);
      const R = px(ps.right);
      const B = px(ps.bottom);
      const W = px(ps.width);
      const H = px(ps.height);
      const left = !Number.isNaN(L) ? c.left + L : !Number.isNaN(R) && !Number.isNaN(W) ? c.right - R - W : NaN;
      const right = !Number.isNaN(R) ? c.right - R : !Number.isNaN(W) ? left + W : NaN;
      const top = !Number.isNaN(T) ? c.top + T : !Number.isNaN(B) && !Number.isNaN(H) ? c.bottom - B - H : NaN;
      const bottom = !Number.isNaN(B) ? c.bottom - B : !Number.isNaN(H) ? top + H : NaN;
      if ([left, right, top, bottom].some(Number.isNaN)) continue;
      // Only a deliberate hit-area extension counts (the stretched-link card pattern),
      // not a hover fill that bleeds 1.5px past the border.
      const grows = Math.max(r.left - left, right - r.right, r.top - top, bottom - r.bottom);
      if (grows <= 4 || right - left < 2 || bottom - top < 2) continue;
      union({ left, right, top, bottom });
      via = `pseudo${pseudo} of ${cb === el ? 'self' : (cb.className && String(cb.className).split(/\s+/).find((x) => x.startsWith('tp-'))) || cb.tagName.toLowerCase()}`;
    }
    return { w: +(box.rr - box.l).toFixed(1), h: +(box.b - box.t).toFixed(1), via };
  }
  /**
   * WCAG 2.5.8's inline exception: the link sits in a line of running text. It counts only
   * when non-link text shares a line box with the link (a text node outside any control,
   * whose rects overlap the link's line vertically). A heading or another block in the same
   * container is not running text: a phone number alone on its line under an <h2> is a
   * standalone target and is judged.
   */
  function inlineInText(el, cs, hasBox) {
    if (el.tagName !== 'A' || hasBox || cs.display !== 'inline') return false;
    let p = el.parentElement;
    while (p && getComputedStyle(p).display === 'inline') p = p.parentElement;
    if (!p) return false;
    const lines = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!lines.length) return false;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let seen = 0;
    for (let n = walker.nextNode(); n && seen < 400; n = walker.nextNode()) {
      if (!n.data.trim() || el.contains(n)) continue;
      const host = n.parentElement;
      if (!host || host.closest('a,button,[role=button],[role=link],svg,script,style')) continue;
      seen++;
      range.selectNodeContents(n);
      for (const t of range.getClientRects()) {
        if (t.width < 1 || t.height < 1) continue;
        for (const l of lines) {
          const overlap = Math.min(l.bottom, t.bottom) - Math.max(l.top, t.top);
          if (overlap >= 0.5 * Math.min(l.height, t.height)) return true;
        }
      }
    }
    return false;
  }
  /**
   * The element that renders the visible label (the first visible text node's parent), so
   * type is read where the text is: `.tp-locale-switch` sets 12px/800 on its child span,
   * not on the anchor. null for an icon-only control.
   */
  function labelHolder(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      const host = n.parentElement;
      if (!host) continue;
      let hidden = false;
      for (let x = host; x && x !== el; x = x.parentElement) {
        const tag = x.tagName.toLowerCase();
        if (tag === 'svg' || tag === 'style' || tag === 'script' || tag === 'template' || x.getAttribute('aria-hidden') === 'true' || (srSel && x.matches(srSel))) hidden = true;
      }
      if (hidden || (srSel && el.matches(srSel))) continue;
      if (!host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      return host;
    }
    return null;
  }
  function typeOf(n) {
    const cs = getComputedStyle(n);
    return {
      fontFamily: cs.fontFamily,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight),
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      textTransform: cs.textTransform,
    };
  }
  function styleOf(cs) {
    return {
      display: cs.display,
      position: cs.position,
      minHeight: cs.minHeight,
      minWidth: cs.minWidth,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
      borderWidth: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat),
      borderStyle: [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle],
      borderColor: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v)),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage !== 'none',
      color: cs.color,
      fontFamily: cs.fontFamily,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight),
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      textTransform: cs.textTransform,
      shadow: cs.boxShadow,
      gap: cs.rowGap === 'normal' ? 0 : parseFloat(cs.rowGap),
      opacity: Number(cs.opacity),
      cursor: cs.cursor,
    };
  }
  function boxed(st) {
    return (
      alpha(st.bg) > 0 ||
      st.bgImage ||
      st.borderWidth.some((w, i) => w > 0 && st.borderStyle[i] !== 'none' && alpha(st.borderColor[i]) > 0) ||
      (st.shadow && st.shadow !== 'none')
    );
  }
  // Tokens resolved AT the element (sections re-scope colours), through one probe node.
  // A fresh, style-isolated node per conversion: reusing one node read stale values on the
  // café (a transition on the probe kept reporting its first width).
  const conv = new Map();
  const convert = (prop, raw) => {
    const k = `${prop}|${raw}`;
    if (!conv.has(k)) {
      const n = document.createElement('div');
      n.setAttribute('aria-hidden', 'true');
      n.style.cssText = 'all:initial;display:block;position:absolute;visibility:hidden;pointer-events:none;transition:none;animation:none';
      n.style.setProperty(prop, raw);
      const ok = !!n.style.getPropertyValue(prop);
      document.body.appendChild(n);
      const v = ok ? getComputedStyle(n).getPropertyValue(prop) : null;
      n.remove();
      conv.set(k, v == null ? null : prop === 'width' ? parseFloat(v) : v);
    }
    return conv.get(k);
  };
  const toPx = (raw) => convert('width', raw);
  const toColor = (raw) => convert('color', raw);
  const tokScopes = {};
  function tokensAt(el, family) {
    const fam = a.tokens[family];
    if (!fam) return null;
    const ecs = getComputedStyle(el);
    const raws = {};
    for (const n of fam.lengths) raws[n] = ecs.getPropertyValue(n).trim();
    for (const n of fam.colors) raws[n] = ecs.getPropertyValue(n).trim();
    for (const n of fam.fonts ?? []) raws[n] = ecs.getPropertyValue(n).trim();
    const sig = `${family}|${JSON.stringify(raws)}`;
    let id = tokScopes.__ids?.get(sig);
    if (!id) {
      tokScopes.__ids ??= new Map();
      id = `${family}#${tokScopes.__ids.size}`;
      tokScopes.__ids.set(sig, id);
      const resolved = {};
      for (const n of fam.lengths) resolved[n] = raws[n] ? toPx(raws[n]) : null;
      for (const n of fam.colors) resolved[n] = raws[n] ? toColor(raws[n]) : null;
      for (const n of fam.fonts ?? []) resolved[n] = raws[n] || null;
      tokScopes[id] = { family, values: resolved };
    }
    return id;
  }
  /** tp-* classes of the ancestors, nearest first (for contextual rules like `.tp-cattabs button`). */
  function ancestorsOf(el) {
    const out = [];
    for (let p = el.parentElement, i = 0; p && i < 12; p = p.parentElement, i++) {
      for (const c of p.classList) if (c.startsWith('tp-') && !out.includes(c)) out.push(c);
    }
    return out;
  }
  function measure(el, target, r, cs) {
    const st = styleOf(cs);
    const hasBox = boxed(st);
    const sc = scopeOf(el);
    const holder = labelHolder(el);
    return {
      classes: [...el.classList],
      ancestors: ancestorsOf(el),
      hasText: !!holder,
      label: holder ? { self: holder === el, cls: holder === el ? null : [...holder.classList].find((c) => c.startsWith('tp-')) ?? holder.tagName.toLowerCase(), ...typeOf(holder) } : null,
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      hit: hitRect(el, target, r),
      measuredOn: target === el ? 'self' : 'label',
      inline: inlineInText(el, cs, hasBox),
      hasBox,
      ...sc,
      tok: tokensAt(el, sc.family),
      style: st,
      text: norm(el.textContent, 40),
    };
  }

  // ---- interactive elements ---------------------------------------------------
  const els = [];
  const out = [];
  const groupCount = new Map();
  for (const el of document.querySelectorAll(a.selectors.join(','))) {
    if (el.closest('[inert],[aria-hidden="true"]')) continue;
    if (el.closest('nextjs-portal')) continue;
    let r = el.getBoundingClientRect();
    let target = el;
    if (!visible(el, r)) {
      // A styled radio/checkbox hides the input and shows its label: measure the label.
      if (el.matches('input[type=radio],input[type=checkbox]')) {
        const lab = labelFor(el);
        if (!lab || !visible(lab, lab.getBoundingClientRect())) continue;
        target = lab;
        r = lab.getBoundingClientRect();
      } else continue;
    }
    const cs = getComputedStyle(target);
    if (cs.pointerEvents === 'none' && target === el) continue;
    if (modal && !modal.contains(el)) continue;
    if (!modal && cover && !cover.contains(el) && !hitOk(el, r)) continue;

    const tag = el.tagName.toLowerCase();
    const kind = kindOf(el);
    let href = null;
    let external = false;
    let clickable = true;
    let why = null;
    if (tag === 'a') {
      const raw = el.getAttribute('href') ?? '';
      const u = new URL(el.href, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        external = true;
        href = `${u.protocol}${u.host ? `//${u.host}` : ''}`;
      } else if (u.origin !== location.origin) {
        external = true;
        href = u.host + normPath(u.pathname);
      } else {
        href = normPath(u.pathname) + (u.hash || '');
        if (raw.startsWith('#') || (u.pathname === location.pathname && u.hash)) {
          clickable = false;
          why = 'in-page anchor';
        }
      }
      if (external) {
        clickable = false;
        why = 'external';
      } else if (el.target === '_blank' || el.hasAttribute('download')) {
        clickable = false;
        why = 'new tab / download';
      }
    }
    const label = norm(nameOf(el));
    let key = null;
    for (const k of a.keyBySelector) if (el.matches(k.selector)) key = k.key;
    let group = null;
    let gi = -1;
    for (const g of a.groups) {
      if (el.matches(g.selector)) {
        group = g;
        gi = groupCount.get(g.key) ?? 0;
        groupCount.set(g.key, gi + 1);
        break;
      }
    }
    if (!key && group) key = group.key;
    if (!key) key = `${kind}:${label || '(unlabelled)'}${href ? ` ${href}` : ''}`;

    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset[disabled]'));
    let never = null;
    if (neverSel && el.matches(neverSel)) never = 'selector';
    // Text rules guard buttons; a same-origin link only navigates (a GET), so it is safe.
    else if (!(tag === 'a' && !external) && neverText.some((re) => re.test(label))) never = 'text';
    if (recordOnlySel && el.matches(recordOnlySel)) {
      clickable = false;
      why ??= 'field (record only)';
    }
    if (disabled) {
      clickable = false;
      why = 'disabled';
    }
    if (never) {
      clickable = false;
      why = `neverClick (${never})`;
    }
    if (group && gi >= group.sample) {
      clickable = false;
      why ??= `group sample (${group.sample})`;
    }
    const clickId = group ? `${key}#${gi}` : key;
    els.push(el);
    const volatile = !!volatileSel && el.matches(volatileSel);
    const rec = { key, label, kind, tag, clickId, clickable, why, href, external, disabled, never: !!never, volatile, domIndex: els.length - 1, group: group?.key ?? null, inLayer: !!layerRoot && layerRoot.contains(el) };
    if (a.full) Object.assign(rec, measure(el, target, r, cs));
    out.push(rec);
  }
  window.__uxEls = els;

  // ---- cards ------------------------------------------------------------------
  const cards = [];
  if (a.full) {
    const knownSel = a.cards.known.join(',');
    const exSel = a.cards.exclude.join(',');
    const controlSel = a.selectors.join(',');
    const effBg = (n) => {
      for (let p = n; p; p = p.parentElement) {
        const c = getComputedStyle(p).backgroundColor;
        if (alpha(c) > 0) return c;
      }
      return 'rgba(0, 0, 0, 0)';
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[aria-hidden="true"],nextjs-portal')) continue;
      const known = !!knownSel && el.matches(knownSel);
      if (!known && exSel && el.matches(exSel)) continue;
      // A control is not a card (a link or button card is listed in cards.known).
      if (!known && el.matches(controlSel)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.display === 'contents' || cs.display === 'inline') continue;
      const r = el.getBoundingClientRect();
      if (!known) {
        if (r.width < a.cards.minWidth || r.height < a.cards.minHeight) continue;
        const rad = parseFloat(cs.borderTopLeftRadius) || parseFloat(cs.borderBottomRightRadius);
        if (!(rad > 0)) continue;
        if (rad >= r.height / 2 - 1) continue; // a pill, not a card
        if (!el.children.length || !(el.textContent ?? '').trim()) continue;
        const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
        const allBorders = bw.every((w) => w >= 1) && alpha(cs.borderTopColor) > 0 && cs.borderTopStyle !== 'none';
        const ownBg = alpha(cs.backgroundColor) > 0 && cs.backgroundColor !== effBg(el.parentElement);
        const shadow = cs.boxShadow && cs.boxShadow !== 'none';
        if (!allBorders && !ownBg && !shadow) continue;
      }
      if (!visible(el, r)) continue;
      const st = styleOf(cs);
      const sc = scopeOf(el);
      cards.push({
        classes: [...el.classList],
        ancestors: ancestorsOf(el),
        tag: el.tagName.toLowerCase(),
        known,
        interactive: el.matches('a[href],button,[role=button]'),
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        parentBg: effBg(el.parentElement),
        ...sc,
        tok: tokensAt(el, sc.family),
        style: st,
        inLayer: !!layerRoot && layerRoot.contains(el),
        text: norm(el.textContent, 40),
      });
    }
  }

  // Every selector present in the page's live stylesheets, normalised (see normSel in
  // source-index.mjs, which must stay in step). The source index attributes a style only to
  // rules the page actually loaded: /delete-account has `.tp-legal .tp-btn` but not the
  // café sheet's `.tp-btn`, so pointing at cafe/base.css.ts there would be wrong.
  let cssSelectors = null;
  if (a.full) {
    const normSel = (x) =>
      x
        .replace(/\s+/g, ' ')
        .replace(/'/g, '"')
        .replace(/\[\s*([\w-]+)\s*([~|^$*]?=)\s*"?([^"\]]*?)"?\s*\]/g, '[$1$2"$3"]')
        .replace(/\s*([>+~,])\s*/g, '$1')
        .replace(/(^|[ >+~(,])\*(?=[:.\[#])/g, '$1')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .trim();
    const splitTop = (txt) => {
      const outS = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        else if (ch === ',' && depth === 0) {
          outS.push(txt.slice(start, i));
          start = i + 1;
        }
      }
      outS.push(txt.slice(start));
      return outS;
    };
    const set = new Set();
    const walkRules = (rules) => {
      for (const r of rules) {
        if (r.selectorText) for (const one of splitTop(r.selectorText)) if (one.includes('tp-')) set.add(normSel(one));
        if (r.cssRules) walkRules(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walkRules(sheet.cssRules);
      } catch {
        /* cross-origin sheet */
      }
    }
    cssSelectors = [...set].sort();
  }

  // Custom properties defined at each theme scope root (for the undefined-token audit).
  const defined = {};
  if (a.full) {
    for (const root of document.querySelectorAll('[data-theme]')) {
      const fam = root.getAttribute('data-theme');
      const names = defined[fam] ?? new Set();
      const rcs = getComputedStyle(root);
      for (let i = 0; i < rcs.length; i++) if (rcs[i].startsWith('--tp-')) names.add(rcs[i]);
      defined[fam] = names;
    }
  }
  delete tokScopes.__ids;

  const overlay = (() => {
    const portal = document.querySelector('nextjs-portal');
    const sr = portal?.shadowRoot;
    if (!sr) return null;
    const dlg = sr.querySelector('[data-nextjs-dialog]');
    return dlg ? norm(dlg.textContent, 120) : null;
  })();

  return {
    pathname: normPath(location.pathname),
    rawPath: location.pathname + location.search,
    title: norm(document.title, 80),
    layer: layerRoot ? `${layerName}` : 'page',
    elements: out,
    cards,
    tokScopes,
    defined: Object.fromEntries(Object.entries(defined).map(([k, v]) => [k, [...v].sort()])),
    cssSelectors,
    overlay,
  };
}
