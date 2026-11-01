import { CourtPattern } from '@/components/site/brand/CourtPattern';
import { PATTERN_VIEWBOX } from '@/components/site/brand/brandPattern';
import { countPhrase, formatIQD, isolate, makeT, type Locale } from '@touch/i18n';
import {
  LESSON_KINDS,
  coachFromPrice,
  coachName,
  coachesAt,
  lessonPrice,
  lessonTypeLine,
  localText,
  sessionPrice,
  sessionTitle,
  sessionWhen,
  sessionsAt,
  typesAt,
  type CoachingBranch as Branch,
  type PublicCoach,
  type PublicCoaching,
  type PublicLessonType,
  type PublicSession,
} from '@/lib/coaching';
import { coachLinkPath, coachSegment } from '@/lib/site/coachLink';
import { CoachPhoto } from './CoachPhoto';

/**
 * One branch's coaching on `/{locale}/coaching` (docs/design/coaching/guest.md §4.14.2): the
 * coach cards, the lesson types by kind, the upcoming group sessions and courses with places.
 *
 * Every price here has been through the parser, which drops a branch's prices while its
 * `lesson_prices_public` switch is off (C-11), so a hidden price is a null and prints nothing.
 * No student, phone or count of people by name; places left is a count.
 *
 * `level` is the heading level of the sections: 2 when the page shows one branch, 3 under a
 * branch heading when it shows several.
 */
type Level = 2 | 3;

/**
 * The app's photo-less coach tile (BrandPattern at PATTERN_ZOOM 2, lines 1.1 panel units wide,
 * white at 0.16): a 3:2 window of the panel at 2x, so the lines land at the same weight and
 * angle as in the app. The app centres that window, which leaves one corner bare and another
 * crowded; this one sits where the bands spread evenly (least spread of line length across a
 * 4 x 3 grid of the tile, measured on the panel's eleven bands) and no band ends inside it.
 */
export const APP_TILE_CROP = (() => {
  const w = PATTERN_VIEWBOX.width / 2;
  return [108, 105, w, (w * 2) / 3] as const;
})();

function Heading({
  level,
  id,
  className,
  children,
}: {
  level: Level;
  id: string;
  className: string;
  children: string;
}) {
  return level === 2 ? (
    <h2 id={id} className={className}>
      {children}
    </h2>
  ) : (
    <h3 id={id} className={className}>
      {children}
    </h3>
  );
}

function SubHeading({
  level,
  className,
  children,
}: {
  level: Level;
  className: string;
  children: string;
}) {
  return level === 2 ? (
    <h3 className={className}>{children}</h3>
  ) : (
    <h4 className={className}>{children}</h4>
  );
}

function CoachCard({
  coaching,
  coach,
  venueId,
  locale,
  level,
}: {
  coaching: PublicCoaching;
  coach: PublicCoach;
  venueId: string;
  locale: Locale;
  level: Level;
}) {
  const tr = makeT(locale);
  const name = coachName(coach, locale);
  const from = coachFromPrice(coaching, coach, venueId);
  // The app's coach card: the photo (or the initial on the brand blue) across the top, then the
  // name and "From {price}"; the whole card opens the coach.
  return (
    <li>
      <a className="tp-coach-card" data-coach={coach.id} href={coachLinkPath(locale, coachSegment(coach))}>
        <CoachPhoto
          coach={coach}
          locale={locale}
          className="tp-coach-card__photo tp-on-blue"
          sizes="(min-width: 48rem) 33vw, 50vw"
          backdrop={<CourtPattern band={1.1} crop={APP_TILE_CROP} className="tp-coach-card__pattern" />}
        />
        <div className="tp-coach-card__body">
          <SubHeading level={level} className="tp-coach-card__name">
            {name}
          </SubHeading>
          {from !== null ? (
            <p className="tp-coach-card__price tp-num">
              {tr('coaching.web.from', { price: formatIQD(from, locale) })}
            </p>
          ) : null}
        </div>
      </a>
    </li>
  );
}

/** "Private lesson, 90 min" reads as two lines: the name, then what sets it apart. */
export function nameLines(name: string): [string, string | null] {
  const at = name.search(/[,،]\s/);
  return at < 0 ? [name, null] : [name.slice(0, at + 1), name.slice(at + 1).trim()];
}

/** "45,000 IQD / lesson": the amount large, the unit after the slash smaller, one line. */
export function priceParts(price: string) {
  const at = price.indexOf(' / ');
  if (at < 0) return price;
  return (
    <>
      {price.slice(0, at)}
      <span className="tp-coach-type__unit">{price.slice(at)}</span>
    </>
  );
}

/**
 * A lesson card: a band (blue in light mode, green in night, by CSS) with the kind and the name,
 * then the duration line, the description and the price on one line in green.
 */
