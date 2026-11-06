import { ScrollView, View } from 'react-native';
import { PRIVACY_SECTIONS, TERMS_SECTIONS, legalParams } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { useVenueSettings } from '../availability/hooks';
import { LegalDocument } from './LegalDocument';
import { space, useTheme } from '../../theme';
import { Card } from '../../components/ui';

/** The document's title, pinned to the top of the reading box. */
function DocHeader({ title }: { title: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderColor: colors.line,
        paddingHorizontal: space.m,
        paddingVertical: space.sm,
      }}
    >
      <Text style={{ fontFamily: fonts.display900, fontSize: 17, lineHeight: 23, color: colors.ink }}>{title}</Text>
    </View>
  );
}

/**
 * One of the two documents (Terms or Privacy Policy) in full, read-only, in a box that scrolls.
 * Nothing here gates anything: consent is the checkbox, this is for looking.
 * The text is the section list the public pages render (packages/i18n/src/legal.ts).
 */
export function TermsDocuments({ testID, doc }: { testID: string; doc: 'terms' | 'privacy' }) {
  const { t, locale } = useLocale();
  const settings = useVenueSettings();
  const params = legalParams(locale, settings.data?.cancellation_window_hours);
  const phone = settings.data?.phone;
  return (
    <Card style={{ flex: 1, padding: 0, marginTop: space.m, overflow: 'hidden' }}>
      <ScrollView testID={testID} stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: space.m }}>
        <DocHeader title={t(doc === 'terms' ? 'legal.terms.title' : 'legal.privacy.title')} />
        <View style={{ padding: space.m }}>
          <LegalDocument
            locale={locale}
            intro={doc === 'terms' ? 'legal.terms.intro' : 'legal.privacy.intro'}
            sections={doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS}
            params={params}
            phone={phone}
          />
        </View>
      </ScrollView>
    </Card>
  );
}
