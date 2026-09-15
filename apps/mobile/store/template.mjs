/**
 * The poster around the phone: ground, eyebrow, headline, device frame.
 *
 * Every dimension is expressed as a fraction of the canvas width or height, so
 * the same template renders 6.9" iPhone, 6.5" iPhone and Google Play phone
 * without a second set of numbers to keep in sync.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { brand, DEVICE_PT } from './tokens.mjs';
import { SCREENS, screenCss } from './screens.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = path.resolve(HERE, '..', '..', '..');

const fileUrl = (...p) => pathToFileURL(path.join(REPO, ...p)).href;

const FONT_DIR = ['packages', 'ui', 'fonts', 'lama', 'woff2'];
const LOGO = fileUrl('apps', 'mobile', 'assets', 'logo-white.png');

/**
 * The poster ground: two true shades of brand blue #3360AB (hue 217.5,
 * sat 54.05%) at L18 and L12 — the same construction rule the app's dark
 * palette follows, so the frame is darker than the app without introducing a
 * sixth colour. #152847 is `palettes.dark.seg` exactly.
 */
const GROUND_TOP = '#152847';
const GROUND_BOTTOM = '#0E1A2F';

function fontFaces() {
  const face = (file, weight) => `
@font-face{font-family:'Lama Sans';src:url('${fileUrl(...FONT_DIR, file)}') format('woff2');
  font-weight:${weight};font-style:normal;font-display:block;}`;
  return [
    face('LamaSans-Regular.woff2', 400),
    face('LamaSans-Medium.woff2', 500),
    face('LamaSans-SemiBold.woff2', 600),
    face('LamaSans-Bold.woff2', 700),
    face('LamaSans-ExtraBold.woff2', 800),
    face('LamaSans-Black.woff2', 900),
  ].join('\n');
}

/**
 * Geometry for one canvas size. The device is sized by whichever constraint
 * binds first — the width budget or the height left under the copy block — so a
 * frame can never overflow the canvas no matter which preset is rendered.
 */
function geometry(size) {
  const { width: W, height: H, deviceWidth } = size;
  const bezel = Math.round(W * 0.0109); // 14px at 1290
  const copyH = Math.round(H * 0.285);
  const bottomPad = Math.round(H * 0.023);
  const availH = H - copyH - bottomPad;

  const byWidth = deviceWidth - bezel * 2;
  const byHeight = ((availH - bezel * 2) * DEVICE_PT.width) / DEVICE_PT.height;
  const screenW = Math.floor(Math.min(byWidth, byHeight));
  const screenH = Math.round((screenW * DEVICE_PT.height) / DEVICE_PT.width);

  return {
    W,
    H,
    bezel,
    copyH,
    bottomPad,
    screenW,
    screenH,
    scale: screenW / DEVICE_PT.width,
    padX: Math.round(W * 0.085),
    padTop: Math.round(H * 0.063),
    eyebrow: Math.round(W * 0.0264), // 34px at 1290
    headline: Math.round(W * 0.0915), // 118px at 1290
    // iPhone display corner radius is ~14% of screen width.
    screenRadius: Math.round(screenW * 0.135),
  };
}

/**
 * One complete poster document.
 *
 * `capture` — an absolute file URL to a real device screenshot. When present it
 * replaces the HTML recreation entirely and nothing from screens.mjs is drawn.
 */
export function posterHtml({ size, locale, dir, t, frame, capture }) {
  const g = geometry(size);
  const inner = capture
    ? `<img class="capture" src="${capture}" alt=""/>`
    : `<div class="scr-scaler" dir="${dir}">${SCREENS[frame.screen](t, LOGO)}</div>`;

  const headline = frame.headline.map((line) => `<div class="hl-line">${line}</div>`).join('');

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"/>
<style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${g.W}px;height:${g.H}px;overflow:hidden;}
body{background:linear-gradient(180deg,${GROUND_TOP} 0%,${GROUND_BOTTOM} 100%);
  font-family:'Lama Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
  text-rendering:geometricPrecision;}

.poster{width:${g.W}px;height:${g.H}px;display:flex;flex-direction:column;position:relative;}

/* A very soft brand-green bloom behind the phone: it separates the device from
   the ground without adding a colour that is not already in the palette. */
.bloom{position:absolute;left:50%;top:${Math.round(g.H * 0.42)}px;width:${Math.round(g.W * 1.1)}px;
  height:${Math.round(g.W * 1.1)}px;transform:translate(-50%,-50%);pointer-events:none;
  background:radial-gradient(circle,rgba(165,208,111,.13) 0%,rgba(165,208,111,0) 62%);}

.copy{flex:0 0 ${g.copyH}px;padding:${g.padTop}px ${g.padX}px 0;position:relative;z-index:2;}
.eyebrow{font-size:${g.eyebrow}px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:${brand.green};}
.headline{margin-top:${Math.round(g.H * 0.019)}px;font-size:${g.headline}px;font-weight:800;
  line-height:1.06;letter-spacing:-.02em;color:${brand.white};}
.hl-line{white-space:nowrap;}

.stage{flex:1;display:flex;align-items:center;justify-content:center;
  padding-bottom:${g.bottomPad}px;position:relative;z-index:2;}

/* Device: a neutral dark shell in brand black, one hairline highlight for the
   glass edge, and a long soft drop so the phone sits ON the ground. */
.device{padding:${g.bezel}px;border-radius:${g.screenRadius + g.bezel}px;background:#0A0F18;
  box-shadow:0 0 0 1px rgba(255,255,255,.10),
             0 ${Math.round(g.H * 0.016)}px ${Math.round(g.H * 0.036)}px rgba(0,0,0,.55),
             0 ${Math.round(g.H * 0.004)}px ${Math.round(g.H * 0.010)}px rgba(0,0,0,.45);}
.screen{width:${g.screenW}px;height:${g.screenH}px;border-radius:${g.screenRadius}px;
  overflow:hidden;position:relative;background:${brand.navy};}
/* Physically pinned (left/top, not inset-inline) so an RTL poster does not park
   the 393pt screen at the right edge and then scale it off the canvas. The
   screen's own direction rides on this element's dir attribute. */
.scr-scaler{position:absolute;top:0;left:0;width:${DEVICE_PT.width}px;height:${DEVICE_PT.height}px;
  transform:scale(${g.scale});transform-origin:top left;}
/* A real capture FILLS the screen and is centre-cropped, never letterboxed. Every
   current iPhone is within 0.3 % of 393:852 — an iPhone 13's 1170×2532 loses
   about one poster pixel down each side at 6.9" — so the crop is invisible. A
   capture whose ratio is far off (an iPad, a 16:9 Android) would lose real
   content here: shoot it on an iPhone instead. */
.capture{width:${g.screenW}px;height:${g.screenH}px;object-fit:cover;object-position:50% 50%;display:block;}

${screenCss}
</style></head>
<body>
  <div class="poster">
    <div class="bloom"></div>
    <div class="copy">
      <div class="eyebrow">${frame.eyebrow}</div>
      <div class="headline">${headline}</div>
    </div>
    <div class="stage">
      <div class="device"><div class="screen">${inner}</div></div>
    </div>
  </div>
</body></html>`;
}

export { geometry };
