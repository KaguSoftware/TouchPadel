/**
 * The green hand-drawn underline under page titles (app `TitleSquiggle`,
 * apps/mobile/src/components/icons.tsx): 76×8, 3.5 stroke, round caps. It sits on the
 * leading edge, so CSS mirrors it under `[dir='rtl']` (style reference §5.3).
 */
export function TitleSquiggle({ className }: { className?: string }) {
  return (
    <svg
      className={['tp-squiggle', className].filter(Boolean).join(' ')}
      viewBox="0 0 76 8"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6C22 1 50 1 74 4.5" />
    </svg>
  );
}
