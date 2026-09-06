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
 *   · The rally loops on a wall clock; the frame loop only runs while the tab
 *     is focused and the app is active (expo-router keeps tab screens mounted).
 *   · Reduced motion: the rally freezes on a rest frame and the scene renders
 *     only when `p` changes.
 *   · Idle: once `p` has rested for IDLE_AFTER_MS (three rallies) with no touch, the rally
 *     holds at the next leg start — the instant of contact, ball ON the
 *     striking face (rally.nextLegStart) — and the loop stops (battery: the Book tab is
 *     where people sit longest). At the court view the caller's `pausedNote`
 *     fades in and a touch anywhere on the stage plays on from that frame;
 *     behind the sheet it holds until the caller reports activity through
 *     the `ref` handle (`wake`: any touch inside the sheet) or the close tap
 *     moves `p`. Returning to the tab / foreground wakes it too.
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
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Animated,
  AppState,
  PixelRatio,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { ExpoWebGLRenderingContext, GLView as GLViewComponent } from 'expo-gl';
import { useFocusEffect } from 'expo-router';
import * as THREE from 'three';
import { detectCourtQuality } from '../features/courtTransition/deviceQuality';
import type { CourtQuality } from '../features/courtTransition/quality';
import { buildCourtScene, type CourtScene } from '../features/courtTransition/scene';
import { LOOP_SECONDS, nextLegStart } from '../features/courtTransition/rally';
import { pitchEase, type Dir } from '../features/courtTransition/spec';
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

export interface Court3DHandle {
  /** Activity elsewhere (a touch in the sheet): restart the idle clock and play on if held. */
  wake: () => void;
}

