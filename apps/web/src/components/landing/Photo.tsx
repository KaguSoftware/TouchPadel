import Image from 'next/image';
import type { PhotoGrade } from '@/lib/site/photoGrade';
import { PHOTOS, type PhotoKey } from './photos';

/**
 * One photograph in the site's grade (lib/site/photoGrade.ts, drawn by `PhotoGrade`,
 * which the page renders once): a blue-and-white duotone of exact Touch Blue shades with
 * the padel ball kept green, so stock and, later, Touch's own photos read as one set.
 * `print` (the default) keeps its whites, for photos nothing is written on; `night` is
 * one stop down and never brighter than Touch Blue, for the photo the headline sits on.
 * No gradient scrim, no glass.
 *
 * The frame fills its parent (the section sets the size or aspect); the image is
 * `fill` + `object-fit: cover` with a blur placeholder from the static import. Only the
 * hero preloads, and it is the page's LCP image, so it also asks for `fetchpriority=high`
 * (Next copies it onto the preload link): it no longer starts as a Low request behind the
 * lazy photos below the fold.
 *
 * Quality 55, not Next's 75 (one of next.config's listed qualities): every photo is shown
 * through the duotone, which keeps only luminance and one stop of it at night, so the
 * chroma and highlight detail q75 pays for never reach the screen. Measured on the hero:
 * 336 → 258 KB at 1920 wide, 139 → 104 KB at 1200 (perf finding P4, 2026-09-24).
 */
const PHOTO_QUALITY = 55;

export function Photo({
  name,
  alt,
  sizes,
  preload = false,
  grade = 'print',
  className,
}: {
  name: PhotoKey;
  alt: string;
  /** The rendered width per breakpoint, so the browser fetches the right size. */
  sizes: string;
  preload?: boolean;
  grade?: PhotoGrade;
  className?: string;
}) {
  return (
    <div
      className={['tp-photo', grade === 'night' ? 'tp-photo--night' : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <Image
        className="tp-photo__img"
        src={PHOTOS[name]}
        alt={alt}
        sizes={sizes}
        fill
        quality={PHOTO_QUALITY}
        placeholder="blur"
        preload={preload}
        fetchPriority={preload ? 'high' : undefined}
      />
    </div>
  );
}
