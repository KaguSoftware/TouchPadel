/**
 * The prototype's three.js court, on a phone (design 2026-09-01,
 * `docs/design/mobile-ui/Court Transition Prototype.html`): expo-gl surfaces
 * running the scene from features/courtTransition/scene.ts — glass + mesh cage,
 * real net, 3D rackets, the ball with its trail and cast shadow — with the
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
 * Runtime shape:
 *   · `p` arrives through a native-driven Animated.Value listener (per frame).
 *   · The rally loops on a wall clock; the frame loop only runs while the tab
 *     is focused and the app is active (expo-router keeps tab screens mounted).
 *   · Reduced motion: the rally freezes on a rest frame and the scene renders
 *     only when `p` changes.
 *   · Idle: once `p` has rested for IDLE_AFTER_MS (three rallies) with no touch, the rally
 *     holds at the next leg start — ball in a player's hand, nobody mid-swing
 *     (rally.nextLegStart) — and the loop stops (battery: the Book tab is
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
import { addBreadcrumb, captureException } from '../lib/telemetry';
import { useTheme } from '../theme';

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
}

/** Reduced motion holds the rally here: ball on the hitter's racket, nobody mid-swing, no trail. */
const REST_T = 0;
/** No touch and `p` at rest for three full rallies (≈ 15.6 s) → hold at the next leg start. */
const IDLE_AFTER_MS = 3 * LOOP_SECONDS * 1000;
const NOTE_FADE_MS = 220;

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
}: Court3DProps) {
  const { colors } = useTheme();
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
          alpha: kind === 'ball',
        });
        renderer.setPixelRatio(1); // drawingBuffer* are already device pixels
        renderer.setSize(w, h, false);
        if (kind === 'court') {
          renderer.setClearColor(clear.current, 1);
          renderer.shadowMap.enabled = quality === 'full';
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        } else {
          renderer.setClearColor(0x000000, 0); // see-through: the button shows between the ghosts
        }
        if (!court.current) court.current = buildCourtScene(quality);
        surfaces.current[kind] = { gl, renderer, width: w, height: h };
        if (start.current === 0) {
          start.current = performance.now();
          lastActive.current = start.current;
        }
        addBreadcrumb('court3d.ready', { surface: kind, quality, width: w, height: h });
        if (kind === 'court') setReady(true);
        else if (running.current) requestOnce();
      } catch (error) {
        captureException(error, { label: 'court3d.init' });
        teardown();
        unavailableCb.current?.();
      }
    },
    [detach, teardown, requestOnce, quality],
  );
  const onCourtContext = useCallback((gl: ExpoWebGLRenderingContext) => attach('court', gl), [attach]);
  const onBallContext = useCallback((gl: ExpoWebGLRenderingContext) => attach('ball', gl), [attach]);

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
      setFocused(true);
      return () => setFocused(false);
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

  // Theme flips repaint the page colour behind the court.
  useEffect(() => {
    clear.current = hexToInt(colors.page);
    surfaces.current.court?.renderer.setClearColor(clear.current, 1);
    if (running.current) requestOnce();
  }, [colors.page, requestOnce]);

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
        <GLView style={StyleSheet.absoluteFill} msaaSamples={msaa} onContextCreate={onCourtContext} />
      </Animated.View>
      {children}
      <Animated.View {...surface}>
        <GLView style={StyleSheet.absoluteFill} msaaSamples={msaa} onContextCreate={onBallContext} />
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
