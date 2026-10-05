import { View } from 'react-native';
import {
  isPlaceholder,
  isolateLtr,
  makeT,
  type LegalBlock,
  type LegalSection,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import { Text } from '../../i18n/text';
import { space, useTheme } from '../../theme';

/**
 * One legal document's body (the Terms or the Privacy Policy) as native text, from
 * the same section list the public pages render (packages/i18n/src/legal.ts). Read on
 * the consent screen, where the guest scrolls through it before agreeing.
 *
 * The title is the caller's: the consent screen pins it as a sticky header.
 *
 * Plain text, no links: the box exists to be read to the end, and a tap that
 * left the sheet would lose the guest's place.
 */
export function LegalDocument({
  locale,
  intro,
  sections,
  params,
  phone,
}: {
  locale: Locale;
  intro: MessageKey;
  sections: readonly LegalSection[];
  params: TParams;
  /** The branch's front-desk number, for the `phone` blocks. */
  phone: string | null | undefined;
}) {
  const { colors, fonts } = useTheme();
  const tr = makeT(locale);
  const body = { fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 21, color: colors.mut } as const;
  const strong = { fontFamily: fonts.body700, color: colors.ink } as const;

  const renderBlock = (block: LegalBlock, i: number) => {
    switch (block.kind) {
      case 'p':
        return (
          <Text key={i} style={body}>
            {tr(block.key, params)}
          </Text>
        );
      case 'list':
        return (
          <View key={i} style={{ gap: space.s }}>
            {block.items.map((item) => (
              <View key={typeof item === 'string' ? item : item.text} style={{ flexDirection: 'row', gap: space.s }}>
                <Text style={body}>{'•'}</Text>
                <Text style={[body, { flex: 1 }]}>
                  {typeof item === 'string' ? (
                    tr(item, params)
                  ) : (
                    <>
                      <Text style={strong}>{tr(item.lead, params)}</Text> {tr(item.text, params)}
                    </>
                  )}
                </Text>
              </View>
            ))}
          </View>
        );
      case 'phone':
        return (
          <Text key={i} style={body}>
            {phone
              ? `${tr('legal.contact.phoneLead')} ${isolateLtr(phone)}`
              : tr('legal.contact.noPhone')}
          </Text>
        );
      case 'entity': {
        const email = tr('legal.entity.email');
        return (
          <View key={i} style={{ gap: space.s }}>
            <Text style={body}>
              {tr('legal.contact.emailLead')} {isPlaceholder(email) ? email : isolateLtr(email)}
            </Text>
            <Text style={body}>
              {tr('legal.contact.addressLead')} {tr('legal.entity.address')}
            </Text>
          </View>
        );
      }
      case 'link':
        return (
          <Text key={i} style={[body, strong]}>
            {tr(block.label)}
          </Text>
        );
      case 'hours':
        // Neither the Terms nor the Privacy Policy carries the opening hours.
        return null;
    }
  };

  return (
    <View style={{ gap: space.m }}>
      <Text style={body}>{tr(intro, params)}</Text>
      {sections.map((section) => (
        <View key={section.id} style={{ gap: space.s }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, lineHeight: 21, color: colors.ink }}>
            {tr(section.title, params)}
          </Text>
          {section.blocks.map(renderBlock)}
        </View>
      ))}
    </View>
  );
}
