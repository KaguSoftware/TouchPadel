/**
 * The six in-device screens, recreated in HTML/CSS at iPhone 16 Pro logical
 * points (393x852) from the app's own tokens and the app's own strings.
 *
 * WHY A RECREATION AND NOT A DEVICE CAPTURE
 * -----------------------------------------
 * Apple's guideline is that a screenshot shows the app as it actually is. These
 * are recreations of shipped screens, laid out from their React Native source
 * (file named above each screen), in the shipped palette, with the shipped copy
 * pulled out of `packages/i18n` — not invented UI, and not a feature the app
 * does not have.
 *
 * They still are not photographs of the binary, and the moment a real capture
 * exists it should win. Drop `<slug>.png` into `capture/<locale>/` and the
 * renderer frames the real pixels for that frame and ignores the recreation
 * below. See capture/README.md.
 *
 * Every string arrives as `t` — there are no copy literals in here.
 *
 * iOS CHROME. The iOS build draws its own bars: the tab bar is the real
 * `UITabBar` through expo-router NativeTabs (src/navigation/TabsLayout.ios.tsx:
 * Bookings · Book · Profile, SF Symbols calendar / figure.tennis /
 * person.crop.circle, brand-green selection) and every pushed screen has the
 * native `UINavigationBar` with a chevron-only back item
 * (src/navigation/headerOptions.tsx). Both are drawn here in their iOS 26
 * (Liquid Glass) form. The SF Symbols are approximations.
 */
import { dark as c, brand, lightGreens, DEVICE_PT } from './tokens.mjs';

const W = DEVICE_PT.width;
const H = DEVICE_PT.height;
const TOP = DEVICE_PT.insetTop;
const BOTTOM = DEVICE_PT.insetBottom;
/** useTabBarHeight on iOS: 49 + the home-indicator inset. */
const TAB_BAR_H = 49 + BOTTOM;
/** UINavigationBar content height. */
const NAV_H = 44;

/* ── icons (src/components/icons.tsx, 24-viewBox strokes) ────────────────── */

const stroke = (d, size, color, sw = 2, flip = false) =>
  `<svg class="ic${flip ? ' flip' : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

const I = {
  calendar: (s, col, sw) => stroke('M3.5 5.5h17v15h-17zM3.5 10h17M8 3v4M16 3v4', s, col, sw),
  clock: (s, col, sw) => stroke('M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z', s, col, sw),
  stopwatch: (s, col, sw) => stroke('M12 9v4l2.5 2M12 5.5a7.5 7.5 0 107.5 7.5A7.5 7.5 0 0012 5.5zM10 2.5h4', s, col, sw),
  tag: (s, col, sw) => stroke('M13.2 3H5v8.2L12.8 19a2 2 0 002.8 0l5.4-5.4a2 2 0 000-2.8L13.2 3zM8.7 7.7h.01', s, col, sw),
  bell: (s, col, sw) => stroke('M12 4a6 6 0 00-6 6c0 5-1.5 6-2 7h16c-.5-1-2-2-2-7a6 6 0 00-6-6zM10 20a2 2 0 004 0', s, col, sw),
  globe: (s, col, sw) => stroke('M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18M21 12a9 9 0 11-18 0 9 9 0 0118 0z', s, col, sw),
  moon: (s, col, sw) => stroke('M20.5 14A8.7 8.7 0 1110 3.5a7.5 7.5 0 0010.5 10.5z', s, col, sw),
  phone: (s, col, sw) => stroke('M8 3h8a1.5 1.5 0 011.5 1.5v15A1.5 1.5 0 0116 21H8a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 018 3zM10.5 17.8h3', s, col, sw),
  lock: (s, col, sw) => stroke('M8 10.5V8a4 4 0 018 0v2.5M5.5 10.5h13V20h-13v-9.5z', s, col, sw),
  check: (s, col, sw) => stroke('M4.5 12.5l5 5 10-11', s, col, sw),
  close: (s, col, sw) => stroke('M6 6l12 12M18 6L6 18', s, col, sw),
  chevron: (s, col, sw) => stroke('M9 6l6 6-6 6', s, col, sw, true),
  card: (s, col, sw = 2) =>
    `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/></svg>`,
  ball: (s, fill, strokeCol, sw) =>
    `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" fill="${fill}"/><path d="M10 7.5c7.5 9 7.5 24 0 33M38 7.5c-7.5 9-7.5 24 0 33" stroke="${strokeCol}" stroke-width="${sw}"/></svg>`,
};

/** The green hand-drawn underline under page titles (TitleSquiggle, mirrored in RTL). */
const SQUIGGLE = `<svg class="squiggle flip" width="76" height="8" viewBox="0 0 76 8" fill="none"><path d="M2 6C22 1 50 1 74 4.5" stroke="${brand.green}" stroke-width="3.5" stroke-linecap="round"/></svg>`;

/* ── brand pattern (src/theme/brandPattern.ts, ported) ───────────────────── */

const PATTERN_VIEWBOX = { width: 239.6797, height: 349.4609 };
const PATTERN_LINES = [
  [233.3, -6.82, -4.17, 138.2],
  [120.95, -4.54, 246.26, 177.12],
  [245.3, 19.16, -5.62, 267.8],
  [-3.21, 38.81, 235.26, 196.89],
  [74.92, -3.4, -7.22, 171.11],
  [31.81, -5.95, -4.11, 26.19],
  [20.1, 130.23, 243.69, 259.48],
  [224.51, 206.45, 1.21, 240.4],
  [232.67, 43.01, 63.62, 353.29],
  [237.23, 216.86, -2.38, 291.85],
  [241.32, 330.1, 111.56, 357.28],
];
const PATTERN_ZOOM = 2;
const PATTERN_WIDTH = 1.1;

/** Each band as the infinite line through it, clipped to the panel (buildField, radius 0). */
function patternField() {
  const { width: PW, height: PH } = PATTERN_VIEWBOX;
  const out = [];
  for (const [x1, y1, x2, y2] of PATTERN_LINES) {
    let a = y2 - y1;
    let b = x1 - x2;
    const n = Math.hypot(a, b);
    a /= n;
    b /= n;
    const cc = a * x1 + b * y1;
    const ox = a * cc;
    const oy = b * cc;
    const dx = -b;
    const dy = a;
    const ts = [];
    const hit = (t, x, y) => {
      if (x >= -1e-6 && x <= PW + 1e-6 && y >= -1e-6 && y <= PH + 1e-6) ts.push(t);
    };
    if (Math.abs(dx) > 1e-12) for (const x of [0, PW]) { const t = (x - ox) / dx; hit(t, x, oy + t * dy); }
    if (Math.abs(dy) > 1e-12) for (const y of [0, PH]) { const t = (y - oy) / dy; hit(t, ox + t * dx, y); }
    if (ts.length < 2) continue;
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    out.push([ox + lo * dx, oy + lo * dy, ox + hi * dx, oy + hi * dy]);
  }
  return out;
}
const FIELD = patternField();

