'use client';

import Image from 'next/image';
import type { CafeSettings } from '@/lib/menu';
import { isVideoPath, publicMediaUrl } from '@/lib/media';

/**
 * Hero mode `media` — an operator-chosen image or short video.
 *
 * The video is muted/looping/inline (autoplay policy) with the image as its
 * poster; under `prefers-reduced-motion` motion.css.ts hides the `<video>` and
 * shows the poster instead, so no JS media query is needed here.
 *
 * `priority` on the image: this is the LCP element on the site root.
 */
export function HeroMedia({ settings }: { settings: CafeSettings }) {
  const url = publicMediaUrl(settings.hero_media_path);
  if (!url) return null;
  const isVideo = settings.hero_media_kind === 'video' || isVideoPath(settings.hero_media_path);

  return (
    <div className="tp-hero__media">
      {isVideo ? (
        <video autoPlay muted loop playsInline preload="metadata" aria-hidden="true">
          <source src={url} />
        </video>
      ) : (
        <Image
          src={url}
          alt=""
          fill
          priority
          quality={75}
          sizes="(min-width: 640px) 44rem, 100vw"
        />
      )}
    </div>
  );
}
