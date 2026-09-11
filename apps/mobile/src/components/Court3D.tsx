/**
 * The prototype's three.js court, on a phone (design 2026-09-01,
 * `docs/design/mobile-ui/Court Transition Prototype.html`): expo-gl surfaces
 * running the scene from features/courtTransition/scene.ts — glass + mesh cage,
 * real net, the `padel-racket.html` rackets swinging (racket.ts + swing.ts),
 * the ball with its trail and cast shadow — with the
 * camera orbit reading the SAME progress value `p` as every native layer
 * (the on-net button, the frosted sheet), exactly as the prototype's canvas
 * reads its `p` every frame.
 *
 * Two surfaces, as the prototype has two canvases: the court (opaque, the page
 * colour behind it), then `children` — the caller's on-net button — then a
 * TRANSPARENT surface with only the ball, its trail and its ground disc, so
 * the rally flies over the button while the ball's real shadow stays on the
 * turf beneath it. Both surfaces get `layerStyle` (the court layer's lift and
 * dim); the button between them is the caller's to move.
 *
 * The court surface is OPAQUE, and that is a frame-budget decision, not a
 * stylistic one. It was tried transparent so the Book tab's brand pattern
 * (BrandPattern, index.tsx) would show through the court, and the court froze
 * on device (owner, 2026-09-05): a full-screen translucent GL layer, over the
 * ball's translucent layer, over the pattern's SVG, with 4× MSAA on a ~1170 ×
 * 2532 buffer and the sheet's blur sampling the stack, costs more than the
 * phone has. When the GPU falls behind, `endFrameEXP` back-pressures the JS
 * thread — and BOTH the rally and the court's pitch are drawn from the one rAF
 * loop below, so a starved loop reads as frozen rackets AND a court stuck at
 * whatever pitch it last drew while the sheet slides on natively. An opaque
 * clear cuts the whole stack off at the court. The pattern therefore runs
 * behind the header and title row and stops at the stage; putting it back
 * under the court means drawing it INSIDE the scene (a textured backdrop
 * quad), not clearing to nothing.
 *
 * Runtime shape:
 *   · `p` arrives through a native-driven Animated.Value listener (per frame).
 *   · The whole stage is held at opacity 0 until the first frame of each VISIT
 *     has been drawn, then cross-fades in over REVEAL_MS — the scene takes a
 *     few hundred ms to build and used to appear in one frame (see REVEAL_MS).
 *     The stage is put down again on blur, so every return to the tab gets
 *     the same entrance, not just the first.
 *   · The rally advances on its OWN clock, one capped step per frame actually
 *     drawn (rallyClock.ts) rather than off the wall clock, so a JS thread busy
 *     with something else costs the animation frames and never a jump. The
 *     frame loop only runs while the tab is focused and the app is active
 *     (expo-router keeps tab screens mounted).
 *   · Reduced motion: the rally freezes on a rest frame and the scene renders
 *     only when `p` changes.
 *   · The rally NEVER idles out. It used to: after three rallies with `p` at
 *     rest and nothing touched, it held at the next leg start, stopped the loop
 *     and put a "rally paused" note over the court, to be woken by a touch.
 *     That was a battery decision, and it was the wrong trade — the court IS
 *     this tab, and someone reading the times or picking a day is watching it
 *     stop dead a quarter of a minute in (owner, 2026-09-10: "the background
 *     animation stops after a while when you are not active — make sure it's a
 *     loop"). Visibility is the only gate now, and it is the one that matters:
 *     the loop stops when the tab is not focused or the app is not frontmost,
 *     which is every case where nobody can see the court anyway.
 *   · Each GL surface is recreated by Android after backgrounding
 *     (onSurfaceTextureDestroyed → a NEW context), independently of the other,
 *     so attaching a context is idempotent per surface; the scene is shared.
 *   · No context / a build failure → `onUnavailable` and the caller shows the
 *     flat SVG court instead. Telemetry records it. A binary without the
 *     expo-gl native module (a dev client built before expo-gl was added) →
 *     the same fallback, decided at import time below.
 *   · Low-end phones (quality.ts, decided once from expo-device) get the
 *     `lite` scene: no shadow pass, no ball trail, 2× MSAA instead of 4×.
 *     The `quality` prop overrides the detection.
 *   · The on-net button is NOT positioned from here: the caller projects the
 *     tape with the same camera maths (camera.ts) into a native-driver table
 *     keyed on p, so the button rides the tape without per-frame JS.
 *   · The renderers are sized from this view's LAYOUT (dp × pixel ratio), not
 *     from `gl.drawingBufferWidth/Height`: expo-gl writes those once, at
 *     context creation, and never again. It does resize its buffers on layout,
 *     but three re-applies its own viewport every frame, so without this the
 *     picture stayed at the first layout's size (bottom-anchored, scaled) once
 *     the degraded banner shrank the stage — and the button left the tape
 *     (seen on device 2026-09-02).
 *
 * The camera's 24° fov is vertical, so the court fills this view's HEIGHT the
 * way it fills the prototype's 844 px canvas; a wider viewport only adds side
 * margin. The court surface's clear colour is the page colour (opaque), which
 * is also why the caller keeps the header above this view (index.tsx) once the
 * transition lifts it 60 px.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  Animated,
  AppState,
  Easing,
  PixelRatio,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { ExpoWebGLRenderingContext, GLView as GLViewComponent } from 'expo-gl';
import { useFocusEffect } from 'expo-router';
import * as THREE from 'three';
import { detectCourtQuality } from '../features/courtTransition/deviceQuality';
import type { CourtQuality } from '../features/courtTransition/quality';
import { buildCourtScene, type CourtScene } from '../features/courtTransition/scene';
import { advance as advanceRally } from '../features/courtTransition/rallyClock';
import { pitchEase, type Dir } from '../features/courtTransition/spec';
import { canAnimate, canDraw } from '../features/courtTransition/surfaceState';
import { frameRepaints } from '../features/courtTransition/staleCover';
import { addBreadcrumb, captureException, captureMessage, describeError } from '../lib/telemetry';
import { brand, useTheme } from '../theme';
import { PATTERN_DEFAULT_OPACITY, patternInk } from '../theme/brandPattern';

/**
 * expo-gl resolves its native module at import time (GLView.js top level), so a
 * bare `import { GLView }` crashes this whole route module on any binary built
 * before expo-gl was added (a stale dev client) — expo-router then reports the
 * route as "missing the required default export" and the Book tab is dead.
 * Require it in a try/catch instead: a stale binary throws right here and
 * GLView stays null — the mount effect below fires `onUnavailable` and the
 * caller shows the flat SVG court. On web there is no native module at all
 * (GLView.web.js is plain WebGL), so a name probe would wrongly reject it;
 * the require itself is the only test that is right on every platform.
 */
