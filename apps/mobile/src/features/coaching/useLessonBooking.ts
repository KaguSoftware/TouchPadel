/**
 * The coach screen's private-lesson grid (docs/design/coaching/guest.md
 * §4.8.3). A SIBLING of `useAvailabilityBooking`, which is not parameterised:
 * it reuses the availability pieces (`listBookableDates`, the trading night,
 * `MergedCell`) and nothing of the court grid's own state.
 *
 * The strip is today and 13 more nights (inside `coach_slots`' 14-day cap; the
 * overnight tail adds yesterday first, as on the Book tab), and one query
 * covers it: from the start of the strip's first night, venue-local, to
 * exactly 14 days on, so the key is stable for a day. The server already
 * crossed the coach's hours with the courts, so every start it sends is a free
 * cell; a night with none is a `closed` chip.
 */
import { useEffect, useMemo, useState } from 'react';
import { wallTimeToUtc } from '@touch/core';
import {
  listBookableDates,
  type MergedCell,
  type VenueSettingsPublic,
} from '../availability/assemble';
import { useCoachSlots } from './hooks';
import {
  DEFAULT_TZ,
  SLOT_WINDOW_DAYS,
  lessonCells,
  lessonWindow,
  slotsByNight,
  type ProfileOffer,
} from './logic';

export type LessonGridStatus = 'none' | 'loading' | 'error' | 'paused' | 'empty' | 'ready';

export interface LessonBooking {
  /** The coach's private offers at this branch, in the server's order. */
  types: ProfileOffer[];
  typeId: string | null;
  setTypeId: (id: string) => void;
  offer: ProfileOffer | null;
  /** The strip's nights ('YYYY-MM-DD'), first to last. */
  dates: string[];
  /** Nights with at least one start. */
  openNights: ReadonlySet<string>;
  night: string | null;
  setNight: (date: string) => void;
  cells: MergedCell[];
  /** The grid's identity: a change brings the row back to its first time. */
  gridKey: string;
  tz: string;
  status: LessonGridStatus;
  refetch: () => void;
}

export function useLessonBooking({
  coachId,
  settings,
  timezone,
  offers,
  preselectTypeId,
  preselectDate,
}: {
  coachId: string | null;
  /** The coach's branch's public settings (opening hours for the overnight tail). */
  settings: VenueSettingsPublic | null | undefined;
  /** The branch's zone from the profile read, when the settings are not in yet. */
  timezone: string | null | undefined;
  offers: readonly ProfileOffer[];
  preselectTypeId?: string | null;
  preselectDate?: string | null;
}): LessonBooking {
  const types = useMemo(() => offers.filter((o) => o.kind === 'private'), [offers]);
  const [pickedType, setTypeId] = useState<string | null>(preselectTypeId ?? null);
  const typeId =
    pickedType && types.some((o) => o.lessonTypeId === pickedType)
      ? pickedType
      : (types[0]?.lessonTypeId ?? null);
  const offer = types.find((o) => o.lessonTypeId === typeId) ?? null;
  const tz = settings?.timezone ?? timezone ?? DEFAULT_TZ;

  // A minute clock: the strip and the window move at the venue's midnight,
  // and a start that has begun drops off the grid. A render never pays for a
  // zone lookup between ticks.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const strip = useMemo(
    () => listBookableDates(now, tz, SLOT_WINDOW_DAYS - 1, settings ?? undefined),
    [now, tz, settings],
  );
  const window = useMemo(() => lessonWindow(now, tz, strip[0] ?? null), [now, tz, strip]);
  // The overnight tail's extra first night pushes the last one past the window.
  const dates = useMemo(() => {
    const end = Date.parse(window.to);
    return strip.filter((d) => wallTimeToUtc(d, 0, tz).getTime() < end);
  }, [strip, window.to, tz]);

  const slots = useCoachSlots(
    coachId && typeId ? { coachId, lessonTypeId: typeId, from: window.from, to: window.to } : null,
  );
  const nightSettings = useMemo(
    () => ({ timezone: tz, opening_hours: settings?.opening_hours ?? null }),
    [tz, settings?.opening_hours],
  );
  const byNight = useMemo(
    () => slotsByNight(slots.data?.starts ?? [], nightSettings),
    [slots.data, nightSettings],
  );
  const openNights = useMemo(() => new Set(byNight.keys()), [byNight]);

  const [pickedNight, setNight] = useState<string | null>(preselectDate ?? null);
  const night =
    pickedNight && dates.includes(pickedNight)
      ? pickedNight
      : (dates.find((d) => openNights.has(d)) ?? dates[0] ?? null);

  const cells = useMemo(
    () =>
      night && slots.data
        ? lessonCells(slots.data.starts, night, nightSettings, now, offer?.priceIqd ?? null)
        : [],
    [night, slots.data, nightSettings, now, offer?.priceIqd],
  );

  const status: LessonGridStatus = (() => {
    if (!typeId) return 'none';
    if (!slots.data) return slots.isError ? 'error' : 'loading';
    if (!slots.data.bookable) return 'paused';
    return slots.data.starts.length === 0 ? 'empty' : 'ready';
  })();

  return {
    types,
    typeId,
    setTypeId,
    offer,
    dates,
    openNights,
    night,
    setNight,
    cells,
    gridKey: `${typeId ?? ''}|${night ?? ''}`,
    tz,
    status,
    refetch: () => void slots.refetch(),
  };
}