/** BrandPattern: lines only, cropped `slice` × PATTERN_ZOOM into a box. */
function pattern(bw, bh, color, alpha) {
  const scale = Math.max(bw / PATTERN_VIEWBOX.width, bh / PATTERN_VIEWBOX.height) * PATTERN_ZOOM;
  const x0 = (bw - PATTERN_VIEWBOX.width * scale) / 2;
  const y0 = (bh - PATTERN_VIEWBOX.height * scale) / 2;
  const lines = FIELD.map(
    ([x1, y1, x2, y2]) =>
      `<line x1="${(x0 + x1 * scale).toFixed(1)}" y1="${(y0 + y1 * scale).toFixed(1)}" x2="${(x0 + x2 * scale).toFixed(1)}" y2="${(y0 + y2 * scale).toFixed(1)}"/>`,
  ).join('');
  return `<svg class="pattern" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}"><g opacity="${alpha}" stroke="${color}" stroke-width="${(PATTERN_WIDTH * scale).toFixed(2)}">${lines}</g></svg>`;
}

/* ── shared chrome ─────────────────────────────────────────────────────────── */

/**
 * iOS status bar. ALWAYS left-to-right: the system bar does not follow the
 * app's in-app language (the native root is pinned LTR, src/i18n/nativeDirection.ts).
 */
function statusBar(t) {
  return `
  <div class="sb" dir="ltr">
    <div class="island"></div>
    <div class="sb-time">${t.statusTime}</div>
    <div class="sb-icons">
      <svg width="18" height="12" viewBox="0 0 18 12" fill="#fff"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="M1 4.2a10 10 0 0 1 14 0"/><path d="M3.6 6.9a6.4 6.4 0 0 1 8.8 0"/><circle cx="8" cy="10" r="1.1" fill="#fff" stroke="none"/></svg>
      <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x=".6" y=".6" width="21" height="10.8" rx="3" stroke="#fff" stroke-opacity=".45"/><rect x="2.2" y="2.2" width="17.8" height="7.6" rx="1.8" fill="#fff"/><path d="M23 4.3v3.4a2 2 0 0 0 0-3.4Z" fill="#fff" fill-opacity=".45"/></svg>
    </div>
  </div>`;
}

const homeIndicator = `<div class="home-ind"></div>`;

/** Native UINavigationBar: chevron-only glass back item + centred title (mirrors in RTL). */
function navBar(title) {
  return `
  <div class="nav">
    <div class="nav-back">${stroke('M15 5l-7 7 7 7', 22, c.blue, 2.4, true)}</div>
    <div class="nav-t">${title}</div>
  </div>`;
}