const GLView: typeof GLViewComponent | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-gl') as { GLView: typeof GLViewComponent }).GLView;
  } catch {
    return null;
  }
})();

/**
 * Silence three's WebGL1 deprecation warning on a context that is WebGL2.
 *
 * three's check is `_gl instanceof WebGLRenderingContext` (WebGLRenderer,
 * r153+). That is wrong for any spec-compliant implementation: the WebGL spec
 * has WebGL2RenderingContext INHERIT from WebGLRenderingContext, so a real
 * WebGL2 context is `instanceof` both. expo-gl implements that inheritance
 * deliberately (common/EXWebGLRenderer.cpp — "gives `instanceof
 * WebGLRenderingContext` the right answer for WebGL2 instances"), so the
 * warning fires on a context that is genuinely WebGL2 and nothing about the
 * context object can suppress it.
 *
 * Note this is only the WARNING. three's separate capability probe reads
 * `gl.constructor.name`, and expo-gl already names the constructor
 * 'WebGL2RenderingContext' on a WebGL2 device, so the fast paths (VAOs,
 * instancing) were never lost — there is no rendering bug hiding under this.
 *
 * So the fix is to stop three's constructor from seeing itself as WebGL1,
 * by hiding the global for the duration of the `new WebGLRenderer` call.
 * `instanceof` against `undefined` is skipped by three's own `typeof` guard on
 * the same line, so the warning is bypassed with no other behaviour touched:
 * three does not use this global anywhere else, and the context's real
 * prototype chain is untouched. Restored in a `finally` so nothing else in
 * the app ever observes the gap.
 *
 * Scoped to the WebGL2 case on purpose: an actual WebGL1 device keeps the
 * warning, because there the deprecation is real and worth hearing.
 */
function withoutWebGL1Warning<T>(gl: ExpoWebGLRenderingContext, build: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const isWebGL2 =
    (gl as unknown as { supportsWebGL2?: boolean }).supportsWebGL2 === true ||
    gl.constructor?.name === 'WebGL2RenderingContext';
  if (Platform.OS === 'web' || !isWebGL2 || !('WebGLRenderingContext' in g)) {
    return build();
  }
  const saved = g.WebGLRenderingContext;
  // `delete` rather than `= undefined`: three guards with `typeof ... !==
  // 'undefined'`, which both satisfy, but this leaves no own property behind
  // if the restore below were ever to be skipped.
  delete g.WebGLRenderingContext;
  try {
    return build();
  } finally {
    g.WebGLRenderingContext = saved;
  }
}

export interface Court3DProps {
  progress: Animated.Value;
  direction: Dir;
  reduceMotion: boolean;
  /** Shadows + trail only on `full`; defaults to the phone's detected tier. */
  quality?: CourtQuality;
  /** The view's size in dp — the caller projects the net tape for the button from it (camera.ts). */
  onSize?: (size: { width: number; height: number }) => void;
  onUnavailable?: () => void;
  style?: StyleProp<ViewStyle>;
  /** The court layer's lift + dim, applied to both GL surfaces (not to `children`). */
  layerStyle?: ComponentProps<typeof Animated.View>['style'];
  /** Rendered between the court and the ball: the on-net button. */
  children?: ReactNode;
  /**
   * Where the page's brand pattern is, so the court can draw the SAME crop of
   * it behind the scene (patternBackdrop) instead of clearing to a flat colour
   * and cutting the page's copy off at the top of the stage.
   *
   * The caller measures both boxes with onLayout, in one coordinate space, and
   * hands over the pattern's box plus this view's corner inside it. Measured
   * rather than derived because the two views are several boxes apart, and
   * handed DOWN rather than measured here because onLayout answers
   * synchronously in the space the caller already has, where measureInWindow
   * would be a second, asynchronous answer in a different one.
   */
  patternBox?: { width: number; height: number; offsetX: number; offsetY: number };
}

/** Reduced motion holds the rally here: the first strike, ball on the face, no trail. */
const REST_T = 0;
/**
 * The stale-frame cover's dissolve. Matched to the theme crossfade's fade-in
 * (FADE_IN_MS in theme/ThemeProvider.tsx) so the court arrives on the same beat
 * as the rest of the app rather than as a second, later transition.
 */
const STALE_FADE_MS = 180;
/**
 * A context can arrive already dead: `onContextCreate` is async, so navigating
 * away mid-create (or Android recreating the surface) hands attach() a handle
 * whose native side is gone. three then throws reading capabilities off it
 * (`getShaderPrecisionFormat(...)` returns undefined). That is transient — a
 * fresh surface gives a live context — so remount the GLViews and try again.
 * Only a device that fails this many times running is really without GL.
 */
