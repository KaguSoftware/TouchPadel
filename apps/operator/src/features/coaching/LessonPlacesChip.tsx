/**
 * The places chip after a lesson's name on a tile, a Today row and the actions
 * dialog (docs/design/coaching/operator.md §5.8): a group session's or
 * course's `4/6`, a private lesson's party `+2`.
 *
 * Drawn in the block's own ink (a hairline of currentColor on a transparent
 * ground, the SeatChip treatment), so it adds no colour token. Nothing when
 * the lesson has no count; the chip is never guessed.
 */
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { lessonPlacesChip, placesChipAria, placesChipText } from './lessonLogic';
import type { DeskLesson } from './lessonPayloads';

export function LessonPlacesChip({
  lesson,
}: {
  lesson: Pick<DeskLesson, 'kind' | 'places_taken' | 'max_places' | 'party_size'>;
}) {
  const { tr, locale } = useLocale();
  const chip = lessonPlacesChip(lesson);
  if (!chip) return null;
  const label = placesChipAria(chip, lesson.kind, locale, tr);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="lesson-places-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.2rem',
        flex: '0 0 auto',
        border: '1px solid currentColor',
        borderRadius: 'var(--tp-radius-pill)',
        background: 'transparent',
        color: 'inherit',
        paddingInline: '0.3rem',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 600,
        lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name="users" size={12} />
      <span aria-hidden="true">{placesChipText(chip, locale)}</span>
    </span>
  );
}