/* SF Symbols, approximated. */
const SF = {
  calendar: (col) =>
    `<svg width="26" height="24" viewBox="0 0 26 24" fill="none"><rect x="2.5" y="3.5" width="21" height="18" rx="4" stroke="${col}" stroke-width="1.9"/><path d="M2.5 8.2h21" stroke="${col}" stroke-width="1.9"/><path d="M4 4.6h18v3H4z" fill="${col}"/><g fill="${col}"><circle cx="8" cy="12.5" r="1.2"/><circle cx="13" cy="12.5" r="1.2"/><circle cx="18" cy="12.5" r="1.2"/><circle cx="8" cy="17" r="1.2"/><circle cx="13" cy="17" r="1.2"/></g></svg>`,
  tennis: (col) =>
    `<svg width="26" height="24" viewBox="0 0 26 24" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="3.6" r="2.2" fill="${col}" stroke="none"/><path d="M9.6 7.4 8.8 14l3.4 3.2 1 5.3M8.8 14l-3 3.4-2.3 4.8M9.4 8.6 5.2 11M9.8 8.4l4.2 1.6 3.4-2.6"/><ellipse cx="20.2" cy="4.8" rx="2.6" ry="3.4" transform="rotate(35 20.2 4.8)"/></svg>`,
  person: (col) =>
    `<svg width="26" height="24" viewBox="0 0 26 24" fill="none"><circle cx="13" cy="12" r="10" stroke="${col}" stroke-width="1.9"/><circle cx="13" cy="9.6" r="3.4" fill="${col}"/><path d="M6.4 18.6c1.6-2.4 3.9-3.6 6.6-3.6s5 1.2 6.6 3.6" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

/** iOS 26 tab bar (NativeTabs). Order is fixed: Bookings · Book · Profile. */
function tabBar(t, active) {
  const item = (key, icon, label) => {
    const on = active === key;
    const col = on ? brand.green : c.fnt2;
    return `<div class="tab ${on ? 'on' : ''}">${SF[icon](col)}<div class="tab-l">${label}</div></div>`;
  };
  return `
  <div class="tabbar" dir="ltr">
    ${item('bookings', 'calendar', t.tabBookings)}
    ${item('book', 'tennis', t.tabBook)}
    ${item('profile', 'person', t.tabProfile)}
  </div>
  ${homeIndicator}`;
}

/** ui.tsx Title: 26 pt Black, uppercase + tracking in Latin only, squiggle below. */
function title(text) {
  return `<div class="title"><div class="title-t">${text}</div>${SQUIGGLE}</div>`;
}

/* ── 1 · Book tab — app/(tabs)/index.tsx ───────────────────────────────────── */

const DEG = Math.PI / 180;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/**
 * The court's camera at rest (courtTransition/spec.ts SPEC.camera at p = 0 and
 * rally.ts cameraPose): 89.5° elevation, 60 m out, 24° vertical fov, looking at
 * z = −0.8, far wall up the screen. Returns a projector into a w × h box.
 */
function courtProjector(w, h) {
  const el = 89.5 * DEG;
  const pos = [0, 60 * Math.sin(el), 60 * Math.cos(el)];
  const zAxis = norm3(sub3(pos, [0, 0, -0.8]));
  const xAxis = norm3(cross3([0, 0, -1], zAxis));
  const yAxis = cross3(zAxis, xAxis);
  const f = 1 / Math.tan(12 * DEG);
  const aspect = w / h;
  return (p) => {
    const r = sub3(p, pos);
    const vz = dot3(r, zAxis);
    return [
      ((dot3(r, xAxis) / -vz) * (f / aspect) + 1) / 2 * w,
      (1 - (dot3(r, yAxis) / -vz) * f) / 2 * h,
    ];
  };
}

/** camera.ts courtTopFraction: the blank band above the far wall, as a fraction of the box. */
function courtTopFraction() {
  const proj = courtProjector(390, 844);
  return Math.min(proj([0, 4, -10])[1], proj([0, 0, -10.7])[1]) / 844;
}

/** The Book tab's vertical budget, from the source's own numbers. */
function bookGeometry() {
  const header = 10 + 30 + 6; // header row: paddingTop 10, 30 pt logo, paddingBottom 6
  const titleRow = 12 + 27 + 4 + 8 + 8; // paddingTop sm, 26×1.05 line, squiggle 4+8, marginBottom s
  const stageTop = TOP + header + titleRow;
  const stageH = H - stageTop;
  const stageBox = stageH - TAB_BAR_H;
  const f = courtTopFraction();
  const m = Math.max(0, Math.round((f * stageBox - 8) / (1 - f)));
  return { stageTop, boxTop: stageTop - m, boxH: stageBox + m };
}

function courtSvg(boxH) {
  const P = courtProjector(W, boxH);
  const pt = (p) => P(p).map((v) => v.toFixed(1)).join(',');
  const poly = (pts, attrs) => `<polygon points="${pts.map(pt).join(' ')}" ${attrs}/>`;
  const seg = (a, b, attrs) => {
    const [x1, y1] = P(a);
    const [x2, y2] = P(b);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${attrs}/>`;
  };
  const pxPerM = P([1, 0, 0])[0] - P([0, 0, 0])[0];
  const out = [];

  // base slab + turf (scene.ts: navy slab 11.4 × 21.4, turf 10 × 20 in TURF)
  out.push(poly([[-5.7, -0.06, -10.7], [5.7, -0.06, -10.7], [5.7, -0.06, 10.7], [-5.7, -0.06, 10.7]], `fill="#1E3966"`));
  out.push(poly([[-5, 0, -10], [5, 0, -10], [5, 0, 10], [-5, 0, 10]], `fill="#3A63A9"`));

  // lines (scene.ts `line(...)` calls, 0.1 m wide, white)
  const lw = (0.1 * pxPerM).toFixed(2);
  const L = `stroke="#FFFFFF" stroke-width="${lw}"`;
  out.push(seg([-5, 0.02, -9.95], [5, 0.02, -9.95], L), seg([-5, 0.02, 9.95], [5, 0.02, 9.95], L));
  out.push(seg([-4.95, 0.02, -10], [-4.95, 0.02, 10], L), seg([4.95, 0.02, -10], [4.95, 0.02, 10], L));
  out.push(seg([-5, 0.02, -7], [5, 0.02, -7], L), seg([-5, 0.02, 7], [5, 0.02, 7], L));
  out.push(seg([0, 0.02, -10], [0, 0.02, -7], L), seg([0, 0.02, 10], [0, 0.02, 7], L));

  // ball's cast shadow on the turf
  const ball = [1.4, 2.4, 3.2];
  const [sx, sy] = P([ball[0] + 0.35, 0.01, ball[2] + 0.2]);
  out.push(`<ellipse cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${(0.3 * pxPerM).toFixed(1)}" ry="${(0.22 * pxPerM).toFixed(1)}" fill="${brand.navy}" opacity=".28"/>`);

  // rackets (brand sticker: blue face, white perforations, lime grip), flat
  const rackets = [
    { x: -2.3, z: -6.3, rot: 200 },
    { x: 2.3, z: -6.3, rot: 160 },
    { x: -2.3, z: 6.3, rot: -20 },
    { x: 2.3, z: 6.3, rot: 25 },
  ];
  for (const r of rackets) {
    const [rx, ry] = P([r.x, 0.75, r.z]);
    const k = pxPerM;
    const dots = [[-0.12, -0.2], [0.12, -0.2], [0, -0.08], [-0.12, 0.04], [0.12, 0.04], [0, 0.16]]
      .map(([dx, dy]) => `<circle cx="${(dx * k).toFixed(1)}" cy="${(dy * k).toFixed(1)}" r="${(0.035 * k).toFixed(2)}" fill="#fff" opacity=".85"/>`)
      .join('');
    out.push(`<g transform="translate(${rx.toFixed(1)} ${ry.toFixed(1)}) rotate(${r.rot})">
      <rect x="${(-0.05 * k).toFixed(1)}" y="${(0.3 * k).toFixed(1)}" width="${(0.1 * k).toFixed(1)}" height="${(0.36 * k).toFixed(1)}" rx="${(0.05 * k).toFixed(1)}" fill="${brand.green}"/>
      <path d="M0 ${(-0.42 * k).toFixed(1)} C ${(0.3 * k).toFixed(1)} ${(-0.42 * k).toFixed(1)} ${(0.32 * k).toFixed(1)} ${(0.05 * k).toFixed(1)} 0 ${(0.34 * k).toFixed(1)} C ${(-0.32 * k).toFixed(1)} ${(0.05 * k).toFixed(1)} ${(-0.3 * k).toFixed(1)} ${(-0.42 * k).toFixed(1)} 0 ${(-0.42 * k).toFixed(1)} Z" fill="${brand.blue}" stroke="#fff" stroke-width="${(0.04 * k).toFixed(2)}"/>
      ${dots}
    </g>`);
  }

  // net: navy wire mesh (edge-on from above), white tape, navy posts
  out.push(seg([-5.15, 0.02, 0], [5.15, 0.02, 0], `stroke="${brand.navy}" stroke-opacity=".55" stroke-width="1.2"`));
  out.push(seg([-5.15, 0.9, 0], [5.15, 0.9, 0], `stroke="#FFFFFF" stroke-width="${(0.07 * pxPerM).toFixed(2)}"`));
  for (const x of [-5.3, 5.3]) {
    const [px, py] = P([x, 1.05, 0]);
    out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(0.09 * pxPerM).toFixed(1)}" fill="${brand.navy}"/>`);
  }

  // the cage: lime glass with white window panes, navy mesh, rails, posts, mint caps
  const glass = `fill="${brand.green}" fill-opacity=".55"`;
  const paneA = `fill="#FFFFFF" fill-opacity=".75"`;
  const frame = `stroke="${brand.navy}" stroke-width="${Math.max(1, 0.08 * pxPerM).toFixed(2)}"`;
  const vquad = (a, b, y0, y1, attrs) =>
    poly([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], attrs);
  const mesh = (a, b, y0, y1) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.round(len * 4);
    const parts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[1] + (b[1] - a[1]) * u;
      parts.push(seg([x, y0, z], [x, y1, z], `stroke="${brand.navy}" stroke-opacity=".42" stroke-width=".6"`));
    }
    for (let j = 0; j <= Math.round((y1 - y0) * 4); j++) {
      const y = y0 + j / 4;
      parts.push(seg([a[0], y, a[1]], [b[0], y, b[1]], `stroke="${brand.navy}" stroke-opacity=".42" stroke-width=".6"`));
    }
    return parts.join('');
  };
  const post = (x, z, h) => {
    const parts = [seg([x, 0, z], [x, h, z], `stroke="${brand.navy}" stroke-width="${Math.max(1.2, 0.1 * pxPerM).toFixed(2)}"`)];
    const [px, py] = P([x, h + 0.04, z]);
    const s = 0.18 * pxPerM * 1.07;
    parts.push(`<rect x="${(px - s / 2).toFixed(1)}" y="${(py - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="#9FE0C8"/>`);
    return parts.join('');
  };
  for (const s of [-1, 1]) {
    const z = s * 10;
    out.push(vquad([-5, z], [5, z], 0, 3, glass));
    for (const o of [-4, -2, 0, 2, 4]) out.push(vquad([o - 0.7, z - s * 0.01], [o + 0.7, z - s * 0.01], 0.4, 2.6, paneA));
    out.push(mesh([-5, z], [5, z], 3, 4));
    out.push(seg([-5.05, 4, z], [5.05, 4, z], frame), seg([-5.05, 3, z], [5.05, 3, z], frame));
    for (const sx of [-1, 1]) {
      const x = sx * 5;
      out.push(vquad([x, s * 6], [x, s * 10], 0, 3, glass));
      for (const o of [-1, 1]) out.push(vquad([x - sx * 0.01, s * 8 + o - 0.7], [x - sx * 0.01, s * 8 + o + 0.7], 0.4, 2.6, paneA));
      out.push(mesh([x, s * 6], [x, s * 10], 3, 4));
      out.push(mesh([x, 0], [x, s * 6], 0, 3));
      out.push(seg([x, 4, s * 5.95], [x, 4, s * 10.05], frame), seg([x, 3, s * 5.95], [x, 3, s * 10.05], frame));
      out.push(seg([x, 3, s * -0.05], [x, 3, s * 6.05], frame));
    }
    for (const x of [-2.5, 0, 2.5]) out.push(post(x, z, 4));
    for (const sx of [-1, 1]) {
      out.push(post(sx * 5, s * 10, 4), post(sx * 5, s * 6, 4), post(sx * 5, s * 2, 3));
    }
  }

  const ballPx = P(ball);
  return {
    svg: `<svg class="court3d" width="${W}" height="${boxH}" viewBox="0 0 ${W} ${boxH}">${out.join('')}</svg>`,
    ball: { x: ballPx[0], y: ballPx[1], r: 0.22 * pxPerM * 1.05 },
    net: { left: P([-5.15, 0.9, 0])[0], right: P([5.15, 0.9, 0])[0], y: P([0, 0.9, 0])[1] },
  };
}

