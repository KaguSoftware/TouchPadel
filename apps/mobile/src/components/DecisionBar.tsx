/**
 * DecisionBar — a decider's three answers to a sent step
 * (build-contracts-2026-09-23 §2.7 `decide_step`, §6.3): approve, send back
 * for changes, or stop the whole protocol. There is no override (Q12): the
 * decider approves what was sent or sends it back.
 *
 * Choosing an answer opens its panel: Send back asks where the work goes back
 * to (the sent step itself, or an earlier finished one, from
 * `Can.send_back_targets`) and why; Stop asks why; Approve takes an optional
 * note and whatever the step's approval needs (`approveExtra`, the menu
 * category of a new item's proposal). Confirm hands the answer to the screen,
 * which validates it (`validateDecision`) and passes back `issues`.
 *
 * TEST IDs derive from the required `testID` (`staff-step.decide`):
 * `.approve`, `.send-back`, `.stop`, `.target.<runStepId>`, `.note`,
 * `.confirm`, `.cancel`.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { DecisionChoice, FieldIssue } from '@touch/core';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { Button, ErrorText, Field, MicroLabel } from './ui';

export interface DecisionTarget {
  id: string;
  label: string;
}

export interface DecisionAnswer {
  decision: DecisionChoice;
  note: string;
  sendBackTo: string | null;
}

export interface DecisionBarProps {
  testID: string;
  /** Where Send back may return the work, in run order. */
  targets: readonly DecisionTarget[];
  /** Preselected send-back target: the sent step itself. */
  defaultTargetId?: string | null;
  busy?: boolean;
  /** A refusal from the server, already in the reader's language. */
  error?: string | null;
  /** The screen's findings on the last answer: `note`, `send_back_to`. */
  issues?: readonly FieldIssue[];
  /** What an approval of this step asks for, drawn inside the Approve panel. */
  approveExtra?: ReactNode;
  onDecide: (answer: DecisionAnswer) => void;
}

export function DecisionBar({
  testID,
  targets,
  defaultTargetId,
  busy,
  error,
  issues = [],
  approveExtra,
  onDecide,
}: DecisionBarProps) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [choice, setChoice] = useState<DecisionChoice | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<string | null>(defaultTargetId ?? targets[targets.length - 1]?.id ?? null);

  const noteIssue = issues.find((i) => i.field === 'note');
  const targetIssue = issues.find((i) => i.field === 'send_back_to');
  const noteError = noteIssue
    ? noteIssue.code === 'TEXT_TOO_LONG'
      ? t('staff.protocols.form.tooLong')
      : t('staff.protocols.step.decide.reasonRequired')
    : null;

  const choose = (next: DecisionChoice) => setChoice((c) => (c === next ? null : next));

  const panel = choice ? (
    <View
      style={{
        gap: space.s,
        padding: space.sm,
        borderRadius: radius.cell,
        borderWidth: 1,
        borderColor: choice === 'stop' ? colors.redline : colors.line,
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
        {t(
          choice === 'approve'
            ? 'staff.protocols.step.decide.approveTitle'
            : choice === 'send_back'
              ? 'staff.protocols.step.decide.sendBackTitle'
              : 'staff.protocols.step.decide.stopTitle',
        )}
      </Text>
      <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut }}>
        {t(
          choice === 'approve'
            ? 'staff.protocols.step.decide.approveHint'
            : choice === 'send_back'
              ? 'staff.protocols.step.decide.sendBackHint'
              : 'staff.protocols.step.decide.stopHint',
        )}
      </Text>
      {choice === 'approve' ? approveExtra : null}
      {choice === 'send_back' && targets.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
            {t('staff.protocols.step.decide.target')}
          </Text>
          {targets.map((tg) => {
            const on = tg.id === target;
            return (
              <Pressable
                key={tg.id}
                testID={`${testID}.target.${tg.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setTarget(tg.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  paddingTop: 10,
                  paddingBottom: 10,
                  paddingStart: 12,
                  paddingEnd: 12,
                  borderRadius: radius.cell,
                  borderWidth: 1,
                  borderColor: on ? colors.blue : colors.line,
                  backgroundColor: pressed ? colors.sub : colors.card,
                })}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: radius.pill,
                    borderWidth: on ? 6 : 1.5,
                    borderColor: on ? colors.blue : colors.line,
                  }}
                />
                <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink }}>
                  {tg.label}
                </Text>
              </Pressable>
            );
          })}
          {targetIssue ? <ErrorText>{t('staff.protocols.step.decide.targetRequired')}</ErrorText> : null}
        </View>
      ) : null}
      <Field
        testID={`${testID}.note`}
        label={t(choice === 'approve' ? 'staff.protocols.step.decide.note' : 'staff.protocols.step.decide.reason')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={1000}
        error={noteError}
      />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={`${testID}.cancel`}
          label={t('staff.protocols.step.decide.cancel')}
          variant="secondary"
          size="compact"
          onPress={() => setChoice(null)}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.confirm`}
          label={t('staff.protocols.step.decide.confirm')}
          variant={choice === 'stop' ? 'danger' : 'primary'}
          size="compact"
          busy={busy}
          onPress={() =>
            onDecide({ decision: choice, note: note.trim(), sendBackTo: choice === 'send_back' ? target : null })
          }
          style={{ flex: 1 }}
        />
      </View>
    </View>
  ) : null;

  return (
    <View style={{ gap: space.s }}>
      <MicroLabel>{t('staff.protocols.step.decide.title')}</MicroLabel>
      <View style={{ gap: space.s }}>
        <Button
          testID={`${testID}.approve`}
          label={t('work.protocol.action.approve')}
          variant={choice === 'approve' ? 'primary' : 'secondary'}
          size="compact"
          onPress={() => choose('approve')}
          disabled={busy}
        />
        <Button
          testID={`${testID}.send-back`}
          label={t('work.protocol.action.sendBack')}
          variant={choice === 'send_back' ? 'primary' : 'secondary'}
          size="compact"
          onPress={() => choose('send_back')}
          disabled={busy}
        />
        <Button
          testID={`${testID}.stop`}
          label={t('work.protocol.action.stop')}
          variant={choice === 'stop' ? 'danger' : 'dangerOutline'}
          size="compact"
          onPress={() => choose('stop')}
          disabled={busy}
        />
      </View>
      {panel}
      <ErrorText>{error ?? null}</ErrorText>
    </View>
  );
}