export interface Court3DProps {
  ref?: Ref<Court3DHandle>;
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
  /** Shown (faded in, above everything) while the rally is held idle at the court view. */
  pausedNote?: ReactNode;
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
/** No touch and `p` at rest for three full rallies (≈ 15.6 s) → hold at the next leg start. */
const IDLE_AFTER_MS = 3 * LOOP_SECONDS * 1000;
const NOTE_FADE_MS = 220;
/**
 * A context can arrive already dead: `onContextCreate` is async, so navigating
 * away mid-create (or Android recreating the surface) hands attach() a handle
 * whose native side is gone. three then throws reading capabilities off it
 * (`getShaderPrecisionFormat(...)` returns undefined). That is transient — a
 * fresh surface gives a live context — so remount the GLViews and try again.
 * Only a device that fails this many times running is really without GL.
 */
const MAX_INIT_ATTEMPTS = 3;

const hexToInt = (hex: string): number => parseInt(hex.slice(1, 7), 16);

interface Surface {
  gl: ExpoWebGLRenderingContext;
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
}

type Kind = 'court' | 'ball';

export function Court3D({
  ref,
  progress,
  direction,
  reduceMotion,
  quality: qualityProp,
  onSize,
  onUnavailable,
  style,
  layerStyle,
  children,
  pausedNote,
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
  const court = useRef<CourtScene | null>(null);
  const layout = useRef<{ width: number; height: number } | null>(null);
  const surfaces = useRef<{ court: Surface | null; ball: Surface | null }>({
    court: null,
    ball: null,
  });
  const p = useRef(0);
  const ease = useRef(pitchEase(direction, 0));
  const start = useRef(0);
  const loop = useRef<number | null>(null);
  const once = useRef<number | null>(null);
  const reduce = useRef(reduceMotion);
  const running = useRef(false);
  /** Wall time of the last touch / `p` movement / return to the tab. */
  const lastActive = useRef(0);
  /** Rally time the idle hold will land on (a leg start), once idle has elapsed. */
  const holdAt = useRef<number | null>(null);
  /** Rally time the scene is frozen at while idle; null while it plays. */
  const frozenT = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);
  const noteOpacity = useRef(new Animated.Value(0)).current;
  const clear = useRef(hexToInt(colors.page));
  const sizeCb = useRef(onSize);
  const unavailableCb = useRef(onUnavailable);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(true);
  /** Read inside attach()'s catch, which must not re-create on every focus change. */
  const focusedRef = useRef(true);
  /** Consecutive attach() failures; reset by the first surface that comes up. */
  const initFailures = useRef(0);
  /** Bumped to remount both GLViews and ask the platform for fresh contexts. */
  const [glGeneration, setGlGeneration] = useState(0);
  const [active, setActive] = useState(AppState.currentState === 'active');

  sizeCb.current = onSize;
  unavailableCb.current = onUnavailable;
  ease.current = pitchEase(direction, 0);

  const stopLoop = useCallback(() => {
    if (loop.current !== null) {
      cancelAnimationFrame(loop.current);
      loop.current = null;
    }
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
    fit(main);
    if (scene.camera.aspect !== w / h) {
      scene.camera.aspect = w / h;
      scene.camera.updateProjectionMatrix();
    }
    const value = p.current;
    let t = REST_T;
    if (!reduce.current) {
      const now = performance.now();
      t = frozenT.current ?? (now - start.current) / 1000;
      if (frozenT.current === null) {
        // Idle: p settled (0 or 1) and nothing touched for IDLE_AFTER_MS → play
        // up to the next leg start, draw that exact frame, and stop the loop.
        const atRest = Math.abs(value - Math.round(value)) < 1e-3;
        if (atRest && now - lastActive.current >= IDLE_AFTER_MS) {
          holdAt.current ??= nextLegStart(t);
          if (t >= holdAt.current) {
            t = holdAt.current;
            frozenT.current = t;
            stopLoop();
            setPaused(value < 0.5);
            addBreadcrumb('court3d.idle', { at: value < 0.5 ? 'court' : 'sheet' });
          }
        } else {
          holdAt.current = null;
        }
      }
    }
    scene.update(t, value, ease.current(value));
    main.renderer.render(scene.scene, scene.camera);
    main.gl.endFrameEXP();
    // The ball's surface shares the camera: same bounds, same picture, stacked above the button.
    const ball = surfaces.current.ball;
    if (ball) {
      fit(ball);
      ball.renderer.render(scene.overlay, scene.camera);
      ball.gl.endFrameEXP();
    }
  }, [stopLoop]);

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

  /** Activity: note the time, and if the rally is held, play on from that frame. */
  const wake = useCallback(() => {
    const now = performance.now();
    lastActive.current = now;
    holdAt.current = null;
    if (frozenT.current !== null) {
      start.current = now - frozenT.current * 1000;
      frozenT.current = null;
      setPaused(false);
    }
    if (running.current && !reduce.current) startLoop();
  }, [startLoop]);
  useImperativeHandle(ref, () => ({ wake }), [wake]);

  const detach = useCallback((kind: Kind) => {
    const s = surfaces.current[kind];
    if (!s) return;
    surfaces.current[kind] = null;
    s.renderer.dispose();
  }, []);

  const teardown = useCallback(() => {
    setReady(false); // no surfaces left to draw on: stop the loop with them
    detach('court');
    detach('ball');
    court.current?.dispose();
    court.current = null;
  }, [detach]);

  const attach = useCallback(
    (kind: Kind, gl: ExpoWebGLRenderingContext) => {
      detach(kind); // Android hands us a fresh context after the surface is recreated
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
        const renderer = new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: true,
          // Informational only: three reads `alpha` off the CONTEXT when one is
          // passed (WebGLRenderer, r160), and expo-gl's getContextAttributes
          // hardcodes alpha: true. The clear alpha below is what actually
          // decides whether a surface composites over what is behind it.
          alpha: kind === 'ball',
        });
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
          court.current = buildCourtScene(quality);
          court.current.setBackdropInk(ink);
          pushViewport();
        }
        surfaces.current[kind] = { gl, renderer, width: w, height: h };
        if (start.current === 0) {
          start.current = performance.now();
          lastActive.current = start.current;
        }
        initFailures.current = 0; // a live surface: any earlier failure was transient
        addBreadcrumb('court3d.ready', { surface: kind, quality, width: w, height: h });
        if (kind === 'court') setReady(true);
        else if (running.current) requestOnce();
      } catch (error) {
        initFailures.current += 1;
        const attempt = initFailures.current;
        // `surface` and `focused` say which GLView failed and whether the screen
        // had already been navigated away from — the signature of a dead context.
        const context = {
          label: 'court3d.init',
          surface: kind,
          attempt,
          focused: focusedRef.current,
        };
        teardown();
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
    // `pushViewport` and `ink` only seed a freshly built scene, so the identity
    // churn they add here costs a new onContextCreate prop and nothing else —
    // expo-gl calls it once, when the context is born.
    [detach, teardown, requestOnce, quality, ink, pushViewport],
  );
  const onCourtContext = useCallback(
    (gl: ExpoWebGLRenderingContext) => attach('court', gl),
    [attach],
  );
  const onBallContext = useCallback(
    (gl: ExpoWebGLRenderingContext) => attach('ball', gl),
    [attach],
  );

  // p per frame from the native driver; under reduced motion that is the only
  // trigger to draw, otherwise it is activity (a transition is in flight).
  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      if (value === p.current) return;
      p.current = value;
      if (!reduce.current) wake();
      else if (running.current) requestOnce();
    });
    return () => progress.removeListener(id);
  }, [progress, requestOnce, wake]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      return () => {
        focusedRef.current = false;
        setFocused(false);
      };
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Stale binary (no ExponentGLObjectManager): tell the caller once, on mount —
  // the same path an attach() failure takes — and render nothing meanwhile.
  useEffect(() => {
    if (GLView) return;
    captureException(new Error('expo-gl native module missing'), { label: 'court3d.unavailable' });
    unavailableCb.current?.();
  }, []);

  // Run the loop only while visible (coming back counts as activity, so a held
  // rally plays on); reduced motion draws on demand instead and never holds.
  const live = ready && focused && active;
  useEffect(() => {
    running.current = live;
    reduce.current = reduceMotion;
    if (!live) {
      stopLoop();
      return;
    }
    if (reduceMotion) {
      stopLoop();
      frozenT.current = null;
      holdAt.current = null;
      setPaused(false);
      requestOnce();
    } else {
      wake();
    }
    return stopLoop;
  }, [live, reduceMotion, wake, stopLoop, requestOnce]);

  useEffect(() => {
    Animated.timing(noteOpacity, {
      toValue: paused ? 1 : 0,
      duration: NOTE_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [paused, noteOpacity]);

  // Theme flips repaint the page colour behind the court, and re-weight the
  // brand pattern drawn on it — the page's copy carries a different alpha in
  // each appearance, so this one has to follow or the seam shows.
  useEffect(() => {
    clear.current = hexToInt(colors.page);
    surfaces.current.court?.renderer.setClearColor(clear.current, 1);
    court.current?.setBackdropInk(ink);
    if (running.current) requestOnce();
  }, [colors.page, ink, requestOnce]);

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
    <View
      pointerEvents="box-none"
      style={style}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width <= 0 || height <= 0) return;
        layout.current = { width, height };
        sizeCb.current?.({ width, height });
        pushViewport(); // the backdrop's crop depends on this view's size too
        if (running.current) requestOnce(); // reduced motion: redraw at the new size now
      }}
    >
      {paused ? (
        // Only while held: a touch anywhere on the court plays on. Under the
        // button (which keeps its own taps) and never a responder, so it
        // claims nothing from anyone.
        <View
          style={StyleSheet.absoluteFill}
          onTouchStart={wake}
          onStartShouldSetResponder={() => false}
          accessible={false}
          importantForAccessibility="no"
        />
      ) : null}
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
      {pausedNote ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden={!paused}
          importantForAccessibility={paused ? 'auto' : 'no-hide-descendants'}
          style={[StyleSheet.absoluteFill, { opacity: noteOpacity }]}
        >
          {pausedNote}
        </Animated.View>
      ) : null}
    </View>
  );
}