function screenBook(t, logoUrl) {
  const g = bookGeometry();
  const court = courtSvg(g.boxH);
  const ctaTop = g.boxTop + court.net.y - 24;
  const ballSvg = `<svg class="ball" style="left:${(court.ball.x - court.ball.r).toFixed(1)}px;top:${(g.boxTop + court.ball.y - court.ball.r).toFixed(1)}px" width="${(court.ball.r * 2).toFixed(1)}" height="${(court.ball.r * 2).toFixed(1)}" viewBox="-1 -1 2 2"><circle r="1" fill="${brand.green}"/><path d="M-.62 -.78c.5.45.62 1.2.18 1.62M.6 -.8c-.4.5-.5 1.25-.05 1.62" stroke="#F3F5F9" stroke-width=".16" fill="none"/></svg>`;
  return `
<div class="scr page">
  ${pattern(W, H, brand.green, 0.45)}
  <div class="abs" style="top:${g.boxTop}px;height:${g.boxH}px">${court.svg}</div>
  <div class="net-cta" style="top:${ctaTop.toFixed(1)}px;left:${court.net.left.toFixed(1)}px;width:${(court.net.right - court.net.left).toFixed(1)}px">
    <div class="net-cta-l">${t.checkAvailability}</div>
  </div>
  ${ballSvg}
  ${statusBar(t)}
  <div class="book-head">
    <img class="wordmark" src="${logoUrl}" alt=""/>
    <div class="openpill"><span class="dot"></span><span>${t.openNow}</span></div>
  </div>
  <div class="book-title">${title(t.bookTitle)}</div>
  <div class="court-foot" style="bottom:${TAB_BAR_H + 10}px"><div class="court-foot-shade"></div><span>${t.reserveFooter}</span></div>
  ${tabBar(t, 'book')}
</div>`;
}

/* ── 2 · Availability — app/availability.tsx ───────────────────────────────── */

function screenAvailability(t) {
  const days = t.days
    .map(
      (d, i) =>
        `<div class="day ${i === t.selectedDay ? 'on' : ''}"><div class="day-d">${d.dow}</div><div class="day-n">${d.num}</div></div>`,
    )
    .join('');

  // components/booking.tsx SlotCell (non-compact) + theme slotStateStyles.
  const cell = ([time, price, free]) =>
    price
      ? `<div class="slot free"><div class="slot-t">${time}</div><div class="slot-p">${price}</div><div class="slot-c ${free > 1 ? '' : 'last'}">${free > 1 ? t.capacityFree : t.capacityOne}</div></div>`
      : `<div class="slot booked"><div class="slot-t">${time}</div><div class="slot-p">${t.stateBooked}</div></div>`;
  const rows = [];
  for (let i = 0; i < t.slots.length; i += 2) {
    const pair = t.slots.slice(i, i + 2);
    rows.push(`<div class="slot-row">${pair.map(cell).join('')}${pair.length === 1 ? '<div class="slot-spacer"></div>' : ''}</div>`);
  }

  return `
<div class="scr bg">
  ${statusBar(t)}
  ${navBar(t.availabilityTitle)}
  <div class="dayrail"><div class="dayrail-in">${days}</div></div>
  <div class="seg-fit-row"><div class="seg fit"><div class="seg-i on">${t.duration60}</div></div></div>
  <div class="grid">
    ${rows.join('')}
    <div class="avail-foot">${t.availFooter}</div>
  </div>
  ${homeIndicator}
</div>`;
}

/* ── 3 · Review & confirm — app/review.tsx ─────────────────────────────────── */

