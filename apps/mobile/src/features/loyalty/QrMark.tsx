import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { QR_INK, QR_PAPER, QUIET_MODULES, qrModules, qrPath } from '@touch/core/loyalty';

/**
 * A QR, black on white with its quiet zone, whatever the theme: a scanner reads contrast, not a
 * brand (core qr.ts). One path of horizontal runs; the viewBox carries the quiet zone so the
 * white margin scales with the code. The member card draws the same mark for its rotating token;
 * a reward voucher (0415) draws its fixed code with it.
 */
export function QrMark({ value, size, testID }: { value: string; size: number; testID?: string }) {
  const { d, size: modules } = useMemo(() => qrPath(qrModules(value)), [value]);
  const total = modules + QUIET_MODULES * 2;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox={`${-QUIET_MODULES} ${-QUIET_MODULES} ${total} ${total}`}
    >
      <Rect x={-QUIET_MODULES} y={-QUIET_MODULES} width={total} height={total} fill={QR_PAPER} />
      <Path d={d} fill={QR_INK} />
    </Svg>
  );
}
