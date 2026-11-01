/**
 * "Report crash" (F-15): on the crash screen, sends the error to the
 * developers' Monitoring page itself (src/lib/monitoring.ts, userReported) and
 * says what became of it. No mail app opens; nothing the guest typed is sent.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { space, useTheme } from '../../theme';
import { Button } from '../../components/ui';
import { reportError } from '../../lib/monitoring';
import { REPORT_LINE, reportDone, type ReportState } from './logic';

export function ReportCrashButton({ error, testID }: { error: unknown; testID: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [state, setState] = useState<ReportState>('idle');
  const send = async () => {
    setState('sending');
    setState(await reportError('crash', error, { userReported: true, detail: { where: 'app.crash' } }));
  };
  return (
    <View style={{ alignSelf: 'stretch', gap: space.xs }}>
      <Button
        testID={testID}
        label={t('crashReport.button')}
        onPress={() => void send()}
        busy={state === 'sending'}
        disabled={state === 'sending' || reportDone(state)}
        variant="secondary"
      />
      <Text
        accessibilityLiveRegion="polite"
        style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, textAlign: 'center' }}
      >
        {t(REPORT_LINE[state])}
      </Text>
    </View>
  );
}