/** components/booking.tsx SummaryGrid. */
function summaryGrid(rows, { iconColor, labelColor, valueColor }) {
  return `<div class="sumgrid">${rows
    .map(
      (r) => `<div class="sg-cell">
        <div class="sg-l">${r.icon(12, iconColor, 2)}<span style="color:${labelColor}">${r.label}</span></div>
        <div class="sg-v ${r.emphasis ? 'em' : ''}" style="color:${r.color ?? valueColor}">${r.value}</div>
      </div>`,
    )
    .join('')}</div>`;
}

function screenReview(t) {
  const playersChip = (label, on) => `<div class="pchip ${on ? 'on' : ''}">${label}</div>`;
  return `
<div class="scr bg">
  ${statusBar(t)}
  ${navBar(t.reviewTitle)}
  <div class="pad-x">
    <div class="hold">
      <div class="row-between baseline">
        <div class="hold-l">${I.stopwatch(13, brand.green, 2)}<span>${t.heldForYou}</span></div>
        <div class="hold-c">${t.holdCountdown}</div>
      </div>
      <div class="hold-track"><div class="hold-fill" style="width:${t.holdPct}%"></div></div>
      <div class="hold-b">${t.holdExplainer}</div>
    </div>

    <div class="card rv-card">
      <div class="rv-court">${t.courtA}</div>
      <div class="dashed"></div>
      ${summaryGrid(
        [
          { icon: I.calendar, label: t.lDate, value: t.vDate },
          { icon: I.clock, label: t.lTime, value: t.vTimeRange },
          { icon: I.stopwatch, label: t.lDuration, value: t.duration60 },
          { icon: I.tag, label: t.lPrice, value: t.vPrice, color: c.gtext, emphasis: true },
        ],
        { iconColor: brand.leaf, labelColor: c.fnt, valueColor: c.ink },
      )}
    </div>

    <div class="desk">
      <div class="desk-t">${I.card(14, c.gtext)}<span>${t.payAtDeskTitle}</span></div>
      <div class="desk-b">${t.payAtDeskBody}</div>
    </div>

    <div class="card players">
      <div class="pl-head"><span class="pl-t">${t.playersTitle}</span><span class="pl-o">${t.playersOptional}</span></div>
      <div class="pl-row">
        ${playersChip('2', t.players === 2)}
        ${playersChip('4', t.players === 4)}
        ${playersChip(t.playersOther, false)}
      </div>
    </div>

    <div class="policy">${t.policyLine}</div>
  </div>
  <div class="rv-dock">
    <div class="btn cta big">${t.reserveCta}</div>
  </div>
  ${homeIndicator}
</div>`;
}

/* ── 4 · Court reserved — app/success.tsx ──────────────────────────────────── */

function screenSuccess(t) {
  return `
<div class="scr navy">
  ${statusBar(t)}
  <div class="succ">
    <div class="succ-ring">${I.check(30, brand.greenInk, 3)}</div>
    <div class="succ-t">${t.successTitle}</div>
    <div class="succ-ref">${t.refLabel}</div>
    <div class="succ-card">
      <div class="succ-court">${t.courtA}</div>
      ${summaryGrid(
        [
          { icon: I.calendar, label: t.lDate, value: t.vDate },
          { icon: I.clock, label: t.lTime, value: t.vTimeRange },
          { icon: I.stopwatch, label: t.lDuration, value: t.duration60 },
          { icon: I.tag, label: t.lPrice, value: t.vPrice, color: brand.green, emphasis: true },
        ],
        { iconColor: brand.green, labelColor: brand.navyMuted, valueColor: brand.white },
      )}
    </div>
    <div class="succ-pay"><b>${t.payAtDeskTitle}. </b>${t.successPayBody}</div>
  </div>
  <div class="succ-dock">
    <div class="btn cta">${t.viewBooking}</div>
    <div class="btn done">${t.done}</div>
  </div>
  ${homeIndicator}
</div>`;
}

/* ── 5 · My reservations — app/(tabs)/bookings.tsx ─────────────────────────── */

function screenBookings(t) {
  const fchip = (icon, label, on) =>
    `<div class="fchip ${on ? 'on' : ''}">${icon(13, on ? brand.white : c.fnt, 2.2)}<span>${label}</span></div>`;

  // NextUpCard in blue mode: brand green ground, white pattern at 0.4, light-palette greens.
  const heroW = W - 32;
  const heroH = 158;
  const hero = `
    <div class="hero">
      ${pattern(heroW, heroH, brand.white, 0.4)}
      <div class="hero-in">
        <div class="hero-top">
          ${I.ball(15, brand.navy, brand.green, 3.5)}
          <span class="hero-eyebrow">${t.nextUp}</span>
          <span class="flex1"></span>
          <span class="hero-chip">${t.startsInDays}</span>
        </div>
        <div class="hero-court">${t.courtA}</div>
        <div class="hero-meta">
          <span class="meta">${I.calendar(13.5, lightGreens.gtext2, 2)}<span>${t.heroWhen}</span></span>
          <span class="meta">${I.clock(13.5, lightGreens.gtext2, 2)}<span>${t.vTimeRange}</span></span>
        </div>
        <div class="hero-div"></div>
        <div class="hero-foot">
          <span class="meta price">${I.tag(14, brand.greenInk, 2)}<span>${t.vPrice}</span></span>
          <span class="flex1"></span>
          <span class="hero-cta">${t.viewBooking}</span>
          ${I.chevron(13, lightGreens.gtext2, 2.6)}
        </div>
      </div>
    </div>`;

  const row = (b) => `
    <div class="up-row">
      <div class="badge"><div class="badge-m">${b.mon}</div><div class="badge-d">${b.day}</div></div>
      <div class="up-mid">
        <div class="up-court">${b.court}</div>
        <div class="up-meta">
          <span class="meta">${I.calendar(12.5, c.mut, 2)}<span>${b.dow}</span></span>
          <span class="meta">${I.clock(12.5, c.mut, 2)}<span>${b.range}</span></span>
        </div>
      </div>
      <div class="up-end">
        <div class="pill">${t.statusConfirmed}</div>
        <div class="up-price">${b.price}</div>
      </div>
      ${I.chevron(14, c.fnt3, 2.2)}
    </div>`;

  return `
<div class="scr bg">
  ${statusBar(t)}
  <div class="pad-x bk">
    ${title(t.myBookings)}
    <div class="fchips">
      ${fchip(I.calendar, t.upcomingCount, true)}
      ${fchip(I.check, t.playedCount, false)}
      ${fchip(I.close, t.cancelledCount, false)}
    </div>
    <div class="lhead">${I.calendar(13, c.fnt, 2.2)}<span class="section-label">${t.upcoming}</span><span class="lhead-rule"></span><span class="lhead-n">${t.heroCount}</span></div>
    ${hero}
    ${t.bookings.map(row).join('')}
  </div>
  ${tabBar(t, 'bookings')}
</div>`;
}

