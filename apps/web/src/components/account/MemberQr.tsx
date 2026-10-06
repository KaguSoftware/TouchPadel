import { useMemo } from 'react';
import { QR_INK, QR_PAPER, QUIET_MODULES, qrModules, qrPath } from '@touch/core/loyalty';

/**
 * The member token as a QR code: one inline <svg>, black on white in both site modes, with
 * the four-module quiet zone a scanner needs (the operator's table cards draw theirs the same
 * way, from the same `qrPath`). Crisp at any size: `shape-rendering="crispEdges"` and a
 * viewBox in modules. The token itself is the accessible name, so a screen reader can read
 * it out to the cashier.
 */
export function MemberQr({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { d, size } = useMemo(() => qrPath(qrModules(value)), [value]);
  const box = size + 2 * QUIET_MODULES;
  return (
    <svg
      className={className}
      viewBox={`${-QUIET_MODULES} ${-QUIET_MODULES} ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-token={value}
    >
      <rect x={-QUIET_MODULES} y={-QUIET_MODULES} width={box} height={box} fill={QR_PAPER} />
      <path d={d} fill={QR_INK} />
    </svg>
  );
}
