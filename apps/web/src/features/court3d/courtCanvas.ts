/**
 * The live court on a web page: the app's own three.js court (@touch/court3d,
 * the same scene the phone draws) on a transparent canvas inside a host element.
 * Not React: CourtStage owns the component side and loads this module with a
 * dynamic `import()`, so three.js is never in the first-load chunk.
 *
 * ONE BUILD: the full court, at its best. Any browser with WebGL gets it (the
 * flat SVG court is only for a browser without): shadows on with the prototype's
 * 2048² map, the full racket, MSAA, and a pixel ratio up to 3 inside a pixel
 * budget (PIXEL_BUDGET) that is below what the phone app already draws full
 * screen. The ball spins by the rally clock, so a 120 Hz screen does not spin it
 * twice as fast.
 *
 * What it takes over from apps/mobile/src/components/Court3D.tsx is the SHAPE of
 * its loop, not its code (most of that file is expo-gl surface workarounds):
 *
 *  - one canvas, two passes: the court, then `clearDepth` and the ball overlay,
 *    so the ball, its trail and its disc are never hidden by the cage;
 *  - the rally clock (rallyClock.advance) billed only for drawn frames, and
 *    `lastFrameAt = null` on every stop, so hidden time is never rallied through;
 *  - reduced motion = the rest frame (t = 0, which hides every trail ghost, at
 *    K_REST) drawn once, and again on resize, with no loop and no scroll link.
 *
 * The camera is the site's, not the phone's: it never shows the flat top-down
 * diagram. It rests at a pitch where the court reads as a 3D model (progress.ts)
 * and, scroll-linked, sways a little as the section passes; frameCourt
 * (framing.ts) fills the box with the court at every pitch.
 *
 * The loop runs only while the host intersects the viewport AND the document is
 * visible AND the context is alive AND motion is allowed AND the visitor has not
 * paused it (`setPaused`, the stage's pause switch: WCAG 2.2.2). Everything the browser
 * reports (scroll, resize, visibility, the reduced-motion query) only marks
 * state; the reading and drawing happen inside requestAnimationFrame.
 *
 * The canvas is created HERE and removed on dispose, never reused: dispose calls
 * forceContextLoss() (React strict mode mounts twice in dev and browsers cap live
 * contexts at ~16), and a canvas whose context was lost that way hands the same
 * dead context to the next getContext().
 */
import * as THREE from 'three';
import { advance } from '@touch/court3d/rallyClock';
import { projectNet } from '@touch/court3d/camera';
import { buildCourtScene, type CourtScene } from '@touch/court3d/scene';
import { follow, K_REST, kFor, sectionProgress } from './progress';
import { frameCourt } from './framing';

/** The net tape's centre relative to the host's centre, and its span, in CSS px. */
export interface NetPlacement {
  dx: number;
  dy: number;
  width: number;
}

export interface CourtCanvasOptions {
  /** The box the canvas fills. Observed for size and visibility. */
  host: HTMLElement;
  /** Sway the camera with the page's scroll. Without it the court rests at K_REST. */
  scrollLinked?: boolean;
  /**
   * The element whose passage through the viewport drives the sway (the club
   * section). Default: the host. Pass the section when the host is sticky: a
   * sticky box's own rect hardly moves while the page scrolls.
   */
  scrollRoot?: HTMLElement;
  /** Start held still (the visitor paused the rally on an earlier visit). */
  paused?: boolean;
  /** Called once, after the first frame has been drawn. */
  onFirstFrame?: () => void;
  /** Called when the projected net tape moves (size or camera change). */
  onNet?: (net: NetPlacement) => void;
  /** A class for the created canvas. */
  canvasClassName?: string;
}

export interface CourtCanvas {
  readonly canvas: HTMLCanvasElement;
  /** Hold the rally where it is (true) or let it run again (false). */
  setPaused(paused: boolean): void;
  dispose(): void;
}

/**
 * Most device pixels the canvas may hold. A 544 × 673 desktop box at 2x is
 * 1.46 MP and a 357 × 442 phone box at 3x is 1.42 MP, so both draw at their
 * screen's full density; the phone app draws ~2.96 MP full screen with 4x MSAA.
 * Only an unusually large box is scaled back, never below 1x.
 */
