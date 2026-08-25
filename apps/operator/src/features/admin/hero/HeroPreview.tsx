/**
 * 390-px phone-frame mock of the guest home hero. The inner tree carries
 * `data-theme="cafe"` so it picks up the cafe palette from @touch/ui's theme
 * stylesheet (which matches scoped sub-trees, not just <html>).
 */
import type { CSSProperties } from 'react';
import { applyPctDiscountIqd } from '@touch/core';
import { formatIQD } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { publicUrl } from '../../../lib/storage';
import type { HeroMode } from '../../../lib/settings';
import type { TickerRow } from './ticker';

export interface HeroPreviewItem {
  name_en: string;
  name_ar: string;
  photo_path: string | null;
  price_iqd: number | null;
}

export interface HeroPreviewProps {
  mode: HeroMode;
  mediaPath: string | null;
  mediaIsVideo: boolean;
  item: HeroPreviewItem | null;
  labelEn: string;
  labelAr: string;
  badgeEn: string;
  badgeAr: string;
  discountPct: number;
  ticker: readonly TickerRow[];
  bellTutorial: boolean;
}

const PHONE_W = 390;

export function HeroPreview(p: HeroPreviewProps) {
  const { tr, locale, dir } = useLocale();
  const ar = locale === 'ar';
  const label = ar ? p.labelAr : p.labelEn;
  const badge = ar ? p.badgeAr : p.badgeEn;
  const phrases = p.ticker.map((r) => (ar ? r.ar : r.en)).filter((s) => s.trim() !== '');

  const frame: CSSProperties = {
    inlineSize: `${PHONE_W}px`,
    maxInlineSize: '100%',
    borderRadius: '2rem',
    border: '10px solid #1b1b1b',
    overflow: 'hidden',
    background: 'var(--tp-bg)',
    color: 'var(--tp-fg)',
    fontFamily: 'var(--tp-font-body, inherit)',
    boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
  };

  return (
    <div data-theme="cafe" dir={dir} style={frame} aria-label={tr('op.hero.preview')}>
      <div style={{ blockSize: '1.4rem', background: '#1b1b1b' }} />
      <header
        style={{
          paddingBlock: '0.7rem',
          paddingInline: '1rem',
          background: 'var(--tp-accent)',
          color: 'var(--tp-accent-contrast)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ letterSpacing: '0.1em', fontSize: '0.9rem' }}>TOUCH CAFE</strong>
        <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
          {tr('op.hero.previewTable', { table: '12' })}
        </span>
      </header>

      {phrases.length > 0 && (
        <div
          style={{
            background: 'var(--tp-accent-2)',
            color: 'var(--tp-accent-2-contrast)',
            fontSize: '0.75rem',
            paddingBlock: '0.25rem',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ display: 'inline-block', animation: 'tpMarquee 14s linear infinite' }}>
            {phrases.map((s, i) => (
              <span key={i} style={{ paddingInline: '1.2rem' }}>
                {s}
              </span>
            ))}
          </span>
        </div>
      )}

      {p.mode === 'media' && (
        <div style={{ aspectRatio: '16 / 9', background: 'var(--tp-surface)', overflow: 'hidden' }}>
          {p.mediaPath ? (
            p.mediaIsVideo ? (
              <video
                src={publicUrl(p.mediaPath)}
                muted
                loop
                autoPlay
                playsInline
                style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }}
              />
            ) : (
              <img
                src={publicUrl(p.mediaPath)}
                alt=""
                style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }}
              />
            )
          ) : (
            <div
              style={{
                blockSize: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--tp-muted-fg)',
                fontSize: '0.85rem',
              }}
            >
              {tr('op.hero.mediaRequired')}
            </div>
          )}
        </div>
      )}

      {p.mode === 'featured' && <FeaturedCard {...p} label={label} badge={badge} />}

      <div style={{ paddingBlock: '0.8rem', paddingInline: '1rem', display: 'grid', gap: '0.5rem' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              blockSize: '2.6rem',
              borderRadius: '0.6rem',
              background: 'var(--tp-surface)',
              border: '1px solid var(--tp-border)',
            }}
          />
        ))}
      </div>

      {p.bellTutorial && (
        <div
          style={{
            marginInline: '1rem',
            marginBlockEnd: '0.8rem',
            paddingBlock: '0.4rem',
            paddingInline: '0.7rem',
            borderRadius: '0.6rem',
            background: 'var(--tp-surface)',
            border: '1px dashed var(--tp-accent-2)',
            fontSize: '0.75rem',
            color: 'var(--tp-muted-fg)',
          }}
        >
          🔔 {tr('op.hero.bellTutorialHint')}
        </div>
      )}
    </div>
  );
}

function FeaturedCard({
  item,
  label,
  badge,
  discountPct,
}: HeroPreviewProps & { label: string; badge: string }) {
  const { tr, locale } = useLocale();
  const name = item ? (locale === 'ar' ? item.name_ar : item.name_en) : tr('op.hero.itemRequired');
  const list = item?.price_iqd ?? null;
  const discounted =
    list !== null && discountPct > 0 && discountPct < 100 ? applyPctDiscountIqd(list, discountPct) : null;

  return (
    <div
      style={{
        margin: '0.8rem 1rem 0',
        borderRadius: '1rem',
        overflow: 'hidden',
        background: 'var(--tp-surface)',
        border: '1px solid var(--tp-border)',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'var(--tp-muted)' }}>
        {item?.photo_path && (
          <img
            src={publicUrl(item.photo_path)}
            alt=""
            style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }}
          />
        )}
        {badge && (
          <span
            style={{
              position: 'absolute',
              insetBlockStart: '0.6rem',
              insetInlineStart: '0.6rem',
              paddingBlock: '0.2rem',
              paddingInline: '0.6rem',
              borderRadius: '999px',
              background: 'var(--tp-accent-2)',
              color: 'var(--tp-accent-2-contrast)',
              fontSize: '0.7rem',
              fontWeight: 700,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div style={{ paddingBlock: '0.6rem', paddingInline: '0.8rem' }}>
        {label && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--tp-accent)' }}>
            <span style={{ display: 'inline-block', animation: 'tpMarquee 10s linear infinite' }}>
              {label}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
          <strong style={{ fontSize: '1rem' }}>{name}</strong>
          {list !== null && (
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {discounted !== null && (
                <s style={{ color: 'var(--tp-muted-fg)', marginInlineEnd: '0.4rem', fontSize: '0.8rem' }}>
                  {formatIQD(list, locale)}
                </s>
              )}
              <strong style={{ color: 'var(--tp-accent)' }}>
                {formatIQD(discounted ?? list, locale)}
              </strong>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