/* ── 6 · Settings — app/settings.tsx ───────────────────────────────────────── */

function screenSettings(t) {
  const group = (icon, label) => `<div class="grp">${icon(13, c.gstrong, 2)}<span class="micro">${label}</span></div>`;
  const seg = (items, pinLtr) =>
    `<div class="seg" ${pinLtr ? 'dir="ltr"' : ''}>${items.map(([label, on]) => `<div class="seg-i ${on ? 'on' : ''}">${label}</div>`).join('')}</div>`;
  return `
<div class="scr bg">
  ${statusBar(t)}
  ${navBar(t.settingsTitle)}
  <div class="pad-x set">
    <div class="card sc">
      ${group(I.moon, t.appearance)}
      ${seg([[t.themeSystem, false], [t.themeLight, false], [t.themeDark, true]], false)}
    </div>
    <div class="card sc">
      ${group(I.globe, t.language)}
      ${seg([[t.english, t.langActive === 'en'], [t.arabic, t.langActive === 'ar']], true)}
      <div class="note">${t.languageNote}</div>
    </div>
    <div class="card sc">
      ${group(I.bell, t.notifications)}
      <div class="granted">✓ ${t.notifGranted}</div>
      <div class="btn secondary compact">${t.sendTestPush}</div>
    </div>
    <div class="card sc">
      ${group(I.phone, t.venue)}
      <div class="venue">
        <div class="venue-l"><div class="venue-n">${t.appName}</div><div class="venue-p">${t.venuePhone}</div></div>
        <div class="btn primary callpill">${t.call}</div>
      </div>
    </div>
    <div class="card sc">
      ${group(I.lock, t.about)}
      <div class="about">
        <div class="btn secondary compact grow">${t.privacyPolicy}</div>
        <div class="btn secondary compact grow">${t.support}</div>
      </div>
    </div>
    <div class="version">${t.versionLine}</div>
  </div>
  ${homeIndicator}
</div>`;
}

/* ── registry ──────────────────────────────────────────────────────────────── */

export const SCREENS = {
  book: screenBook,
  availability: screenAvailability,
  review: screenReview,
  success: screenSuccess,
  bookings: screenBookings,
  settings: screenSettings,
};

/**
 * Screen CSS, authored in iPhone points. The renderer scales the whole `.scr`
 * box up to the poster's device width with one transform, so every value here
 * is directly comparable to the React Native stylesheet it mirrors.
 *
 * `--k` is the app's `tracking()`: letter-spacing is Latin-only (ThemeProvider
 * zeroes it for Arabic), and so is `text-transform: uppercase` on Title /
 * SectionLabel / MicroLabel / the hero (they switch it off under RTL).
 * Logical properties everywhere, so `dir="rtl"` mirrors the layout the way the
 * app's DirectionRoot does.
 */
