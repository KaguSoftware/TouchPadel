import { Animated, PanResponder, type GestureResponderEvent, type PanResponderInstance } from 'react-native';

const MAX_ZOOM = 4;

type Touches = { pageX: number; pageY: number }[];

function distance(t: Touches): number {
  const a = t[0]!;
  const b = t[1]!;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
}

/**
 * The touch handling of the full-screen photo, with no native scroll view in the way:
 * one finger at normal size drags the photo (and a long or fast drag hands it to `onDismiss`),
 * two fingers pinch it up to 4x, one finger on a zoomed photo pans it. All state lives in this
 * closure, so the handlers never read React refs.
 */
export function createPhotoGesture({
  width,
  height,
  tx,
  ty,
  zoom,
  px,
  py,
  onDismiss,
}: {
  width: number;
  height: number;
  /** The finger's offset while dragging to dismiss. */
  tx: Animated.Value;
  ty: Animated.Value;
  /** The pinch scale (1 = fitted) and the pan while zoomed. */
  zoom: Animated.Value;
  px: Animated.Value;
  py: Animated.Value;
  onDismiss(): void;
}): PanResponderInstance {
  let mode: 'none' | 'drag' | 'pan' | 'pinch' = 'none';
  let scale = 1;
  let pinchBase = 1;
  let d0 = 1;
  let panX = 0;
  let panY = 0;
  let baseX = 0;
  let baseY = 0;

  const limit = (v: number, size: number) => {
    const max = (size * (scale - 1)) / 2;
    return Math.max(-max, Math.min(max, v));
  };
  const back = (v: Animated.Value) =>
    Animated.spring(v, { toValue: 0, stiffness: 260, damping: 28, useNativeDriver: true });

  const settle = (g: { dx: number; dy: number; vy: number }) => {
    if (mode === 'drag') {
      if (Math.abs(g.dy) > 90 || Math.abs(g.vy) > 0.8) onDismiss();
      else Animated.parallel([back(tx), back(ty)]).start();
    } else if (mode === 'pinch') {
      if (scale < 1.05) {
        scale = 1;
        panX = 0;
        panY = 0;
        Animated.parallel([
          Animated.spring(zoom, { toValue: 1, useNativeDriver: true }),
          back(px),
          back(py),
        ]).start();
      }
    } else if (mode === 'pan') {
      panX = limit(baseX + g.dx, width);
      panY = limit(baseY + g.dy, height);
    }
    mode = 'none';
  };

  return PanResponder.create({
    // The viewer is only a gesture surface, so it takes every touch from the first.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      mode = 'none';
      baseX = panX;
      baseY = panY;
    },
    onPanResponderMove: (e: GestureResponderEvent, g) => {
      const touches = e.nativeEvent.touches as unknown as Touches;
      if (touches.length >= 2) {
        if (mode !== 'pinch') {
          mode = 'pinch';
          d0 = distance(touches);
          pinchBase = scale;
          tx.setValue(0);
          ty.setValue(0);
        } else {
          scale = Math.max(1, Math.min(MAX_ZOOM, (pinchBase * distance(touches)) / d0));
          zoom.setValue(scale);
        }
        return;
      }
      if (mode === 'pinch') return; // one finger lifted: wait for the release
      if (mode === 'none') mode = scale > 1.01 ? 'pan' : 'drag';
      if (mode === 'drag') {
        tx.setValue(g.dx);
        ty.setValue(g.dy);
      } else {
        px.setValue(limit(baseX + g.dx, width));
        py.setValue(limit(baseY + g.dy, height));
      }
    },
    onPanResponderRelease: (_e, g) => settle(g),
    onPanResponderTerminate: (_e, g) => settle(g),
  });
}