const MAX_INIT_ATTEMPTS = 3;
/**
 * How long the stage cross-fades in once the court's FIRST frame has actually
 * been drawn.
 *
 * expo-gl creates its context asynchronously and `buildCourtScene` then builds
 * the whole cage, net, rackets and backdrop in one synchronous go, so a few
 * hundred milliseconds pass between this view being laid out — an empty
 * surface, page colour showing through — and the first `endFrameEXP`. At that
 * moment the finished court appeared in a single frame, which is a hard cut
 * and not an entrance (owner, 2026-09-08: "the court spawns instantly, it's
 * not smooth").
 *
 * The fix is not to draw sooner, because the scene build IS the cost; it is to
 * stop the first frame being a cut. `reveal` holds the stage at zero until the
 * court has something on it and then fades. It runs under Reduce Motion too —
 * a cross-fade is what that setting asks for INSTEAD of movement, and the
 * alternative here is the pop it exists to prevent.
 *
 * Re-armed for every court context, not just the first: a surface Android
 * destroys and recreates (leaving the tab, backgrounding) has nothing on it
 * either, so it comes back the same way rather than snapping in. And re-armed
 * on every blur, so a return to the tab on iOS — where the surface and its
 * picture survive the switch — fades in the same way rather than being there.
 */
const REVEAL_MS = 260;
/**
 * Insurance only. Every real path either draws within a frame of `attach` or
 * gives up through `onUnavailable`, and the caller then swaps in the flat
 * court — but the stage also carries the caller's "check availability" button,
 * and no GL edge case may leave that permanently invisible. Runs only while
 * the tab is FOCUSED: a timer started on a blurred tab lifted the stage off
 * screen and spent the entrance before anyone saw it.
 */
const REVEAL_FALLBACK_MS = 1500;
/**
 * The interval between two drawn frames past which the loop counts as having
 * STALLED rather than dropped a frame. Not a gate — nothing stops or restarts
 * on it — a threshold for the `court3d.frame.stall` breadcrumb, so a court that
 * "froze" on a device can be read back as a stalled thread rather than a
 * closed loop (which leaves its own `court3d.loop.stop`).
 */
const STALL_MS = 1000;

const hexToInt = (hex: string): number => parseInt(hex.slice(1, 7), 16);

interface Surface {
  gl: ExpoWebGLRenderingContext;
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
}

type Kind = 'court' | 'ball';