export const screenCss = `
.scr{width:${W}px;height:${H}px;position:relative;overflow:hidden;
  display:flex;flex-direction:column;color:${c.ink};font-family:'Lama Sans',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;--k:1;}
.scr[dir='rtl'],[dir='rtl'] .scr{--k:0;}
.scr.page{background:${c.page};}
.scr.bg{background:${c.bg};}
.scr.navy{background:${brand.navy};}
.abs{position:absolute;left:0;right:0;}
.ic{display:block;flex:0 0 auto;}
[dir='rtl'] .flip{transform:scaleX(-1);}
.flex1{flex:1;}
.row-between{display:flex;align-items:center;justify-content:space-between;}
.row-between.baseline{align-items:baseline;}
.pad-x{padding-inline:16px;}
.pattern{position:absolute;left:0;top:0;pointer-events:none;}

/* status bar + home indicator */
.sb{height:${TOP}px;flex:0 0 ${TOP}px;display:flex;align-items:center;justify-content:space-between;
  padding:4px 30px 0 36px;position:relative;z-index:5;direction:ltr;}
.island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:125px;height:37px;
  border-radius:99px;background:#000;}
.sb-time{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-weight:600;font-size:17px;letter-spacing:-.2px;}
.sb-icons{display:flex;align-items:center;gap:6px;}
.home-ind{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:139px;height:5px;
  border-radius:99px;background:rgba(255,255,255,.7);z-index:6;}

/* native navigation bar (iOS 26) */
.nav{height:${NAV_H}px;flex:0 0 ${NAV_H}px;position:relative;display:flex;align-items:center;padding-inline:16px;}
.nav-back{width:44px;height:44px;border-radius:99px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.22),0 2px 10px rgba(0,0,0,.18);}
.nav-back .ic{margin-inline-end:2px;}
.nav-t{position:absolute;left:0;right:0;text-align:center;font-weight:800;font-size:17px;pointer-events:none;}
[dir='rtl'] .nav-t{font-size:16px;line-height:24px;}

/* tab bar (iOS 26 NativeTabs) */
.tabbar{position:absolute;left:24px;right:24px;bottom:22px;height:62px;border-radius:31px;z-index:5;
  display:flex;align-items:center;padding:0 5px;background:rgba(26,46,82,.72);
  backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%);
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.22),0 8px 28px rgba(0,0,0,.35);}
.tab{flex:1;height:52px;border-radius:26px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;}
.tab.on{background:rgba(255,255,255,.12);}
.tab-l{font-size:10px;font-weight:600;color:${c.fnt2};line-height:12px;}
.tab.on .tab-l{font-weight:800;color:${brand.green};}

/* Title (ui.tsx) */
.title{margin-bottom:8px;}
.title-t{font-weight:900;font-size:26px;line-height:27px;text-transform:uppercase;letter-spacing:calc(var(--k) * -.26px);}
[dir='rtl'] .title-t{text-transform:none;line-height:38px;}
.squiggle{display:block;margin-top:4px;}
.section-label{font-weight:800;font-size:11px;letter-spacing:calc(var(--k) * 1.1px);text-transform:uppercase;color:${c.mut};}
.micro{font-weight:800;font-size:11px;letter-spacing:calc(var(--k) * .66px);text-transform:uppercase;color:${c.mut};}
[dir='rtl'] .section-label,[dir='rtl'] .micro{text-transform:none;}
.card{background:${c.card};border:1px solid ${c.line};border-radius:16px;padding:16px;}

/* Button (ui.tsx) */
.btn{display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;text-transform:uppercase;
  border-radius:14px;padding:15px 16px;min-height:50px;font-size:13px;letter-spacing:calc(var(--k) * .65px);}
.btn.cta{background:${brand.green};color:${brand.greenInk};}
.btn.primary{background:${brand.blue};color:${brand.white};}
.btn.secondary{background:${c.card};color:${c.ink};border:1.5px solid ${c.line};}
.btn.compact{border-radius:12px;padding:13px 16px;min-height:44px;font-size:12px;letter-spacing:calc(var(--k) * .48px);}
.btn.grow{flex-grow:1;}

/* 1 · book */
.book-head{position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;
  padding:10px 16px 6px;}
.wordmark{height:30px;width:81px;object-fit:contain;display:block;}
.openpill{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 9px;padding-inline:9px 10px;border-radius:99px;
  background:rgba(28,53,94,.45);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  box-shadow:inset 0 0 0 .5px ${c.line};font-size:11px;font-weight:700;color:${c.mut};}
.openpill .dot{width:7px;height:7px;border-radius:99px;background:${brand.green};}
.book-title{position:relative;z-index:3;padding:12px 16px 0;}
.court3d{display:block;}
.net-cta{position:absolute;height:48px;border-radius:14px;background:${brand.green};z-index:2;
  display:flex;align-items:center;justify-content:center;padding-inline:16px;box-shadow:0 8px 0 ${brand.navy};}
.net-cta-l{font-weight:800;font-size:14px;letter-spacing:calc(var(--k) * .7px);text-transform:uppercase;
  color:${brand.greenInk};white-space:nowrap;transform:translateY(1px);}
.ball{position:absolute;z-index:3;}
.court-foot{position:absolute;left:16px;right:16px;z-index:3;text-align:center;font-size:11.5px;color:${c.fnt};}
.court-foot span{position:relative;}
.court-foot-shade{position:absolute;left:-16px;right:-16px;top:-16px;bottom:-16px;
  background:linear-gradient(180deg,rgba(23,44,79,0) 0,rgba(23,44,79,.465) 16px,rgba(23,44,79,.465) calc(100% - 16px),rgba(23,44,79,0) 100%);}

/* 2 · availability */
.dayrail{margin-inline:16px;overflow:hidden;flex:0 0 auto;}
.dayrail-in{display:flex;gap:7px;padding-top:10px;padding-bottom:2px;}
.day{min-width:52px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:1px;padding:8px 6px;
  border-radius:12px;border:1.5px solid ${c.line};background:${c.card};}
.day.on{background:${brand.blue};border-color:${brand.blue};}
.day-d{font-size:10px;font-weight:700;letter-spacing:calc(var(--k) * .6px);text-transform:uppercase;opacity:.75;line-height:14px;}
.day-n{font-size:16px;font-weight:800;line-height:21px;}
.day.on .day-d{opacity:.75;color:${brand.white};}
.seg-fit-row{display:flex;justify-content:center;margin-top:10px;padding-inline:16px;flex:0 0 auto;}
.seg{display:flex;background:${c.seg};border-radius:12px;padding:3px;margin-top:8px;}
.seg.fit{border-radius:10px;margin-top:0;}
.seg-i{flex:1;height:42px;display:flex;align-items:center;justify-content:center;border-radius:9px;
  font-size:12px;line-height:17px;font-weight:800;letter-spacing:calc(var(--k) * .36px);color:${c.mut};padding-inline:4px;}
.seg-i.on{background:${c.card};color:${c.blue};box-shadow:0 1px 2px rgba(27,42,71,.12);}
.seg.fit .seg-i{flex:0 0 auto;height:38px;border-radius:8px;padding-inline:12px;font-size:11.5px;line-height:16px;}
.seg.fit .seg-i.on{color:${c.gstrong};}
.grid{flex:1;min-height:0;padding:20px 34px 0;}
.slot-row{display:flex;gap:8px;margin-bottom:8px;}
.slot,.slot-spacer{flex:1;}
.slot{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 4px;min-height:52px;
  border-radius:12px;border:1.5px solid ${c.line2};background:${c.card};}
.slot-t{font-size:15px;font-weight:800;line-height:20px;}
.slot-p{font-size:10.5px;font-weight:700;line-height:14px;color:${c.gstrong};}
.slot-c{font-size:9.5px;font-weight:700;line-height:13px;letter-spacing:calc(var(--k) * .3px);color:${c.fnt};}
.slot-c.last{color:${c.ambstrong};}
.slot.booked{background:${c.sub};border-color:${c.sub};}
.slot.booked .slot-t,.slot.booked .slot-p{color:${c.fnt2};}
.avail-foot{margin-top:10px;text-align:center;font-size:11px;line-height:17px;color:${c.fnt};}

/* 3 · review */
.hold{margin-top:4px;background:${brand.navy};border-radius:14px;padding:12px 14px;}
.hold-l{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:calc(var(--k) * .66px);
  text-transform:uppercase;color:${brand.green};}
.hold-c{font-size:18px;font-weight:800;color:${brand.white};font-variant-numeric:tabular-nums;}
.hold-track{height:5px;border-radius:99px;background:${brand.navyTrack};margin-top:9px;overflow:hidden;}
.hold-fill{height:100%;border-radius:99px;background:${brand.green};}
.hold-b{margin-top:8px;font-size:11px;line-height:16px;color:${brand.navyText};}
.rv-card{margin-top:14px;}
.rv-court{font-size:20px;font-weight:900;text-transform:uppercase;line-height:26px;}
.dashed{height:0;border-top:1px dashed ${c.line};margin:13px 0;}
.sumgrid{display:flex;flex-wrap:wrap;row-gap:10px;}
.sg-cell{width:50%;padding-inline-end:8px;}
.sg-l{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:calc(var(--k) * .7px);text-transform:uppercase;line-height:14px;}
.sg-v{margin-top:3px;font-size:13px;font-weight:700;line-height:18px;}
.sg-v.em{font-weight:800;}
.desk{margin-top:12px;background:${c.gtint};border:1px solid ${c.gline};border-radius:14px;padding:13px 14px;}
.desk-t{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;font-weight:800;
  letter-spacing:calc(var(--k) * .6px);text-transform:uppercase;color:${c.gtext};}
.desk-b{font-size:12.5px;line-height:19px;color:${c.gtext2};}
.players{margin-top:12px;}
.pl-head{display:flex;align-items:baseline;gap:6px;}
.pl-t{font-size:11px;font-weight:700;letter-spacing:calc(var(--k) * .66px);text-transform:uppercase;color:${c.mut};}
.pl-o{font-size:11px;font-weight:400;color:${c.fnt};}
.pl-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.pchip{min-width:44px;height:44px;display:flex;align-items:center;justify-content:center;padding-inline:14px;
  border-radius:99px;background:${c.sub};border:1px solid ${c.line};font-size:13px;font-weight:700;color:${c.mut};}
.pchip.on{background:${brand.blue};border-color:${brand.blue};color:${brand.white};}
.policy{margin-top:12px;padding-inline:4px;font-size:11.5px;line-height:18px;color:${c.fnt};}
.rv-dock{position:absolute;left:0;right:0;bottom:0;padding:12px 16px ${20 + BOTTOM}px;
  background:linear-gradient(180deg,rgba(28,53,94,0) 0%,${c.bg} 40%);}
.btn.big{padding:16px;}

/* 4 · success */
.succ{display:flex;flex-direction:column;align-items:center;padding:40px 24px 24px;flex:1;}
.succ-ring{width:72px;height:72px;border-radius:99px;background:${brand.green};display:flex;align-items:center;justify-content:center;}
.succ-t{margin-top:20px;font-size:26px;font-weight:900;letter-spacing:calc(var(--k) * .26px);text-transform:uppercase;
  color:${brand.white};text-align:center;line-height:34px;}
.succ-ref{margin-top:6px;font-size:12px;font-weight:700;letter-spacing:calc(var(--k) * .96px);color:${brand.green};}
.succ-card{align-self:stretch;margin-top:22px;background:${brand.navyCard};border-radius:16px;padding:16px;}
.succ-court{font-size:16px;font-weight:800;text-transform:uppercase;color:${brand.white};margin-bottom:12px;}
.succ-pay{align-self:stretch;margin-top:12px;background:${brand.navyCard};border-radius:14px;padding:12px 14px;
  font-size:12.5px;line-height:19px;color:${brand.navyText};}
.succ-pay b{font-weight:800;color:${brand.white};}
.succ-dock{padding:0 16px ${22 + BOTTOM}px;display:flex;flex-direction:column;gap:9px;}
.btn.done{background:transparent;border:1px solid ${brand.navyLine};color:${brand.navyText};
  padding:14px 16px;min-height:46px;font-size:12px;letter-spacing:calc(var(--k) * .6px);}

/* 5 · bookings */
.bk{padding-top:16px;}
.fchips{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px;margin-bottom:4px;}
.fchip{display:flex;align-items:center;gap:5px;padding:6px 11px 6px 10px;padding-inline:10px 11px;border-radius:99px;
  background:${c.sub};border:1px solid ${c.line};font-size:12px;font-weight:700;color:${c.mut};}
.fchip.on{background:${brand.blue};border-color:${brand.blue};color:${brand.white};}
.lhead{display:flex;align-items:center;gap:8px;margin-top:6px;}
.lhead-rule{flex:1;height:.5px;background:${c.line};}
.lhead-n{font-size:10.5px;font-weight:800;color:${c.fnt};font-variant-numeric:tabular-nums;}
.hero{position:relative;margin-top:10px;border-radius:16px;background:${brand.green};overflow:hidden;}
.hero-in{position:relative;padding:16px;}
.hero-top{display:flex;align-items:center;gap:7px;}
.hero-eyebrow{font-size:10px;font-weight:800;letter-spacing:calc(var(--k) * 1.1px);text-transform:uppercase;color:${brand.greenInk};}
.hero-chip{padding:5px 9px;border-radius:99px;border:1px solid ${lightGreens.gph};font-size:10px;font-weight:800;
  letter-spacing:calc(var(--k) * .5px);text-transform:uppercase;color:${lightGreens.gtext2};}
[dir='rtl'] .hero-eyebrow,[dir='rtl'] .hero-chip,[dir='rtl'] .hero-cta{text-transform:none;}
.hero-court{margin-top:11px;font-size:21px;font-weight:900;color:${brand.greenInk};line-height:27px;}
.hero-meta{display:flex;flex-wrap:wrap;column-gap:14px;row-gap:4px;margin-top:5px;}
.meta{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:${lightGreens.gtext2};}
.meta.price{font-size:13px;font-weight:800;color:${brand.greenInk};}
.hero-div{height:.5px;background:${lightGreens.gph};margin-top:12px;}
.hero-foot{display:flex;align-items:center;gap:8px;margin-top:10px;}
.hero-cta{font-size:10.5px;font-weight:800;letter-spacing:calc(var(--k) * .7px);text-transform:uppercase;color:${lightGreens.gtext2};}
.up-row{margin-top:9px;display:flex;align-items:center;gap:12px;padding:12px;background:${c.card};
  border:1px solid ${c.line};border-radius:14px;box-shadow:0 1px 2px rgba(27,42,71,.12);}
.badge{width:48px;flex:0 0 48px;display:flex;flex-direction:column;align-items:center;background:${c.tint};border-radius:10px;padding:7px 0;}
.badge-m{font-size:9.5px;font-weight:700;letter-spacing:calc(var(--k) * .57px);text-transform:uppercase;color:${c.mut};line-height:13px;}
.badge-d{font-size:18px;font-weight:900;color:${c.blue};line-height:23px;}
.up-mid{flex:1;min-width:0;}
.up-court{font-size:14px;font-weight:800;line-height:19px;}
.up-meta{display:flex;flex-wrap:wrap;column-gap:11px;row-gap:2px;margin-top:3px;}
.up-meta .meta{font-size:11.5px;color:${c.mut};}
.up-end{display:flex;flex-direction:column;align-items:flex-end;gap:5px;}
.pill{padding:5px 9px;border-radius:99px;background:${c.gtint};font-size:10px;font-weight:800;
  letter-spacing:calc(var(--k) * .5px);text-transform:uppercase;color:${c.gtext};}
.up-price{font-size:11.5px;font-weight:800;color:${c.gstrong};white-space:nowrap;}

/* 6 · settings */
.set{padding-top:4px;display:flex;flex-direction:column;gap:12px;}
.sc{padding:14px;}
.grp{display:flex;align-items:center;gap:6px;}
.note{margin-top:8px;font-size:11.5px;line-height:17px;color:${c.fnt};}
.granted{margin-top:7px;font-size:12.5px;font-weight:700;color:${c.gtext};line-height:18px;}
.sc .btn.compact{margin-top:10px;}
.venue{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;}
.venue-l{flex:1;min-width:0;}
.venue-n{font-size:14px;font-weight:800;}
.venue-p{margin-top:2px;font-size:12px;color:${c.mut};}
.btn.callpill{min-height:0;padding:10px 18px;border-radius:99px;font-size:12px;letter-spacing:calc(var(--k) * .65px);}
.about{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;}
.about .btn.compact{margin-top:0;}
.version{text-align:center;margin-top:6px;font-size:11px;color:${c.fnt2};}
`;
