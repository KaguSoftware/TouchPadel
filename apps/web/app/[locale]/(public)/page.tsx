// Venue landing placeholder — public venue pages + read-only menu (design-arch.md §1).
// TODO(FE2): real content from @touch/i18n catalogs, padel theme tokens from @touch/ui,
// venue mode banner from venue_status realtime (design-arch.md §5).
export default async function VenuePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  return (
    <main style={{ padding: '2rem', maxInlineSize: '48rem', marginInline: 'auto' }}>
      <h1>{ar ? 'تاتش بادل' : 'Touch Padel'}</h1>
      <p>{ar ? 'الموقع قيد الإنشاء — احجز ملعبك قريباً.' : 'Under construction — court booking coming soon.'}</p>
    </main>
  );
}