export function Court3D({
  progress,
  direction,
  reduceMotion,
  quality: qualityProp,
  onSize,
  onUnavailable,
  style,
  layerStyle,
  children,
  patternBox,
}: Court3DProps) {
  const { colors, appearance } = useTheme();
  /** Pre-blended: the backdrop's material is opaque on purpose (patternInk). */
  const ink = patternInk(colors.page, brand.green, PATTERN_DEFAULT_OPACITY[appearance]);
  // Read as four numbers, not one object, so a caller that rebuilds the object
  // every render does not re-push the viewport and schedule a frame with it.
  const boxWidth = patternBox?.width ?? 0;
  const boxHeight = patternBox?.height ?? 0;
  const boxOffsetX = patternBox?.offsetX ?? 0;
  const boxOffsetY = patternBox?.offsetY ?? 0;
  // Fixed for the life of the scene: the tier shapes what gets built.
  const quality = useRef(qualityProp ?? detectCourtQuality()).current;
  useEffect(() => {
    console.log('[courtperf] quality tier =', quality, 'propOverride =', qualityProp ?? 'none');
  }, [quality, qualityProp]);
  /** Wall-clock mark for the current context attach, for [courtperf]. */
  const attachAt = useRef<number | null>(null);
  const court = useRef<CourtScene | null>(null);
  const layout = useRef<{ width: number; height: number } | null>(null);
  const surfaces = useRef<{ court: Surface | null; ball: Surface | null }>({
    court: null,
    ball: null,
  });
  const p = useRef(0);
  const ease = useRef(pitchEase(direction, 0));
  /**
   * The rally's own clock, in seconds, ADVANCED PER DRAWN FRAME rather than
   * read off the wall clock — see features/courtTransition/rallyClock.ts.
   */
  const rallyT = useRef(0);
  /** `performance.now()` of the last frame that advanced it; null = no interval to measure. */
  const lastFrameAt = useRef<number | null>(null);
  /** A stall is on the record until the next frame that is not one. */
  const stalled = useRef(false);
  const loop = useRef<number | null>(null);
  const once = useRef<number | null>(null);
  const reduce = useRef(reduceMotion);
  const running = useRef(false);
  /** A theme flip landed with no frame drawn since: the court is a stale picture. */
  const repaint = useRef(false);
  /**
   * THE STALE-FRAME COVER, in the NEW page colour, over the court surfaces.
   *
   * The problem it solves: the court surface clears OPAQUE — a frame-budget
   * decision the header explains at length (a translucent full-screen GL layer
   * froze the court on device) — so what is on screen is whatever was last
   * RENDERED into the framebuffer, and nothing the React tree paints behind it
   * shows through. The page colour inverts between palettes (#FFFFFF ⇄
   * #172C4F), so after a theme flip the surface is not slightly wrong, it is
   * the opposite colour.
   *
   * And a flip from Control Center is exactly when no frame can be rendered:
   * iOS pauses the display link as the shade comes down, so the redraw the
   * theme effect requests is QUEUED and only executes on dismissal. That late
   * frame is the reported symptom — the court rendering once Control Center
   * closes, after the rest of the app has already flipped.
   *
   * Blanking the surfaces was the obvious lever and is the wrong one: the court
   * is most of the Book tab, so it would vanish to a flat rectangle for the
   * whole time the shade is down. Instead a cover in the INCOMING page colour
   * is laid over them for exactly as long as the framebuffer disagrees, and
   * faded away on the frame that repaints it. That is the same device the theme
   * provider uses app-wide (theme/ThemeProvider.tsx): the band reads as flipped
   * immediately, under the shade, and the court dissolves back in already in
   * the right palette rather than snapping.
   */
  const [stale, setStale] = useState(false);
  const staleCover = useRef(new Animated.Value(0)).current;
  /**
   * The cover is MOUNTED. Held past `stale` so the dissolve has something to
   * fade, and dropped only when it finishes — an always-mounted cover at
   * opacity 0 is a full-screen view the compositor still has to consider over
   * two GL surfaces every frame, which is exactly the budget the opaque-clear
   * decision (see the header) exists to protect.
   */
  const [covering, setCovering] = useState(false);
  const clear = useRef(hexToInt(colors.page));
  const sizeCb = useRef(onSize);
  const unavailableCb = useRef(onUnavailable);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(true);
  /** Read inside attach()'s catch, which must not re-create on every focus change. */
  const focusedRef = useRef(true);
  /** Consecutive attach() failures WHILE FOCUSED; reset by the first surface that comes up. */
  const initFailures = useRef(0);
  /**
   * The court is without a surface and no new context is on its way — a
   * context arrived dead while the tab was blurred, or a draw found its
   * context gone. The focus effect remounts the GLViews to get one.
   */
  const needsSurface = useRef(false);
  /** Bumped to remount both GLViews and ask the platform for fresh contexts. */
  const [glGeneration, setGlGeneration] = useState(0);
  /**
   * The raw lifecycle state, kept WHOLE rather than reduced to an `active`
   * boolean — 'active', 'inactive' and 'background' are three different answers
   * here, and collapsing the first two is what left the court stale.
   *
   * iOS reports 'inactive' while the Control Center shade is down, but the app
   * is still composited on screen and rAF is still serviced; frames stop at
   * 'background'. The rally should still pause under the shade, but the surface
   * must stay DRAWABLE — because opening Control Center is exactly how the
   * system theme gets flipped, so that is precisely when the court needs to
   * repaint. `canAnimate` / `canDraw` in features/courtTransition/surfaceState.ts
   * make the distinction; theme/appearanceEvents.ts makes the same one a layer up.
   */
  const [appState, setAppState] = useState<string>(AppState.currentState);
  /**
   * The lifecycle, for the render loop to read without being rebuilt. expo-gl
   * silently drops every present while the app is not active, so a frame only
   * counts as having reached the screen when this says 'active'.
   */
  const appStateRef = useRef<string>(AppState.currentState);


  sizeCb.current = onSize;
  unavailableCb.current = onUnavailable;
  ease.current = pitchEase(direction, 0);

  /** 0 until the court's first frame lands, then REVEAL_MS to 1 (see above). */
  const reveal = useRef(new Animated.Value(0)).current;
  const revealed = useRef(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRevealTimer = useCallback(() => {
    if (revealTimer.current === null) return;
    clearTimeout(revealTimer.current);
    revealTimer.current = null;
  }, []);
  const showStage = useCallback(() => {
    clearRevealTimer();
    // A frame that lands while the tab is BLURRED must not lift the stage: the
    // loop stops a commit after the blur, so one can, and the stage was put
    // down on the way out so the next visit gets its entrance — that visit's
    // first frame lifts it.
    if (revealed.current || !focusedRef.current) return;
    revealed.current = true;
    Animated.timing(reveal, {
      toValue: 1,
      duration: REVEAL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [reveal, clearRevealTimer]);
  /**
   * The backstop, for a stage someone can SEE: an arm while blurred gets no
   * timer (it would lift the stage off screen, and the entrance with it), and
   * the focus effect starts one for a stage that is still down on the way in.
   */
  const armFallback = useCallback(() => {
    clearRevealTimer();
    if (!focusedRef.current) return;
    revealTimer.current = setTimeout(showStage, REVEAL_FALLBACK_MS);
  }, [showStage, clearRevealTimer]);
  /** Hide the stage again until the surface that is coming up has drawn. */
  const armReveal = useCallback(() => {
    revealed.current = false;
    reveal.stopAnimation(); // a re-arm mid-fade must not be overwritten by it
    reveal.setValue(0);
    armFallback();
  }, [reveal, armFallback]);

  /**
   * TEARDOWN CANNOT ASSUME A LIVE CONTEXT.
   *
   * `dispose()` releases GPU resources, which means it TALKS TO THE CONTEXT —
   * and the usual reason to be tearing down at all is that the context has just
   * gone away. expo-gl throws "GL is currently not available" from every call
   * on a dead one, so the cleanup after a lost surface threw out of the
   * cleanup, unhandled, and left the rest of it undone (owner, 2026-09-10,
   * switching tabs quickly). There is nothing to release when the context is
   * gone in any case: dropping the reference IS the cleanup, and the driver
   * reclaimed the rest with the surface.
   */
  const detach = useCallback((kind: Kind) => {
    const s = surfaces.current[kind];
    if (!s) return;
    surfaces.current[kind] = null;
    try {
      s.renderer.dispose();
    } catch (error) {
      addBreadcrumb('court3d.dispose.failed', { surface: kind, error: describeError(error) });
    }
  }, []);

  const teardown = useCallback(() => {
    setReady(false); // no surfaces left to draw on: stop the loop with them
    detach('court');
    detach('ball');
    const scene = court.current;
    court.current = null;
    try {
      scene?.dispose();
    } catch (error) {
      addBreadcrumb('court3d.dispose.failed', { surface: 'scene', error: describeError(error) });
    }
  }, [detach]);

  const stopLoop = useCallback(() => {
    if (loop.current !== null) {
      cancelAnimationFrame(loop.current);
      loop.current = null;
    }
    // Whatever stopped the loop — the idle hold, leaving the tab, the app going
    // to the background — the rally was not on screen for that time and must
    // not be billed for it. The next frame starts a fresh interval.
    lastFrameAt.current = null;
  }, []);

  const renderFrame = useCallback(() => {
    const scene = court.current;
    const main = surfaces.current.court;
    const box = layout.current;
    if (!scene || !main || !box) return;
    // Device pixels from the layout: what expo-gl sizes its buffers to (iOS
    // contentScaleFactor, Android density — both PixelRatio.get()).
    const scale = PixelRatio.get();
    const w = Math.round(box.width * scale);
    const h = Math.round(box.height * scale);
    if (w === 0 || h === 0) return;
    const fit = (s: Surface) => {
      if (w !== s.width || h !== s.height) {
        s.width = w;
        s.height = h;
        s.renderer.setSize(w, h, false);
      }
    };
    const value = p.current;
    let t = REST_T;
    if (!reduce.current) {
      // Advance by the interval since the last frame actually DRAWN, capped
      // (rallyClock): a frame the JS thread was too busy to service is a
      // dropped frame, never a jump forward to catch the wall clock up. The
      // rally plays for as long as the court is on screen — see the header on
      // why there is no idle hold any more.
      const now = performance.now();
      const since = lastFrameAt.current === null ? null : now - lastFrameAt.current;
      lastFrameAt.current = now;
      rallyT.current = advanceRally(rallyT.current, since);
      t = rallyT.current;
      // A frame that arrives a second or more after the last one is a stall,
      // not a drop: the loop was never stopped, the thread simply did not get
      // back to it (a GPU back-pressured `endFrameEXP`, a blocked JS thread).
      // The rally clock absorbs it, so nothing jumps — but the guest saw the
      // court freeze, and this is the only record of it. One breadcrumb per
      // stall, so a device stalling every frame does not flood telemetry.
      if (since !== null && since >= STALL_MS) {
        if (!stalled.current) {
          stalled.current = true;
          addBreadcrumb('court3d.frame.stall', { sinceMs: Math.round(since) });
        }
      } else {
        stalled.current = false;
      }
    }
    try {
      fit(main);
      if (scene.camera.aspect !== w / h) {
        scene.camera.aspect = w / h;
        scene.camera.updateProjectionMatrix();
      }
      scene.update(t, value, ease.current(value));
      const __first = attachAt.current !== null;
      const __tDraw = __first ? Date.now() : 0;
      main.renderer.render(scene.scene, scene.camera);
      main.gl.endFrameEXP();
      if (__first) {
        // First render() after a context attach compiles/links every shader,
        // so this split separates GPU-driver cost from the JS scene build.
        console.log(
          '[courtperf] first render()',
          Date.now() - __tDraw,
          'ms | attach -> first frame',
          Date.now() - (attachAt.current as number),
          'ms',
        );
        attachAt.current = null;
      }
      // A frame has gone out — but "gone out" only counts while the app is ACTIVE.
      // `endFrameEXP` funnels into expo-gl's `flush`, which returns immediately
      // while `_appIsBackgrounded` is set (EXGLContext.mm observes
      // `UIApplicationWillResignActive`, i.e. the Control Center shade opening).
      // So under the shade this code runs, the draw calls are issued, and NOTHING
      // reaches the screen. Clearing the flag here regardless is what took the
      // cover down over a framebuffer still cleared to the old palette — the
      // white court band on a dark page, for the whole time the shade was up and
      // a beat after it closed.
      //
      // Read from a ref, not the `appState` state value: this runs inside the
      // render loop, which must not be rebuilt on every lifecycle change.
      //
      // THIS BLOCK WAS LOST ONCE, in the merge afe7f57 (2026-09-09), and the
      // cover then stayed up forever after any theme flip — the court was a
      // flat page-colour rectangle for the rest of the session. staleCover.ts's
      // test now reads this file and fails if the call goes missing again.
      if (frameRepaints({ repaintPending: repaint.current, appState: appStateRef.current })) {
        repaint.current = false;
        setStale(false);
      }
      // There is a court on the surface now: let the stage fade up (no-op after
      // the first frame). The ball's surface follows in the same fade.
      showStage();
      // The ball's surface shares the camera: same bounds, same picture, stacked above the button.
      const ball = surfaces.current.ball;
      if (ball) {
        fit(ball);
        ball.renderer.render(scene.overlay, scene.camera);
        ball.gl.endFrameEXP();
      }
    } catch (error) {
      // THE SURFACE WENT AWAY MID-FRAME.
      //
      // expo-gl throws "GL is currently not available" from every call once its
      // context is gone, and Android takes the surface away the moment this
      // screen stops being the visible tab. The loop is stopped on blur, but
      // not in the same turn the platform tears the surface down — so a frame
      // already in flight lands on a dead context, and the throw escaped the
      // rAF callback as an unhandled error (owner, 2026-09-10, switching tabs
      // quickly).
      //
      // Nothing here is recoverable by trying again on the next frame: the
      // context is gone for good and a new GLView is the only way back. So the
      // loop stops, the surfaces are dropped, and a replacement is requested —
      // now if the court is still on screen, otherwise on the way back in.
      stopLoop();
      teardown();
      addBreadcrumb('court3d.surface.lost', { error: describeError(error) });
      if (focusedRef.current) setGlGeneration((n) => n + 1);
      else needsSurface.current = true;
    }
  }, [showStage, stopLoop, teardown]);

  const startLoop = useCallback(() => {
    if (loop.current !== null) return;
    const step = () => {
      loop.current = requestAnimationFrame(step);
      renderFrame();
    };
    step();
  }, [renderFrame]);

  const requestOnce = useCallback(() => {
    if (once.current !== null) return;
    once.current = requestAnimationFrame(() => {
      once.current = null;
      renderFrame();
    });
  }, [renderFrame]);

  /**
   * Tell the scene where this surface sits inside the page's pattern box, so
   * the pattern drawn behind the court is the same crop as the one above it.
   * A no-op until the caller has measured both boxes and this view has a size.
   */
  const pushViewport = useCallback(() => {
    const size = layout.current;
    if (!size || boxWidth <= 0 || boxHeight <= 0) return;
    court.current?.setBackdropViewport({
      boxWidth,
      boxHeight,
      offsetX: boxOffsetX,
      offsetY: boxOffsetY,
      viewWidth: size.width,
      viewHeight: size.height,
    });
    if (running.current) requestOnce();
  }, [boxWidth, boxHeight, boxOffsetX, boxOffsetY, requestOnce]);

  const attach = useCallback(
    (kind: Kind, gl: ExpoWebGLRenderingContext) => {
      detach(kind); // Android hands us a fresh context after the surface is recreated
      // A brand-new surface has nothing drawn on it: hold the stage down until
      // it does, exactly as on the first mount.
      if (kind === 'court') armReveal();
      try {
        // three wants a canvas-shaped object; the context is expo-gl's.
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const canvas = {
          width: w,
          height: h,
          clientWidth: w,
          clientHeight: h,
          style: {},
          addEventListener: () => {},
          removeEventListener: () => {},
          getContext: () => gl,
        } as unknown as HTMLCanvasElement;
        const renderer = withoutWebGL1Warning(
          gl,
          () =>
            new THREE.WebGLRenderer({
              canvas,
              context: gl,
              antialias: true,
              // Informational only: three reads `alpha` off the CONTEXT when one is
              // passed (WebGLRenderer, r160), and expo-gl's getContextAttributes
              // hardcodes alpha: true. The clear alpha below is what actually
              // decides whether a surface composites over what is behind it.
              alpha: kind === 'ball',
            }),
        );
        renderer.setPixelRatio(1); // drawingBuffer* are already device pixels
        renderer.setSize(w, h, false);
        if (kind === 'court') {
          renderer.setClearColor(clear.current, 1); // opaque: see the header
          renderer.shadowMap.enabled = quality === 'full';
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        } else {
          renderer.setClearColor(0x000000, 0); // see-through: the button shows between the ghosts
        }
        if (!court.current) {
          const __tBuild = Date.now();
          court.current = buildCourtScene(quality);
          console.log('[courtperf] scene build (cold)', Date.now() - __tBuild, 'ms');
          pushViewport();
        } else {
          console.log('[courtperf] scene REUSED (warm context)');
        }
        // Outside the branch above: Android destroys the surface while the app
        // is backgrounded and hands back a NEW context, but the scene object
        // survives. A theme flip during that excursion updated `ink` with no
        // scene to push it to (setBackdropInk ran against the old surface's
        // scene, or the effect's redraw never fired), so setting this only on
        // first build brought the court back with the previous theme's pattern
        // baked in. Idempotent, and the value is always the current one.
        court.current.setBackdropInk(ink);
        surfaces.current[kind] = { gl, renderer, width: w, height: h };
        initFailures.current = 0; // a live surface: any earlier failure was transient
        if (kind === 'court') {
          attachAt.current = Date.now();
          console.log('[courtperf] court context attached (build+renderer done)');
        }
        addBreadcrumb('court3d.ready', { surface: kind, quality, width: w, height: h });
        if (kind === 'court') setReady(true);
        else if (running.current) requestOnce();
      } catch (error) {
        teardown();
        // A DEAD CONTEXT ON A TAB NOBODY IS LOOKING AT IS NOT A FAILURE.
        //
        // Android destroys a GL surface when its screen goes away and creates a
        // new one on return, and `onContextCreate` is async — so switching tabs
        // hands this a context whose native side is already gone, and three
        // throws reading capabilities off it ("Cannot read property 'precision'
        // of undefined"). That is the ordinary cost of leaving the tab, not a
        // phone without GL.
        //
        // It used to be counted anyway, and retried by remounting the GLViews —
        // which, off screen, could only produce another dead context. Switching
        // between Book and My bookings quickly therefore burned all three
        // attempts in a moment and latched `onUnavailable`, and the caller's
        // `glUnavailable` is a ONE-WAY flag: the tab dropped to the flat SVG
        // court and stayed there for the rest of the session, on a phone whose
        // GL was fine (owner, 2026-09-10). So a blurred failure costs no
        // attempt and raises no alarm; it is noted, the surface is dropped, and
        // the focus effect asks for a fresh one on the way back in.
        if (!focusedRef.current) {
          needsSurface.current = true;
          addBreadcrumb('court3d.init.blurred', { surface: kind });
          return;
        }
        initFailures.current += 1;
        const attempt = initFailures.current;
        // `surface` and `focused` say which GLView failed and whether the screen
        // had already been navigated away from — the signature of a dead context.
        const context = {
          label: 'court3d.init',
          surface: kind,
          attempt,
          focused: true,
        };
        if (attempt < MAX_INIT_ATTEMPTS) {
          captureMessage('court3d.init retry', 'warning', {
            ...context,
            error: describeError(error),
          });
          setGlGeneration((n) => n + 1);
          return;
        }
        captureException(error, context);
        unavailableCb.current?.();
      }
    },
    // `pushViewport`, `ink` and `armReveal` only seed a freshly built scene or a
    // freshly arrived surface, so the identity churn they add here costs a new
    // onContextCreate prop and nothing else — expo-gl calls it once, when the
    // context is born.
    [detach, teardown, requestOnce, quality, ink, pushViewport, armReveal],
  );
  const onCourtContext = useCallback(
    (gl: ExpoWebGLRenderingContext) => attach('court', gl),
    [attach],
  );
  const onBallContext = useCallback(
    (gl: ExpoWebGLRenderingContext) => attach('ball', gl),
    [attach],
  );

  // p per frame from the native driver. The loop is already running whenever
  // the court is on screen, so it picks the new value up on its next frame;
  // only reduced motion, which draws on demand, has to ask for one.
  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      if (value === p.current) return;
      p.current = value;
      if (reduce.current && running.current) requestOnce();
    });
    return () => progress.removeListener(id);
  }, [progress, requestOnce]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      // A stage still down from the blur below (or from a context that arrived
      // dead while blurred) gets its backstop now that someone can see it.
      if (!revealed.current) armFallback();
      // A fresh visit gets a fresh budget: attempts spent on a previous one
      // say nothing about whether GL works now.
      initFailures.current = 0;
      // A context was dropped, or a draw lost its surface, while we were away.
      // Nothing else will offer another one — expo-gl calls `onContextCreate`
      // once per GLView — so ask for new GLViews now that a surface can live.
      if (needsSurface.current) {
        needsSurface.current = false;
        setGlGeneration((n) => n + 1);
      }
      return () => {
        focusedRef.current = false;
        setFocused(false);
        // ENTRANCE ON EVERY VISIT. On iOS the surface survives a tab switch
        // (the native tab bar detaches the view; the GL context and its last
        // frame live on), so nothing re-armed the reveal and the fade played
        // once per launch — the court was simply THERE on every return, and
        // the fallback timer, never cancelled on blur, burned the arm off
        // screen whenever the guest left within 1.5 s of arriving (owner,
        // 2026-09-11, switching tabs quickly). Armed HERE, while nobody can see
        // it, rather than on focus: the native tab swap shows the screen a
        // frame before the focus event reaches JS, so an arm on focus flashes
        // the full court and cuts it to nothing before fading. Android destroys
        // the surface on blur and `attach` arms again for the new context; the
        // two arms agree. `focusedRef` is already false, so this starts no
        // timer — the focus branch above does, on the way back in.
        armReveal();
      };
    }, [armReveal, armFallback]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      appStateRef.current = s;
      setAppState(s);
    });
    return () => sub.remove();
  }, []);

  // Arm the reveal for the first surface (each later visit re-arms from the
  // focus effect above), and take its backstop timer down with the component.
  useEffect(() => {
    armReveal();
    return clearRevealTimer;
  }, [armReveal, clearRevealTimer]);

  // Stale binary (no ExponentGLObjectManager): tell the caller once, on mount —
  // the same path an attach() failure takes — and render nothing meanwhile.
  useEffect(() => {
    if (GLView) return;
    captureException(new Error('expo-gl native module missing'), { label: 'court3d.unavailable' });
    unavailableCb.current?.();
  }, []);

  // Run the loop for exactly as long as the court is on screen; reduced motion
  // draws on demand instead.
  const live = canAnimate({ ready, focused, appState });
  /**
   * May a single frame be drawn right now? Same as `live` but tolerating
   * 'inactive', so a theme flip under the Control Center shade can repaint the
   * framebuffer instead of waiting for dismissal. Deliberately NOT used to run
   * the loop — only to honour one-shot redraws.
   */
  const drawable = canDraw({ ready, focused, appState });
  useEffect(() => {
    running.current = live;
    reduce.current = reduceMotion;
    if (!live) {
      // Every stop is on the record with its reason, so "the animation stopped"
      // can be told apart from "the frames stalled" (court3d.frame.stall) after
      // the fact: a stop here is the gate closing — no surface, tab blurred, or
      // app not frontmost — and nothing else in this file halts the loop.
      addBreadcrumb('court3d.loop.stop', {
        ready,
        focused: focusedRef.current,
        appState: appStateRef.current,
        reduceMotion,
      });
      stopLoop();
      return;
    }
    if (reduceMotion) {
      stopLoop();
      requestOnce();
    } else {
      startLoop();
    }
    // Returning from the background with a theme flip that never got a frame:
    // draw one now. `startLoop` above would repaint on its own, but the request
    // is cheap and idempotent (requestOnce no-ops if a frame is already
    // queued), so it costs nothing on the path that was going to draw anyway.
    if (repaint.current) requestOnce();
    return stopLoop;
  }, [live, ready, reduceMotion, startLoop, stopLoop, requestOnce]);

  // The same redraw, keyed on the COLOURS rather than on the lifecycle, because
  // the two listeners race. This component watches AppState for `active` and
  // the theme provider watches it to reconcile the scheme on return; whichever
  // registered first runs first. If this one wins, `live` lifts while the theme
  // is still the old one and `repaint` is still false, so the effect above
  // draws a frame in the OLD colours and the provider's commit lands after it
  // with the loop possibly held idle again — the stale court, one race later.
  // Keying on `colors.page` means the commit ITSELF schedules the frame, in
  // whichever order the two arrive.
  // Redraw whenever the surface is stale AND something has changed that might
  // let a frame actually land: the colours (the flip itself) or the lifecycle.
  //
  // `appState` is in the deps, not just `drawable`, and that is the whole point
  // on the Control Center path. `drawable` is already true under the shade, so
  // it does not change on the way back to 'active' — the effect would not
  // re-run, and the only frame that can present would never be requested. The
  // court would sit under its cover until the rally or a touch happened to draw
  // one. Keying on the raw lifecycle means the return itself schedules it.
  useEffect(() => {
    if (!drawable || !repaint.current) return;
    requestOnce();
  }, [drawable, appState, colors.page, requestOnce]);

  // Theme flips repaint the page colour behind the court, and re-weight the
  // brand pattern drawn on it — the page's copy carries a different alpha in
  // each appearance, so this one has to follow or the seam shows.
  //
  // The redraw is gated on a SURFACE existing, not on the loop running. Under
  // Reduce Motion the loop never runs, and the new colours only reach the
  // framebuffer when something draws — so gating on `running.current` left the
  // court on the old theme indefinitely there: the page around it flipped
  // instantly and the court did not follow. `requestOnce` is one frame on
  // demand and does not start the loop, which is exactly what that path wants.
  useEffect(() => {
    clear.current = hexToInt(colors.page);
    surfaces.current.court?.renderer.setClearColor(clear.current, 1);
    court.current?.setBackdropInk(ink);
    // Staged, and only cleared once a frame has actually gone out with these
    // colours.
    //
    // WHERE THE FLIP ACTUALLY ARRIVES, and why no frame can answer it.
    //
    // Changing the system appearance means Control Center, which puts the app at
    // 'inactive' — and expo-gl stops presenting there. `EXGLContext.mm` observes
    // `UIApplicationWillResignActive`, sets `_appIsBackgrounded = YES` and
    // `glFinish()`es; from then until `DidBecomeActive` its `flush` returns
    // immediately, doing nothing. So the GL surface CANNOT be updated while the
    // shade is down, at any cost: the request below is real and necessary, but
    // it does not reach the screen until dismissal, and that late frame — after
    // the rest of the app has already flipped — is the reported symptom.
    //
    // The cover below is what makes that not matter. It is a plain React view,
    // so it flips on this commit like everything else, and it hides the surface
    // until the surface can agree.
    repaint.current = true;
    // Opaque AT ONCE, not faded up: the commit that flips the palette is the
    // same one that makes the framebuffer wrong, so there is no moment where a
    // gradual cover would be hiding anything but the error.
    staleCover.setValue(1);
    setStale(true);
    setCovering(true);
    // No surface to redraw (GL unavailable, or not attached yet) means no frame
    // will ever clear the flag, so do not raise a cover nothing can take down —
    // the caller is showing the flat SVG court in that case anyway.
    if (surfaces.current.court) requestOnce();
    else {
      staleCover.setValue(0);
      setStale(false);
      setCovering(false);
    }
  }, [colors.page, ink, requestOnce, staleCover]);

  /**
   * Take the cover away once the surface has repainted. A short dissolve, not a
   * cut: on the Control Center path the frame lands as the shade is dismissed,
   * and cutting there would put a hard edge exactly where the user is looking.
   * `stale` only clears from inside renderFrame, so this cannot fade the cover
   * off a framebuffer that is still wrong.
   */
  useEffect(() => {
    // `covering` gates the mount case: with no cover up there is nothing to
    // dissolve, and starting a fade on first render would fire the completion
    // callback for a transition that never happened.
    if (stale || !covering) return;
    const fade = Animated.timing(staleCover, {
      toValue: 0,
      duration: STALE_FADE_MS,
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      // Only on a real finish: an interrupted fade means another flip arrived
      // and raised the cover again, and unmounting then would expose the stale
      // surface it is holding back.
      if (finished) setCovering(false);
    });
    return () => fade.stop();
  }, [stale, covering, staleCover]);

  // The caller's measurements land after this view's own, and change again on
  // a rotation, so the push cannot hang off onLayout alone.
  useEffect(pushViewport, [pushViewport]);

  useEffect(
    () => () => {
      stopLoop();
      if (once.current !== null) cancelAnimationFrame(once.current);
      teardown();
    },
    [stopLoop, teardown],
  );

  if (!GLView) return null;

  // The surfaces are pictures: no touches (the button between them takes its
  // own, and the lifted ball surface must never swallow the back button's taps)
  // and nothing for a screen reader.
  const surface = {
    pointerEvents: 'none' as const,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
    style: [StyleSheet.absoluteFill, layerStyle],
  };
  const msaa = quality === 'full' ? 4 : 2;

  return (
    // The reveal rides the ROOT, not the surfaces: the on-net button
    // (`children`) is positioned from the same camera as the court and belongs
    // to the same picture, so the two arrive together rather than the button
    // sitting alone over the page colour while the scene builds.
    <Animated.View
      pointerEvents="box-none"
      style={[style, { opacity: reveal }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width <= 0 || height <= 0) return;
        layout.current = { width, height };
        sizeCb.current?.({ width, height });
        pushViewport(); // the backdrop's crop depends on this view's size too
        if (running.current) requestOnce(); // reduced motion: redraw at the new size now
      }}
    >
      <Animated.View {...surface}>
        <GLView
          key={glGeneration}
          style={StyleSheet.absoluteFill}
          msaaSamples={msaa}
          onContextCreate={onCourtContext}
        />
      </Animated.View>
      {children}
      <Animated.View {...surface}>
        <GLView
          key={glGeneration}
          style={StyleSheet.absoluteFill}
          msaaSamples={msaa}
          onContextCreate={onBallContext}
        />
      </Animated.View>
      {/* The stale-frame cover: over BOTH GL surfaces, so the rackets and ball
          do not hang in front of it. Painted in the CURRENT page
          colour, which is the colour the surface will clear to once it draws —
          so the dissolve lands on a matching ground and shows no seam. */}
      {stale || covering ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          // `layerStyle` too, so the cover travels with what it is covering: the
          // caller lifts and dims both GL surfaces through it during the court
          // transition (translateY + opacity, index.tsx `courtLayer`), and a
          // cover left at rest would slide off the surface it is hiding and
          // expose the stale picture along one edge.
          //
          // Its `opacity` multiplies with the cover's own, which is what we
          // want: as the layer dims, so does the cover, exactly in step with the
          // surface beneath. `staleCover` therefore stays the LAST opacity in
          // the array so it composes rather than being overwritten.
          style={[
            StyleSheet.absoluteFill,
            layerStyle,
            { backgroundColor: colors.page, opacity: staleCover },
          ]}
        />
      ) : null}
    </Animated.View>
  );
}
