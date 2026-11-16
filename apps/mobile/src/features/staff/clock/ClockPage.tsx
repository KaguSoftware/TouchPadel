/**
 * The clock page (0442; app/(staff)/staff-clock.tsx, `kind` in or out): start
 * or finish work by scanning the desk screen's QR at the club.
 *
 *   1. Location first, then the camera. Each is asked for only when the
 *      system can still show its prompt, after a line saying why; refused for
 *      good, the page says how to turn it back on and opens Settings. The
 *      phone's own location switch, and "approximate" location, are steps of
 *      their own. Back from Settings, the page reads everything again.
 *   2. While the camera is open the location is watched, so a fresh fix is
 *      ready when the code is read. Only a code parseClockCode accepts is
 *      taken, once; anything else the camera sees is ignored. The six digits
 *      under the QR can be typed instead.
 *   3. The fix sent is fresh (logic.ts chooseFix): sent at once when precise,
 *      the best one after a few seconds otherwise, and after 15 s with none,
 *      "your location was not found".
 *   4. The server's answer: the time it was logged (and late or early
 *      minutes), or the refusal's reason and next step. Raised errors read
 *      through the app's error mapping. No raw code is ever shown.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { asciiDigits, countPhrase, formatTime, type MessageKey } from '@touch/i18n';
import { parseClockCode, type ClockKind, type ClockPunchResult } from '@touch/core/staff/clock';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../../theme';
import { Button, LinkText, Screen } from '../../../components/ui';
import { CodeInput } from '../../../components/CodeInput';
import {
  CameraIcon,
  CheckIcon,
  PinIcon,
  WarningIcon,
  type IconProps,
} from '../../../components/icons';
import { useBack } from '../../../navigation/back';
import { useScreenFocused } from '../../../lib/useScreenFocused';
import { useStaffStatus } from '../StaffStatusProvider';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { sendPunch } from './api';
import { clockDeviceId } from './device';
import {
  askCameraPermission,
  askLocationPermission,
  ClockScanner,
  clockNativeAvailable,
  currentFix,
  locationServicesOn,
  readCameraPermission,
  readLocationPermission,
  turnOnLocation,
  watchFixes,
} from './native';
import {
  acceptedView,
  accuracyParams,
  chooseFix,
  clockStep,
  distanceText,
  keepBest,
  punchArgs,
  refusalActionKey,
  refusalView,
  titleKey,
  type ClockStep,
  type Fix,
  type RefusalAction,
} from './logic';

const T = 'staff-clock';

type Phase =
  | { name: 'checking' }
  /** A binary built before the camera and location modules: update the app. */
  | { name: 'update' }
  | { name: 'step'; step: Exclude<ClockStep, 'ready'> }
  | { name: 'capture' }
  | { name: 'sending'; stage: 'locating' | 'sending' }
  | { name: 'locationFailed' }
  | { name: 'accepted'; result: Extract<ClockPunchResult, { status: 'accepted' }> }
  | { name: 'refused'; result: Extract<ClockPunchResult, { status: 'refused' }> }
  | { name: 'error'; messageKey: MessageKey };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The round mark at the top of a step or an answer. */
function Mark({
  icon: Icon,
  tone,
}: {
  icon: ComponentType<IconProps>;
  tone: 'plain' | 'good' | 'warn' | 'bad';
}) {
  const { colors } = useTheme();
  const look = {
    plain: { bg: colors.tint, line: colors.line, fg: colors.blue },
    good: { bg: colors.gtint, line: colors.gline, fg: colors.gstrong },
    warn: { bg: colors.amb, line: colors.ambline, fg: colors.ambtext },
    bad: { bg: colors.redtint, line: colors.redline, fg: colors.redtext },
  }[tone];
  const big = tone === 'good';
  return (
    <View
      style={{
        width: big ? 76 : 56,
        height: big ? 76 : 56,
        borderRadius: big ? 38 : 28,
        borderWidth: 1,
        borderColor: look.line,
        backgroundColor: look.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={big ? 36 : 26} color={look.fg} strokeWidth={big ? 2.4 : 1.9} />
    </View>
  );
}

/** A step or an answer: mark, title, body, then its buttons. */
function Panel({
  testID,
  mark,
  title,
  body,
  children,
}: {
  testID: string;
  mark: ReactNode;
  title: string;
  body?: string | null;
  children?: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View testID={testID} style={{ gap: space.m, paddingTop: space.l }}>
      {mark}
      <View style={{ gap: space.s }}>
        <Text style={{ fontFamily: fonts.display800, fontSize: 22, lineHeight: 28, color: colors.ink }}>{title}</Text>
        {body ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 15, lineHeight: 22, color: colors.mut2 }}>{body}</Text>
        ) : null}
      </View>
      {children ? <View style={{ gap: space.sm, marginTop: space.s }}>{children}</View> : null}
    </View>
  );
}

