import type { StaticImageData } from 'next/image';
import hero from '@/assets/photos/hero.jpg';
import club from '@/assets/photos/club.jpg';
import lessons from '@/assets/photos/lessons.jpg';
import cafe from '@/assets/photos/cafe.jpg';
import events from '@/assets/photos/events.jpg';

/**
 * The home page's photographs, as static imports: Next reads each file's intrinsic size
 * and a blur placeholder at build time, and serves resized copies from /_next/image under
 * the CSP's `img-src 'self'`.
 *
 * Licensed stock for now, padel in the brand's night-court style, swappable for Touch's
 * own photos by replacing the file (credits and licences: docs/design/web-site/
 * photo-credits.md). They are never captioned or described as Touch's venue; the alt
 * text (`site.photos.*`) says what is in the frame.
 */
export type PhotoKey = 'hero' | 'club' | 'lessons' | 'cafe' | 'events';

export const PHOTOS: Record<PhotoKey, StaticImageData> = { hero, club, lessons, cafe, events };
