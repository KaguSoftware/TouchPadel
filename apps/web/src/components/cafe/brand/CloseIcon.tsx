/**
 * The close cross, drawn rather than typed.
 *
 * The buttons used to hold a literal "×" (U+00D7). That is a maths glyph: it is
 * sized and positioned to sit against digits, not centred in its em box, and a
 * font substitution changes its metrics again — so it never landed in the
 * middle of the round button whatever the CSS centring said. Two lines on a
 * symmetric viewBox have no such opinion and centre exactly.
 */
export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