export function ClockPage({ kind }: { kind: ClockKind }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const back = useBack('/staff');
  const focused = useScreenFocused();
  const { venueId } = useStaffStatus();

  const [phase, setPhase] = useState<Phase>(() =>
    clockNativeAvailable() ? { name: 'checking' } : { name: 'update' },
  );
  /** The person chose to type the digits (or the camera is off and they took the way round it). */
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedBad, setTypedBad] = useState(false);
  // In the foreground unless the system says otherwise (it can say 'unknown' on the first frame).
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  /** The best location fix while the page watches; shown as "Location found (±12 m)". */
  const [shownFix, setShownFix] = useState<Fix | null>(null);

  const best = useRef<Fix | null>(null);
  /** One code submits once: set when a code is taken, cleared by Scan again. */
  const taken = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const takeFix = useCallback((fix: Fix) => {
    best.current = keepBest(best.current, fix, Date.now());
    if (alive.current) setShownFix(best.current);
  }, []);

  // ── 1. The steps ──────────────────────────────────────────────────────────
  const evaluate = useCallback(
    async (typingNow: boolean) => {
      // A binary without the modules stays on its update step (the first state says so).
      if (!clockNativeAvailable()) return;
      try {
        const [location, servicesOn, camera] = await Promise.all([
          readLocationPermission(),
          locationServicesOn(),
          readCameraPermission(),
        ]);
        if (!alive.current) return;
        const step = clockStep({ location, servicesOn, camera }, typingNow);
        if (step === 'ready') {
          taken.current = false;
          setPhase({ name: 'capture' });
        } else {
          setPhase({ name: 'step', step });
        }
      } catch {
        // A permission module that did not answer: treat location as not yet allowed, so the
        // page asks rather than opening a camera with nothing to send.
        if (alive.current) setPhase({ name: 'step', step: 'location-ask' });
      }
    },
    [],
  );

  useEffect(() => {
    void evaluate(false);
  }, [evaluate]);

  // Back from Settings (or the system dialog): read everything again.
  const phaseName = phase.name;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next !== 'background');
      if (next === 'active' && (phaseName === 'step' || phaseName === 'checking')) void evaluate(typing);
    });
    return () => sub.remove();
  }, [evaluate, phaseName, typing]);

  // ── 2. The watch, only while a code may come ─────────────────────────────
  const watching = focused && appActive && (phase.name === 'capture' || phase.name === 'sending');
  useEffect(() => {
    if (!watching) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    watchFixes(takeFix)
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch(() => {
        // No watch: the send asks for one fix itself.
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [watching, takeFix]);

  // ── 3. A code, a fix, the punch ───────────────────────────────────────────
  const waitForFix = useCallback(async (): Promise<Fix | null> => {
    const started = Date.now();
    // No usable watched fix yet: one direct read beside the watch, in case it is slow to start.
    if (chooseFix(best.current, started, 0) === 'wait') currentFix().then(takeFix, () => undefined);
    for (;;) {
      const now = Date.now();
      const choice = chooseFix(best.current, now, now - started);
      if (choice === 'fail') return null;
      if (choice !== 'wait') return choice.use;
      await sleep(250);
      if (!alive.current) return null;
    }
  }, [takeFix]);

  const submit = useCallback(
    async (code: string) => {
      if (taken.current || !venueId) return;
      taken.current = true;
      setPhase({ name: 'sending', stage: 'locating' });
      const fix = await waitForFix();
      if (!alive.current) return;
      if (!fix) {
        setPhase({ name: 'locationFailed' });
        return;
      }
      setPhase({ name: 'sending', stage: 'sending' });
      try {
        const deviceId = await clockDeviceId();
        const result = await sendPunch(
          punchArgs({
            venueId,
            kind,
            code,
            fix,
            deviceId,
            platform: Platform.OS === 'android' ? 'android' : 'ios',
          }),
        );
        void queryClient.invalidateQueries({ queryKey: staffKeys.myClock(venueId) });
        if (!alive.current) return;
        if (result.status === 'accepted') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setPhase({ name: 'accepted', result });
        } else {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          setPhase({ name: 'refused', result });
        }
      } catch (err) {
        if (alive.current) setPhase({ name: 'error', messageKey: mapStaffError(err) });
      }
    },
    [venueId, kind, waitForFix, queryClient],
  );

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (taken.current) return;
      const code = parseClockCode(data);
      // Anything that is not the desk's QR is ignored, silently.
      if (code) void submit(code);
    },
    [submit],
  );

  const onTyped = (raw: string) => {
    setTypedBad(false);
    setTyped(asciiDigits(raw).replace(/\D/g, '').slice(0, 6));
  };
  const sendTyped = () => {
    const code = parseClockCode(typed);
    if (!code) {
      setTypedBad(true);
      return;
    }
    void submit(code);
  };

  const again = () => {
    taken.current = false;
    best.current = null;
    setShownFix(null);
    setTyped('');
    setPhase({ name: 'checking' });
    void evaluate(typing);
  };
  const switchTyping = (on: boolean) => {
    setTyping(on);
    setTypedBad(false);
    setPhase({ name: 'checking' });
    void evaluate(on);
  };
  const runAction = (action: RefusalAction) => (action === 'back' ? back() : again());

  // ── Rendering ─────────────────────────────────────────────────────────────
  const openSettings = () => void Linking.openSettings().catch(() => {});
  const accuracyText = (m: number) => t('staff.clock.units.accuracy', accuracyParams(m, locale));

  const body = (() => {
    switch (phase.name) {
      case 'checking':
        return (
          <View style={{ paddingTop: space.xl, alignItems: 'center', gap: space.sm }}>
            <ActivityIndicator color={colors.blue} />
            <Text style={{ fontFamily: fonts.body600, fontSize: 14, color: colors.mut }}>{t('staff.clock.checking')}</Text>
          </View>
        );

      case 'update':
        return (
          <Panel
            testID={`${T}.update`}
            mark={<Mark icon={WarningIcon} tone="warn" />}
            title={t('staff.clock.update.title')}
            body={t('staff.clock.update.body')}
          >
            <Button testID={`${T}.back`} label={t('staff.clock.actions.back')} variant="secondary" onPress={back} />
          </Panel>
        );

      case 'step':
        switch (phase.step) {
          case 'location-ask':
            return (
              <Panel
                testID={`${T}.step.location`}
                mark={<Mark icon={PinIcon} tone="plain" />}
                title={t('staff.clock.steps.location.title')}
                body={t('staff.clock.steps.location.body')}
              >
                <Button
                  testID={`${T}.allow-location`}
                  label={t('staff.clock.steps.location.action')}
                  onPress={() => {
                    void askLocationPermission()
                      .catch(() => undefined)
                      .then(() => evaluate(typing));
                  }}
                />
              </Panel>
            );
          case 'location-blocked':
          case 'location-approx': {
            const k = phase.step === 'location-blocked' ? 'locationBlocked' : 'locationApprox';
            return (
              <Panel
                testID={`${T}.step.${phase.step}`}
                mark={<Mark icon={PinIcon} tone="warn" />}
                title={t(`staff.clock.steps.${k}.title`)}
                body={t(`staff.clock.steps.${k}.body`)}
              >
                <Button testID={`${T}.open-settings`} label={t('staff.clock.steps.openSettings')} onPress={openSettings} />
                <Button
                  testID={`${T}.recheck`}
                  label={t('staff.clock.steps.tryAgain')}
                  variant="secondary"
                  onPress={() => void evaluate(typing)}
                />
              </Panel>
            );
          }
          case 'location-off':
            return (
              <Panel
                testID={`${T}.step.location-off`}
                mark={<Mark icon={PinIcon} tone="warn" />}
                title={t('staff.clock.steps.servicesOff.title')}
                body={t('staff.clock.steps.servicesOff.body')}
              >
                {Platform.OS === 'android' ? (
                  <Button
                    testID={`${T}.turn-on-location`}
                    label={t('staff.clock.steps.servicesOff.turnOn')}
                    onPress={() => void turnOnLocation().then(() => evaluate(typing))}
                  />
                ) : null}
                <Button
                  testID={`${T}.recheck`}
                  label={t('staff.clock.steps.tryAgain')}
                  variant={Platform.OS === 'android' ? 'secondary' : 'primary'}
                  onPress={() => void evaluate(typing)}
                />
              </Panel>
            );
          case 'camera-ask':
          case 'camera-blocked': {
            const ask = phase.step === 'camera-ask';
            return (
              <Panel
                testID={`${T}.step.${phase.step}`}
                mark={<Mark icon={CameraIcon} tone={ask ? 'plain' : 'warn'} />}
                title={t(ask ? 'staff.clock.steps.camera.title' : 'staff.clock.steps.cameraBlocked.title')}
                body={t(ask ? 'staff.clock.steps.camera.body' : 'staff.clock.steps.cameraBlocked.body')}
              >
                {ask ? (
                  <Button
                    testID={`${T}.allow-camera`}
                    label={t('staff.clock.steps.camera.action')}
                    onPress={() => {
                      void askCameraPermission()
                        .catch(() => undefined)
                        .then(() => evaluate(typing));
                    }}
                  />
                ) : (
                  <Button testID={`${T}.open-settings`} label={t('staff.clock.steps.openSettings')} onPress={openSettings} />
                )}
                <Button
                  testID={`${T}.type-instead`}
                  label={t('staff.clock.scan.typeInstead')}
                  variant="secondary"
                  onPress={() => switchTyping(true)}
                />
              </Panel>
            );
          }
        }
        return null;

      case 'capture': {
        const located = shownFix && shownFix.accuracy !== null;
        const status = (
          <View testID={`${T}.location`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {located ? (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gstrong }} />
            ) : (
              <ActivityIndicator size="small" color={colors.mut} />
            )}
            <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>
              {located
                ? t('staff.clock.scan.located', { accuracy: accuracyText(shownFix.accuracy!) })
                : t('staff.clock.scan.locating')}
            </Text>
          </View>
        );
        if (typing) {
          const ready = parseClockCode(typed) !== null;
          return (
            <View testID={`${T}.type`} style={{ gap: space.m, paddingTop: space.m }}>
              <CodeInput
                testID={`${T}.code`}
                label={t('staff.clock.type.label')}
                value={typed}
                onChangeText={onTyped}
                error={typedBad}
                autoFocus
                onSubmitEditing={sendTyped}
              />
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 13.5,
                  lineHeight: 20,
                  color: typedBad ? colors.redtext : colors.mut,
                }}
              >
                {t(typedBad ? 'staff.clock.type.invalid' : 'staff.clock.type.hint')}
              </Text>
              {status}
              <Button testID={`${T}.send`} label={t('staff.clock.type.send')} disabled={!ready} onPress={sendTyped} />
              <LinkText
                testID={`${T}.scan-instead`}
                label={t('staff.clock.scan.scanInstead')}
                onPress={() => switchTyping(false)}
                style={{ alignSelf: 'center' }}
              />
            </View>
          );
        }
        return (
          <View testID={`${T}.scan`} style={{ gap: space.m, paddingTop: space.m }}>
            <View
              style={{
                width: '100%',
                aspectRatio: 1,
                borderRadius: radius.card,
                overflow: 'hidden',
                backgroundColor: colors.seg,
              }}
            >
              {focused && appActive ? <ClockScanner style={{ flex: 1 }} onBarcodeScanned={onScanned} /> : null}
              <Finder />
            </View>
            <Text style={{ fontFamily: fonts.body600, fontSize: 15, lineHeight: 22, color: colors.ink }}>
              {t('staff.clock.scan.hint')}
            </Text>
            {status}
            <LinkText
              testID={`${T}.type-instead`}
              label={t('staff.clock.scan.typeInstead')}
              onPress={() => switchTyping(true)}
              style={{ alignSelf: 'center', marginTop: space.s }}
            />
          </View>
        );
      }

      case 'sending':
        return (
          <View testID={`${T}.sending`} style={{ paddingTop: space.xl, alignItems: 'center', gap: space.sm }}>
            <ActivityIndicator color={colors.blue} size="large" />
            <Text style={{ fontFamily: fonts.body600, fontSize: 15, color: colors.ink }}>
              {t(phase.stage === 'locating' ? 'staff.clock.sending.locating' : 'staff.clock.sending.sending')}
            </Text>
          </View>
        );

      case 'locationFailed':
        return (
          <Panel
            testID={`${T}.location-failed`}
            mark={<Mark icon={PinIcon} tone="warn" />}
            title={t('staff.clock.locationFailed.title')}
            body={t('staff.clock.locationFailed.body')}
          >
            <Button testID={`${T}.try-again`} label={t('staff.clock.actions.tryAgain')} onPress={again} />
            <Button testID={`${T}.back`} label={t('staff.clock.actions.back')} variant="secondary" onPress={back} />
          </Panel>
        );

      case 'accepted': {
        const view = acceptedView(phase.result);
        return (
          <Panel
            testID={`${T}.accepted`}
            mark={<Mark icon={CheckIcon} tone="good" />}
            title={t(view.titleKey, { time: formatTime(new Date(phase.result.at), locale) })}
          >
            {view.minutes ? (
              <View
                testID={`${T}.minutes`}
                style={{
                  alignSelf: 'flex-start',
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: radius.pill,
                  backgroundColor: colors.amb,
                  borderWidth: 1,
                  borderColor: colors.ambline,
                }}
              >
                <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ambtext }}>
                  {countPhrase(view.minutes.key, view.minutes.n, locale)}
                </Text>
              </View>
            ) : null}
            <Button testID={`${T}.done`} label={t('staff.clock.result.done')} onPress={back} />
          </Panel>
        );
      }

      case 'refused': {
        const r = phase.result;
        const view = refusalView(r.reason);
        const params: Record<string, string> = {};
        if (view.needs === 'distance' && r.distance_m !== undefined) {
          const d = distanceText(r.distance_m, locale);
          params.distance = t(d.key, d.params);
        }
        if (view.needs === 'accuracy' && r.accuracy_m !== undefined) params.accuracy = accuracyText(r.accuracy_m);
        return (
          <Panel
            testID={`${T}.refused.${r.reason.toLowerCase().replace(/_/g, '-')}`}
            mark={<Mark icon={WarningIcon} tone="bad" />}
            title={t(view.titleKey)}
            body={t(view.bodyKey, params)}
          >
            {view.actions.map((action, i) => (
              <Button
                key={action}
                testID={`${T}.${action === 'scanAgain' ? 'scan-again' : action === 'tryAgain' ? 'try-again' : 'back'}`}
                label={t(refusalActionKey(action))}
                variant={i === 0 ? 'primary' : 'secondary'}
                onPress={() => runAction(action)}
              />
            ))}
          </Panel>
        );
      }

      case 'error':
        return (
          <Panel
            testID={`${T}.error`}
            mark={<Mark icon={WarningIcon} tone="bad" />}
            title={t('staff.clock.error.title')}
            body={t(phase.messageKey)}
          >
            <Button testID={`${T}.try-again`} label={t('staff.clock.actions.tryAgain')} onPress={again} />
            <Button testID={`${T}.back`} label={t('staff.clock.actions.back')} variant="secondary" onPress={back} />
          </Panel>
        );
    }
  })();

  return (
    <Screen pattern="blur" clearBar edges={[]}>
      <Stack.Screen options={{ title: t(titleKey(kind)) }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ flexGrow: 1, paddingTop: space.m, paddingBottom: 40 + insets.bottom }}
      >
        <View testID={`${T}.body`}>{body}</View>
      </ScrollView>
    </Screen>
  );
}

/** Four corner marks over the camera, where the QR goes. Decoration: read by nobody. */
function Finder() {
  const corner = { position: 'absolute' as const, width: 34, height: 34, borderColor: brand.white };
  const w = 4;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: '18%', bottom: '18%', start: '18%', end: '18%' }}
    >
      <View style={{ ...corner, top: 0, start: 0, borderTopWidth: w, borderStartWidth: w, borderTopStartRadius: 10 }} />
      <View style={{ ...corner, top: 0, end: 0, borderTopWidth: w, borderEndWidth: w, borderTopEndRadius: 10 }} />
      <View style={{ ...corner, bottom: 0, start: 0, borderBottomWidth: w, borderStartWidth: w, borderBottomStartRadius: 10 }} />
      <View style={{ ...corner, bottom: 0, end: 0, borderBottomWidth: w, borderEndWidth: w, borderBottomEndRadius: 10 }} />
    </View>
  );
}
