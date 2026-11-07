import { useEffect, useState } from 'react';
import { createPhotoGesture } from './photoGesture';
import {
  Animated,
  Easing,
  Image,
  Modal,
  View,
  useWindowDimensions,
} from 'react-native';

export type PhotoOrigin = { x: number; y: number; width: number; height: number };

/**
 * The item photo over the whole screen, as WhatsApp and Telegram show one: it grows out of the
 * photo it was opened from, black behind, pinch to zoom, and a drag down (or up) lets go
 * of it: it shrinks back into the place it came from while the black fades. Android's back does
 * the same. A drag only closes it while the photo is not zoomed in, so panning a zoomed photo
 * never dismisses it.
 */
export function PhotoViewer({
  url,
  testID,
  origin,
  onClose,
}: {
  url: string;
  testID: string;
  /** Where the photo sits on screen (window coordinates); null grows it from the middle. */
  origin: PhotoOrigin | null;
  onClose(): void;
}) {
  const { width, height } = useWindowDimensions();
  const [tx] = useState(() => new Animated.Value(0)); // the finger's offset, sideways
  const [ty] = useState(() => new Animated.Value(0)); // and down
  const [o] = useState(() => new Animated.Value(0)); // 0 = in its place, 1 = over the screen
  const [zoom] = useState(() => new Animated.Value(1)); // pinch scale
  const [px] = useState(() => new Animated.Value(0)); // pan while zoomed in
  const [py] = useState(() => new Animated.Value(0));

  const from: PhotoOrigin = origin ?? {
    x: width * 0.1,
    y: height * 0.3,
    width: width * 0.8,
    height: height * 0.4,
  };
  const startScale = Math.max(0.05, from.width / width);
  const dx = from.x + from.width / 2 - width / 2;
  const dy = from.y + from.height / 2 - height / 2;

  /** Lets go of the photo: it shrinks back to its place and the viewer closes when it lands. */
  const [close] = useState(() => () => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };
    const t = { duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true };
    Animated.parallel([
      Animated.timing(o, { toValue: 0, ...t }),
      Animated.timing(tx, { toValue: 0, ...t }),
      Animated.timing(ty, { toValue: 0, ...t }),
      Animated.timing(zoom, { toValue: 1, ...t }),
      Animated.timing(px, { toValue: 0, ...t }),
      Animated.timing(py, { toValue: 0, ...t }),
    ]).start(finish);
    // The viewer must never stay up if the animation's callback is lost.
    setTimeout(finish, 400);
  });

  useEffect(() => {
    Animated.timing(o, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [o]);

  const [pan] = useState(() =>
    createPhotoGesture({ width, height, tx, ty, zoom, px, py, onDismiss: close }),
  );

  // How far the finger has pulled: the photo gets smaller and the black fades with it.
  const dragScale = ty.interpolate({
    inputRange: [-height / 2, 0, height / 2],
    outputRange: [0.6, 1, 0.6],
    extrapolate: 'clamp',
  });
  const dragFade = ty.interpolate({
    inputRange: [-height / 2, 0, height / 2],
    outputRange: [0.2, 1, 0.2],
    extrapolate: 'clamp',
  });
  const backdrop = Animated.multiply(o, dragFade);
  const baseX = o.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] });
  const baseY = o.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] });
  const translateX = Animated.add(Animated.add(baseX, tx), px);
  const translateY = Animated.add(Animated.add(baseY, ty), py);
  // The photo here is fitted to the screen and the sheet's is cropped to fill its box, so as this
  // one lands it fades into the one underneath rather than switching shape in a single frame.
  const landing = o.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] });
  const openScale = o.interpolate({ inputRange: [0, 1], outputRange: [startScale, 1] });
  const scale = Animated.multiply(Animated.multiply(openScale, dragScale), zoom);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => close()}
    >
      <View style={{ flex: 1 }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            start: 0,
            end: 0,
            backgroundColor: '#000',
            opacity: backdrop,
          }}
        />
        <Animated.View
          {...pan.panHandlers}
          style={{ flex: 1, opacity: landing, transform: [{ translateX }, { translateY }, { scale }] }}
        >
          <Image
            testID={`${testID}.zoom`}
            source={{ uri: url }}
            style={{ width, height }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
      </View>
    </Modal>
  );
}
