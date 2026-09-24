/**
 * The site's icons: the guest app's outline set (apps/mobile/src/components/icons.tsx),
 * redrawn as plain SVG on Lucide's geometry. 24 grid, stroke 2, round caps and joins, no
 * fills, colour from `currentColor`. Directional icons carry `tp-icon--dir` and CSS
 * mirrors them in RTL; objects (sun, moon, a chat bubble, a handset) never mirror.
 * No third-party marks: WhatsApp and Instagram are named in words, never drawn. Always
 * decorative: the control around an icon carries the label.
 */
type IconProps = { className?: string };

function Icon({ d, className, dir }: { d: string[]; className?: string; dir?: boolean }) {
  return (
    <svg
      className={['tp-icon', dir ? 'tp-icon--dir' : null, className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

export const MoonIcon = ({ className }: IconProps) => (
  <Icon className={className} d={['M20.5 14A8.7 8.7 0 1110 3.5a7.5 7.5 0 0010.5 10.5z']} />
);
export const SunIcon = ({ className }: IconProps) => (
  <Icon
    className={className}
    d={[
      'M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M18.4 5.6l-1.1 1.1M6.7 17.3l-1.1 1.1',
    ]}
  />
);
/** A chat bubble: "message us" (WhatsApp is named in the label, never drawn). */
export const ChatIcon = ({ className }: IconProps) => (
  <Icon className={className} d={['M7.9 20A9 9 0 1 0 4 16.1L2 22z']} />
);
/** A handset: "call the desk". */
export const CallIcon = ({ className }: IconProps) => (
  <Icon
    className={className}
    d={[
      'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
    ]}
  />
);
/** The FAQ's open/close mark: a plus that CSS turns a quarter into a cross. */
export const PlusIcon = ({ className }: IconProps) => (
  <Icon className={className} d={['M5 12h14', 'M12 5v14']} />
);
/** The phone nav toggle: two court lines. */
export const MenuIcon = ({ className }: IconProps) => (
  <Icon className={className} d={['M4 9h16', 'M4 15h16']} />
);
export const CloseIcon = ({ className }: IconProps) => (
  <Icon className={className} d={['M18 6 6 18', 'M6 6l12 12']} />
);
/** Forward arrow: points to the inline end, so it mirrors in RTL. */
export const ArrowIcon = ({ className }: IconProps) => (
  <Icon className={className} dir d={['M4 12h16M14 6l6 6-6 6']} />
);
/** "Opens outside this site" (maps, Instagram): up and toward the inline end. */
export const ExternalIcon = ({ className }: IconProps) => (
  <Icon className={className} dir d={['M7 17 17 7', 'M8 7h9v9']} />
);
