import Image from 'next/image';
import type { Locale } from '@touch/i18n';
import { coachInitial, coachPhotoUrl, type PublicCoach } from '@/lib/coaching';

/**
 * A coach's photo from `menu-media/coaches/<uuid>/<file>` (R43), or, without one, the first
 * letter of their name on a tinted tile, so a card never shows a broken image. Decorative
 * either way (`alt=""`): the coach's name is the text right beside it.
 *
 * The box is the caller's class (each page's sheet sizes it and sets `position: relative` for
 * `fill`); `data-letter` marks the placeholder.
 */
export function CoachPhoto({
  coach,
  locale,
  className,
  sizes,
}: {
  coach: PublicCoach;
  locale: Locale;
  className: string;
  /** The `next/image` sizes for this layout ("(min-width: 40rem) 50vw, 100vw"). */
  sizes: string;
}) {
  const url = coachPhotoUrl(coach.photo_path);
  if (!url) {
    return (
      <span className={className} data-letter="" aria-hidden="true">
        {coachInitial(coach, locale)}
      </span>
    );
  }
  return (
    <span className={className}>
      <Image src={url} alt="" fill sizes={sizes} />
    </span>
  );
}
