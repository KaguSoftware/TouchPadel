import { Loader } from '@/components/cafe/brand/Loader';
import { Wordmark } from '@/components/cafe/brand/Wordmark';

/**
 * Streaming fallback for the dynamic /t/{token} route: blue brand panel with
 * the wordmark and the bean loader while the cached menu is read. Copy-free
 * (the layout owns the locale; this segment only has the token).
 */
export default function TableLoading() {
  return (
    <div className="tp-app" data-theme="cafe">
      <main className="tp-boot" style={{ background: 'var(--tp-accent)', minBlockSize: '100dvh' }}>
        <Wordmark tone="onBlue" className="tp-wordmark--lg" />
        <Loader size="lg" tone="onDark" />
      </main>
    </div>
  );
}
