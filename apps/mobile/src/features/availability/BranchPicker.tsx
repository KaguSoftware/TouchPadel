/**
 * The guest's branch picker (multi-venue slice 4): the platform-style segmented
 * control the staff phone uses for its venue (app/staff.tsx), one segment per
 * open branch.
 *
 * Renders NOTHING with a single open branch, so a one-branch install looks
 * exactly as it did before branches existed. The choice is remembered on the
 * device (guestVenue.ts) and every grid read follows it (hooks.ts).
 *
 * Takes the TRACK's id from the call site (`<route>.branch`); each segment is
 * `${testID}.${venueId}` (SegmentedControl).
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { MicroLabel, SegmentedControl } from '../../components/ui';
import { useLocale } from '../../i18n/LocaleProvider';
import { useTheme } from '../../theme';
import { branchName } from './branch';
import { useGuestVenue } from './hooks';

export function BranchPicker({
  testID,
  style,
}: {
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const guest = useGuestVenue();
  if (!guest.showPicker || !guest.venueId) return null;
  return (
    <View style={style}>
      <MicroLabel style={{ marginBottom: 6 }}>{t('branches.common.branch')}</MicroLabel>
      <SegmentedControl<string>
        testID={testID}
        fit
        options={guest.branches.map((b) => ({ value: b.venue_id, label: branchName(b, locale) }))}
        value={guest.venueId}
        onChange={guest.setVenueId}
        activeColor={colors.gstrong}
      />
    </View>
  );
}
