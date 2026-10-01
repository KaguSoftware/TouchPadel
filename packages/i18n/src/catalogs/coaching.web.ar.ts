import type { DeepMessages } from './ws/types';
import type { coachingWebEn } from './coaching.web.en';
import { coachingGlossary } from './coaching.glossary';

/**
 * `coaching.web` بالعربية. Owned by the web lane; spread into coaching.ar.ts. Mirrors
 * coaching.web.en.ts key-for-key (a missing key fails typecheck).
 *
 * DRAFT-AR: every line here is on the client's review list (docs/design/coaching/guest.md
 * §4.15). The lesson is «حصة» (C-30), never «درس»; the words come from the one glossary
 * (`coachingGlossary`, R55, R72) where it has them. Latin digits through the formatters,
 * `{count}` LTR-isolated by `countPhrase`, verbal nouns on links and buttons, no gendered
 * imperative to the reader (a woman and a man read the same sentence).
 */
const g = coachingGlossary.ar;

export const coachingWebAr: DeepMessages<typeof coachingWebEn> = {
  web: {
    metaTitle: 'تدريب البادل',
    metaDescription: `${g.lessons} خاصة وجماعية ودورات مع مدرّبي تتش بادل في كربلاء. الحجز من التطبيق.`,
    titleOne: 'التدريب',
    titleTwo: 'في تتش',
    intro: `${g.lessons} خاصة وجماعية ودورات مع مدرّبينا. اختيار ${g.theCoach} والوقت من التطبيق.`,
    coachesTitle: 'مدرّبونا',
    typesTitle: `ال${g.lessons}`,
    sessionsTitle: `${g.lessons} قادمة فيها ${g.places}`,
    kind: {
      private: `${g.lessons} خاصة`,
      group: `${g.lessons} جماعية`,
      course: 'دورات',
    },
    privateLine: '{duration} · حتى {people}',
    groupLine: '{duration} · {places}',
    courseLine: `{sessions} · {duration} لكل ${g.session}`,
    from: 'ابتداءً من {price}',
    pricePrivate: `{price} لل${g.session}`,
    pricePlace: `{price} لل${g.place}`,
    priceCourse: `{price} لل${g.course} كاملة`,
    when: '{weekday} {date} · {time}',
    courseStarts: 'تبدأ {date} · {sessions}',
    courseNext: `ال${g.session} التالية {date} · {sessionsLeft}`,
    withCoach: 'مع {coach}',
    bookInApp: 'الحجز من التطبيق',
    getApp: 'تنزيل التطبيق',
    appBody: `حجز ال${g.lessons} من تطبيق تتش بادل.`,
    error: 'تعذّر تحميل المدرّبين. يُرجى المحاولة بعد قليل.',
    landing: {
      body: `${g.lessons} خاصة وجماعية ودورات مع مدرّبينا. الحجز من تطبيق تتش بادل، أو السؤال عبر واتساب.`,
      cta: 'التعرّف على المدرّبين',
      coachesLabel: 'مدرّبونا',
    },
    link: {
      metaTitle: `${g.lessons} مع {name}`,
      title: `حجز ${g.lesson}`,
      eyebrow: `${g.coach} بادل`,
      at: 'في {branches}',
      typesTitle: `ال${g.lessons}`,
      open: 'فتح في التطبيق',
      noApp: 'ليس لديك التطبيق؟',
      allCoaches: 'عرض كل المدرّبين',
      notFound: `الحجز الإلكتروني غير متاح مع هذا ال${g.coach} حاليًا.`,
      error: 'تعذّر تحميل هذه الصفحة. يُرجى المحاولة بعد قليل.',
    },
    count: {
      placesLeft: {
        zero: 'لا أماكن متاحة',
        one: 'مكان واحد متاح',
        two: 'مكانان متاحان',
        few: '{count} أماكن متاحة',
        many: '{count} مكانًا متاحًا',
        other: '{count} مكان متاح',
      },
      places: {
        zero: 'لا أماكن',
        one: 'مكان واحد',
        two: 'مكانان',
        few: '{count} أماكن',
        many: '{count} مكانًا',
        other: '{count} مكان',
      },
      people: {
        zero: 'لا أحد',
        one: 'شخص واحد',
        two: 'شخصان',
        few: '{count} أشخاص',
        many: '{count} شخصًا',
        other: '{count} شخص',
      },
      sessions: {
        zero: 'لا حصص',
        one: 'حصة واحدة',
        two: 'حصتان',
        few: '{count} حصص',
        many: '{count} حصة',
        other: '{count} حصة',
      },
      sessionsLeft: {
        zero: 'لم تبقَ حصص',
        one: 'بقيت حصة واحدة',
        two: 'بقيت حصتان',
        few: 'بقيت {count} حصص',
        many: 'بقيت {count} حصة',
        other: 'بقيت {count} حصة',
      },
      minutes: {
        zero: '{count} دقيقة',
        one: '{count} دقيقة',
        two: '{count} دقيقة',
        few: '{count} دقائق',
        many: '{count} دقيقة',
        other: '{count} دقيقة',
      },
    },
  },
};