export const PIXEL_BUDGET = 2_400_000;
/** The densest screen worth drawing for. */
export const DPR_MAX = 3;
/** The sun's shadow map, px square: the prototype's own (the phone saves at 1024). */
export const SHADOW_MAP_SIZE = 2048;

/** The pixel ratio for a w × h CSS-px box on a screen of density `dpr`. */
export function pixelRatioFor(w: number, h: number, dpr: number): number {
  const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h));
  return Math.max(1, Math.min(dpr > 0 ? dpr : 1, DPR_MAX, budget));
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
/** Longest wait for the async shader warm-up before drawing anyway. */
const WARM_CAP_MS = 2500;
/** Longest a disposed court waits for its warm-up before releasing the GPU anyway. */
const RELEASE_CAP_MS = 10_000;

export function createCourtCanvas(opts: CourtCanvasOptions): CourtCanvas {
  const { host } = opts;
  const scrollRoot = opts.scrollRoot ?? host;
  const canvas = document.createElement('canvas');
  if (opts.canvasClassName) canvas.className = opts.canvasClassName;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
    });
  } catch (err) {
    canvas.remove(); // leave the host as it was: the flat court stays
    throw err;
  }
  renderer.setClearColor(0x000000, 0); // transparent: the page paints behind the court
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const court: CourtScene = buildCourtScene('full', {
    spin: 'time',
    shadowMapSize: SHADOW_MAP_SIZE,
  });

  // ── state ───────────────────────────────────────────────────────────────
  let width = 0;
  let height = 0;
  let t = 0;
  let lastFrameAt: number | null = null;
  let raf: number | null = null;
  let intersecting = false;
  let visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  let contextLost = false;
  let disposed = false;
  let firstFrameDone = false;
  let targetK = K_REST;
  let shownK = K_REST;
  let rectDirty = true;
  let lastNet: NetPlacement | null = null;
  let framedFor = ''; // the size + k the camera was last framed for
  let compiled = false; // shaders warmed off the main thread (see the bottom)
  let paused = Boolean(opts.paused);

  const mql = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_QUERY) : null;
  let reduced = mql?.matches ?? false;
  const scrollLinked = () => Boolean(opts.scrollLinked) && !reduced;

  // ── drawing ─────────────────────────────────────────────────────────────
  function fit(): boolean {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w <= 0 || h <= 0) return false;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      renderer.setPixelRatio(pixelRatioFor(w, h, window.devicePixelRatio));
      renderer.setSize(w, h, false); // CSS size comes from the stylesheet
      rectDirty = true;
    }
    return true;
  }

  function readScroll(): void {
    if (!scrollLinked()) {
      targetK = K_REST;
      return;
    }
    if (!rectDirty) return;
    rectDirty = false;
    const r = scrollRoot.getBoundingClientRect();
    targetK = kFor(sectionProgress(r.top, r.height, window.innerHeight || r.height));
  }

  function draw(): void {
    if (!compiled || contextLost || disposed || !fit()) return;
    const k = reduced ? K_REST : shownK;
    const frameKey = `${width}x${height}:${k.toFixed(4)}`;
    if (frameKey !== framedFor) {
      framedFor = frameKey;
      frameCourt(court.camera, k, width, height);
    }
    // p = 0: the lines keep their full strength (the phone fades them under its
    // booking sheet; the site has no sheet).
    court.update(reduced ? 0 : t, 0, k);
    renderer.autoClear = true;
    renderer.render(court.scene, court.camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(court.overlay, court.camera);
    renderer.autoClear = true;
    emitNet(k);
    if (!firstFrameDone) {
      firstFrameDone = true;
      opts.onFirstFrame?.();
    }
  }

  function emitNet(k: number): void {
    if (!opts.onNet) return;
    const n = projectNet(k, width, height, court.camera);
    const next = {
      dx: Math.round((n.centreX - width / 2) * 10) / 10,
      dy: Math.round((n.centreY - height / 2) * 10) / 10,
      width: Math.round(n.width),
    };
    if (lastNet && lastNet.dx === next.dx && lastNet.dy === next.dy && lastNet.width === next.width) {
      return;
    }
    lastNet = next;
    opts.onNet(next);
  }

  // ── the loop ────────────────────────────────────────────────────────────
  const shouldRun = () =>
    compiled && intersecting && visible && !contextLost && !reduced && !disposed && !paused;

  function frame(now: number): void {
    raf = null;
    const since = lastFrameAt === null ? null : now - lastFrameAt;
    lastFrameAt = now;
    t = advance(t, since);
    readScroll();
    shownK = since === null ? targetK : follow(shownK, targetK, since / 1000);
    try {
      draw();
    } finally {
      if (shouldRun()) raf = requestAnimationFrame(frame);
      else lastFrameAt = null;
    }
  }

  function sync(): void {
    if (shouldRun()) {
      if (raf === null) raf = requestAnimationFrame(frame);
    } else {
      stop();
    }
  }

  function stop(): void {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    lastFrameAt = null;
  }

  /** One frame without the clock, on the next animation frame (coalesced). */
  let oncePending: number | null = null;
  function requestOnce(): void {
    if (raf !== null || oncePending !== null || disposed) return;
    oncePending = requestAnimationFrame(() => {
      oncePending = null;
      readScroll();
      shownK = targetK;
      draw();
    });
  }

  // ── observers ───────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    rectDirty = true;
    if (raf === null) requestOnce();
  });
  ro.observe(host);

  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[entries.length - 1];
      if (!e) return;
      intersecting = e.isIntersecting;
      sync();
    },
    { rootMargin: '64px 0px' },
  );
  io.observe(host);

  const onVisibility = () => {
    visible = document.visibilityState === 'visible';
    sync();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onScroll = () => {
    rectDirty = true;
    // While looping the next frame reads it; otherwise nothing is on screen to move.
  };
  if (opts.scrollLinked) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  const onReduced = (e: MediaQueryListEvent) => {
    reduced = e.matches;
    t = reduced ? 0 : t;
    sync();
    if (reduced) requestOnce();
  };
  mql?.addEventListener?.('change', onReduced);

  const onLost = (e: Event) => {
    e.preventDefault(); // ask the browser to restore it
    contextLost = true;
    stop();
  };
  const onRestored = () => {
    // three re-initialises its own state on restore; draw again from here.
    contextLost = false;
    width = 0; // force a fresh setSize
    sync();
    if (raf === null) requestOnce();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // Warm every shader first. compileAsync links the programs and, where the
  // browser has KHR_parallel_shader_compile, waits for them without blocking the
  // main thread: compiling ~30 programs inside the first render() is the single
  // longest task this court has (hundreds of ms on a mid phone). Capped, so a
  // compile that never reports ready (a context lost mid-way) cannot hold the
  // court back: render() then compiles whatever is left synchronously.
  const warm = Promise.all([
    renderer.compileAsync(court.scene, court.camera),
    renderer.compileAsync(court.overlay, court.camera),
  ]).catch(() => undefined);
  let warmSettled = false;
  void warm.then(() => {
    warmSettled = true;
  });
  const cap = new Promise<void>((resolve) => setTimeout(resolve, WARM_CAP_MS));
  void Promise.race([warm, cap]).then(() => {
    if (disposed) return;
    compiled = true;
    // The first frame goes out now, whether or not the loop starts: it is what
    // lets the stage cross-fade from the SVG to the canvas.
    readScroll();
    shownK = targetK;
    draw();
    // Seed visibility from the box itself: the observer's first report waits for
    // a rendering update, which an otherwise idle page may not have for a while,
    // and the rally should start with the page, not with the first scroll.
    intersecting = inViewport(host);
    sync();
  });

  return {
    canvas,
    setPaused(next) {
      if (paused === next) return;
      paused = next;
      // Paused: the loop stops and the last frame stays on the canvas, so the court holds
      // exactly where it was. Resumed: the clock picks up from there (lastFrameAt was
      // cleared on stop, so no paused time is rallied through).
      sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      if (oncePending !== null) cancelAnimationFrame(oncePending);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      mql?.removeEventListener?.('change', onReduced);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.remove();
      // compileAsync polls each material's program on a timer until it is ready;
      // disposing under it makes three read a program that is gone (it throws
      // from the timer). React strict mode unmounts right after mount in dev, so
      // this is the normal path there: the canvas leaves now, the GPU objects when
      // the warm-up settles (or after a cap, if it never does).
      const release = () => {
        court.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      if (warmSettled) release();
      else {
        const late = new Promise<void>((resolve) => setTimeout(resolve, RELEASE_CAP_MS));
        void Promise.race([warm, late]).then(release);
      }
    },
  };
}

function inViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
}
