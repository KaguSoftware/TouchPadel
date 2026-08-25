'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Loader } from '../brand';

/**
 * Three stacked layers (UpperDeck ItemModal L428-459):
 *   1. the tiny `photo_blur` data-URI, blurred and scaled up;
 *   2. the brand Loader while the full-res request is in flight;
 *   3. the full-res `next/image`, faded in on load.
 * Plus the expand glyph that opens the lightbox.
 */
export function ImageLayers({
  src,
  blur,
  alt,
  expandLabel,
  loadingLabel,
  onExpand,
}: {
  src: string | null;
  blur: string | null;
  alt: string;
  expandLabel: string;
  loadingLabel?: string;
  onExpand(): void;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  const hasBlur = Boolean(blur && blur.startsWith('data:'));

  return (
    <div className="tp-itemsheet__media">
      {hasBlur && (
        // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder, never optimised
        <img
          className="tp-itemsheet__layer tp-itemsheet__layer--blur"
          src={blur as string}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      {src && !loaded && (
        <span className="tp-itemsheet__spinner">
          <Loader size="md" tone="onLight" label={loadingLabel} />
        </span>
      )}
      {src && (
        <Image
          className="tp-itemsheet__layer tp-itemsheet__layer--full"
          data-loaded={loaded ? 'true' : 'false'}
          src={src}
          alt={alt}
          fill
          quality={75}
          sizes="(min-width: 640px) 44rem, 100vw"
          priority
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      )}
      {src && (
        <button
          type="button"
          className="tp-itemsheet__expand"
          onClick={onExpand}
          aria-label={expandLabel}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path
              d="M4 10V4h6M20 14v6h-6M4 4l7 7M20 20l-7-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