function LessonType({
  type,
  locale,
  kindLabel,
}: {
  type: PublicLessonType;
  locale: Locale;
  kindLabel: string;
}) {
  const description = localText(locale, type.description_en, type.description_ar).trim();
  const price = lessonPrice(type.kind, type.price_iqd, locale);
  const [first, rest] = nameLines(localText(locale, type.name_en, type.name_ar));
  return (
    <li className="tp-coach-type" data-type={type.id}>
      <div className="tp-coach-type__band">
        <span className="tp-coach-type__kind" aria-hidden="true">
          {kindLabel}
        </span>
        <p className="tp-coach-type__name">
          {first}
          {rest ? (
            <>
              <br />
              {rest}
            </>
          ) : null}
        </p>
      </div>
      <div className="tp-coach-type__body">
        <p className="tp-coach-type__line tp-num">{lessonTypeLine(type, locale)}</p>
        {description ? <p className="tp-coach-type__desc">{description}</p> : null}
        {price ? <p className="tp-coach-type__price tp-num">{priceParts(price)}</p> : null}
      </div>
    </li>
  );
}

function Session({
  coaching,
  session,
  branch,
  locale,
}: {
  coaching: PublicCoaching;
  session: PublicSession;
  branch: Branch;
  locale: Locale;
}) {
  const tr = makeT(locale);
  const type = coaching.lesson_types.find((t) => t.id === session.lesson_type_id) ?? null;
  const coach = coaching.coaches.find((c) => c.id === session.coach_id);
  const when = sessionWhen(session, branch.timezone, locale);
  const price = sessionPrice(session, locale);
  if (!coach || !when) return null;
  return (
    <li>
      {/* The app shows that coach's sessions: the coach's link is the way in (§4.14.2). */}
      <a
        className="tp-coach-session"
        href={coachLinkPath(locale, coachSegment(coach))}
        data-session={session.lesson_id ?? session.course_id ?? ''}
      >
        <span className="tp-coach-session__when tp-num">{when}</span>
        <span className="tp-coach-session__what">{sessionTitle(session, type, locale)}</span>
        <span className="tp-coach-session__who">
          {tr('coaching.web.withCoach', { coach: isolate(coachName(coach, locale)) })}
        </span>
        <span className="tp-coach-session__places tp-num">
          {countPhrase('coaching.common.count.placesLeft', session.places_left, locale)}
        </span>
        {price ? <span className="tp-coach-session__price tp-num">{price}</span> : null}
      </a>
    </li>
  );
}

export function CoachingBranch({
  coaching,
  branch,
  locale,
  level,
  index,
}: {
  coaching: PublicCoaching;
  branch: Branch;
  locale: Locale;
  level: Level;
  /** The block's position on the page, for unique heading ids. */
  index: number;
}) {
  const tr = makeT(locale);
  const coaches = coachesAt(coaching, branch.venue_id);
  const types = typesAt(coaching, branch.venue_id);
  const sessions = sessionsAt(coaching, branch.venue_id);
  const ids = {
    coaches: `coaching-coaches-${index}`,
    types: `coaching-types-${index}`,
    sessions: `coaching-sessions-${index}`,
  };
  return (
    <>
      <section className="tp-coaching__part" aria-labelledby={ids.coaches}>
        <Heading level={level} id={ids.coaches} className="tp-coaching__h">
          {tr('coaching.web.coachesTitle')}
        </Heading>
        <ul className="tp-coach-cards">
          {coaches.map((coach) => (
            <CoachCard
              key={coach.id}
              coaching={coaching}
              coach={coach}
              venueId={branch.venue_id}
              locale={locale}
              level={level}
            />
          ))}
        </ul>
      </section>
      {types.length > 0 ? (
        <section className="tp-coaching__part" aria-labelledby={ids.types}>
          <Heading level={level} id={ids.types} className="tp-coaching__h">
            {tr('coaching.web.typesTitle')}
          </Heading>
          <div className="tp-coach-types">
            {LESSON_KINDS.map((kind) => {
              const ofKind = types.filter((t) => t.kind === kind);
              if (ofKind.length === 0) return null;
              return (
                <div key={kind} className="tp-coach-types__group" data-kind={kind}>
                  <SubHeading level={level} className="tp-coach-types__kind">
                    {tr(`coaching.web.kind.${kind}`)}
                  </SubHeading>
                  <ul className="tp-coach-types__list">
                    {ofKind.map((type) => (
                      <LessonType
                        key={type.id}
                        type={type}
                        locale={locale}
                        kindLabel={tr(`coaching.web.kind.${kind}`)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {sessions.length > 0 ? (
        <section className="tp-coaching__part" aria-labelledby={ids.sessions}>
          <Heading level={level} id={ids.sessions} className="tp-coaching__h">
            {tr('coaching.web.sessionsTitle')}
          </Heading>
          <ul className="tp-coach-sessions">
            {sessions.map((session) => (
              <Session
                key={session.lesson_id ?? session.course_id}
                coaching={coaching}
                session={session}
                branch={branch}
                locale={locale}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
