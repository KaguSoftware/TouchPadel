/**
 * The live court on a web page: the phone's three.js scene (scene.ts, copied)
 * drawn on a transparent canvas inside a host element. Not React: CourtStage
 * owns the component side and loads this module with a dynamic `import()`, so
 * three.js is never in the first-load chunk. The scratchpad harness mounts the
 * same factory directly.
 *
 * What it takes over from apps/mobile/src/components/Court3D.tsx is the SHAPE of
 * its loop, not its code (most of that file is expo-gl surface workarounds):
 *
 *  - one canvas, two passes: the court, then `clearDepth` and the ball overlay,
 *    so the ball, its trail and its disc are never hidden by the cage;
 *  - the rally clock (rallyClock.advance) billed only for drawn frames, and
 *    `lastFrameAt = null` on every stop, so hidden time is never rallied through;
 *  - the camera re-aspected before every render (scene.ts builds it at 390/844);
 *  - reduced motion = the rest frame (t = 0, which hides every trail ghost) drawn
 *    once, and again on resize, with no loop and no scroll link.
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
import { advance } from './rallyClock';
import { projectNet } from './camera';
import { buildCourtScene, type CourtScene } from './scene';
import { pitchEase } from './spec';
import { follow, scrollProgress } from './progress';
import { DPR_CAP } from './tier';
import { applyFit } from './framing';

export type CanvasTier = 'full' | 'lite';

/** The net tape's centre relative to the host's centre, and its span, in CSS px. */
export interface NetPlacement {
  dx: number;
  dy: number;
  width: number;
}

export interface CourtCanvasOptions {
  /** The box the canvas fills. Observed for size and visibility. */
  host: HTMLElement;
  tier: CanvasTier;
  /** Drive p from the host's position in the viewport (the landing hero). */
  scrollLinked?: boolean;
  /** A fixed p instead (0..1). Ignored when scrollLinked. Default 0. */
  progress?: number;
  /** Force the reduced-motion path regardless of the media query (harness, tests). */
  reducedMotion?: boolean;
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
  /** Set a fixed p (0..1); a no-op while scroll-linked. */
  setProgress(p: number): void;
  /** Draw one frame now at the current state (no clock advance). */
  renderOnce(): void;
  /** Hold the rally where it is (true) or let it run again (false). */
  setPaused(paused: boolean): void;
  dispose(): void;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
/** Longest wait for the async shader warm-up before drawing anyway. */
const WARM_CAP_MS = 2500;
/** Longest a disposed court waits for its warm-up before releasing the GPU anyway. */
const RELEASE_CAP_MS = 10_000;

export function createCourtCanvas(opts: CourtCanvasOptions): CourtCanvas {
  const { host, tier } = opts;
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
  renderer.shadowMap.enabled = tier === 'full';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const court: CourtScene = buildCourtScene(tier);
  const ease = pitchEase(1, 0);

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
  let fixedP = clamp01(opts.progress ?? 0);
  let targetP = fixedP;
  let shownP = fixedP;
  let rectDirty = true;
  let lastNet: NetPlacement | null = null;
  let fitFor = ''; // the aspect + k the camera zoom was last fitted for
  let compiled = false; // shaders warmed off the main thread (see the bottom)
  let paused = Boolean(opts.paused);

  const mql = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_QUERY) : null;
  let reduced = opts.reducedMotion ?? mql?.matches ?? false;
  const scrollLinked = () => Boolean(opts.scrollLinked) && !reduced;

  // ── drawing ─────────────────────────────────────────────────────────────
  function fit(): boolean {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w <= 0 || h <= 0) return false;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP[tier]));
      renderer.setSize(w, h, false); // CSS size comes from the stylesheet
      rectDirty = true;
    }
    if (court.camera.aspect !== w / h) {
      court.camera.aspect = w / h;
      court.camera.updateProjectionMatrix();
    }
    return true;
  }

  function readScroll(): void {
    if (!scrollLinked()) {
      targetP = reduced ? 0 : fixedP;
      return;
    }
    if (!rectDirty) return;
    rectDirty = false;
    const r = host.getBoundingClientRect();
    targetP = scrollProgress(r.top, r.height, window.innerHeight || r.height);
  }

  function draw(): void {
    if (!compiled || contextLost || disposed || !fit()) return;
    const p = reduced ? 0 : shownP;
    const k = ease(p);
    // Web framing: pull back only as far as the box needs to hold the whole court (framing.ts).
    const fitKey = `${court.camera.aspect.toFixed(4)}:${k.toFixed(4)}`;
    if (fitKey !== fitFor) {
      fitFor = fitKey;
      applyFit(court.camera, k);
    }
    court.update(reduced ? 0 : t, p, k);
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
    shownP = since === null ? targetP : follow(shownP, targetP, since / 1000);
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
      shownP = targetP;
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
    if (opts.reducedMotion !== undefined) return; // forced by the caller
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
    shownP = targetP;
    draw();
    // Seed visibility from the box itself: the observer's first report waits for
    // a rendering update, which an otherwise idle page may not have for a while,
    // and the rally should start with the page, not with the first scroll.
    intersecting = inViewport(host);
    sync();
  });

  return {
    canvas,
    setProgress(p) {
      fixedP = clamp01(p);
      if (!scrollLinked()) {
        targetP = fixedP;
        shownP = fixedP;
        if (raf === null) requestOnce();
      }
    },
    renderOnce() {
      draw();
    },
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

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
