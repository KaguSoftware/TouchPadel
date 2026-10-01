import { countPhrase, formatIQD, isolate, makeT, type Locale } from '@touch/i18n';
import {
  LESSON_KINDS,
  coachBio,
  coachFromPrice,
  coachName,
  coachTypes,
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
import { coachLinkPath } from '@/lib/site/coachLink';
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
  const bio = coachBio(coach, locale);
  const types = coachTypes(coaching, coach, venueId);
  const from = coachFromPrice(coaching, coach, venueId);
  return (
    <li className="tp-coach-card" data-coach={coach.id}>
      <CoachPhoto
        coach={coach}
        locale={locale}
        className="tp-coach-card__photo"
        sizes="(min-width: 40rem) 50vw, 100vw"
      />
      <div className="tp-coach-card__body">
        <SubHeading level={level} className="tp-coach-card__name">
          {name}
        </SubHeading>
        {bio ? <p className="tp-coach-card__bio">{bio}</p> : null}
        {types.length > 0 ? (
          <ul className="tp-coach-card__types" aria-label={tr('coaching.web.typesTitle')}>
            {types.map(({ type }) => (
              <li key={type.id}>{localText(locale, type.name_en, type.name_ar)}</li>
            ))}
          </ul>
        ) : null}
        {from !== null ? (
          <p className="tp-coach-card__price tp-num">
            {tr('coaching.web.from', { price: formatIQD(from, locale) })}
          </p>
        ) : null}
        <a
          className="tp-site-btn tp-site-btn--go tp-coach-card__book"
          href={coachLinkPath(locale, coach.id)}
        >
          {tr('coaching.web.bookInApp')}
          <span className="tp-site-sr">{` · ${name}`}</span>
        </a>
      </div>
    </li>
  );
}

function LessonType({ type, locale }: { type: PublicLessonType; locale: Locale }) {
  const description = localText(locale, type.description_en, type.description_ar).trim();
  const price = lessonPrice(type.kind, type.price_iqd, locale);
  return (
    <li className="tp-coach-type" data-type={type.id}>
      <p className="tp-coach-type__name">{localText(locale, type.name_en, type.name_ar)}</p>
      <p className="tp-coach-type__line tp-num">{lessonTypeLine(type, locale)}</p>
      {description ? <p className="tp-coach-type__desc">{description}</p> : null}
      {price ? <p className="tp-coach-type__price tp-num">{price}</p> : null}
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
  const price = sessionPrice(session, type, locale);
  if (!coach || !when) return null;
  return (
    <li>
      {/* The app shows that coach's sessions: the coach's link is the way in (§4.14.2). */}
      <a
        className="tp-coach-session"
        href={coachLinkPath(locale, coach.id)}
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
                      <LessonType key={type.id} type={type} locale={locale} />
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
