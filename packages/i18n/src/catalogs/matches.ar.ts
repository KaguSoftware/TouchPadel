import type { DeepMessages } from './ws/types';
import type { matchesEn } from './matches.en';
import { matchesCoreAr } from './matches.core.ar';
import { matchesScreensAr } from './matches.screens.ar';
import { matchesBookAr } from './matches.book.ar';
import { matchesWalletAr } from './matches.wallet.ar';
import { matchesWebAr } from './matches.web.ar';

/**
 * `matches.*` بالعربية — المباريات المفتوحة في تطبيق الضيف. Mirrors
 * matches.en.ts key-for-key (a missing key fails typecheck). The lanes'
 * sub-namespaces are spread in from their own file pairs, as in matches.en.ts.
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/open-matches/guest.md §4.22, §4.24), including the word for
 * "ticket".
 */
export const matchesAr: DeepMessages<typeof matchesEn> = {
  ...matchesCoreAr,
  ...matchesScreensAr,
  ...matchesBookAr,
  ...matchesWalletAr,
  ...matchesWebAr,
  errors: {
    genderAlreadySet: 'هذه المعلومة محدَّدة مسبقًا، ويمكن لموظفي الاستقبال تعديلها.',
    // 0259: شراء التذاكر.
    ticketCountInvalid: 'يمكن شراء تذكرة واحدة إلى 3 تذاكر في كل مرة.',
    walletLimit: 'لديك الحد الأقصى من التذاكر غير المستخدمة، ويمكن استخدامها في مباراة أولًا.',
    off: 'المباريات المفتوحة غير متاحة في هذا الفرع حاليًا.',
    termsRequired: 'يلزم قبول الشروط المحدَّثة لاستخدام المباريات المفتوحة.',
    banned: 'المباريات المفتوحة غير متاحة لحسابك. يُرجى التواصل مع النادي.',
    // 0260: نواة المباريات.
    genderRequired: 'للمشاركة في المباريات المفتوحة نحتاج إلى معرفة ذلك مرة واحدة: امرأة أم رجل؟',
    notFound: 'هذه المباراة غير متاحة.',
    needTickets: 'ليست لديك تذاكر كافية لذلك، ويلزم شراء تذاكر للمتابعة.',
    // {tickets} is the nominative `count.tickets`: no verb or adjective that
    // agrees with the reader or the count (§4.24 rule 2).
    needTicketsCount: 'ينقصك {tickets} لذلك.',
    // 0261: طلبات الضيف في المباريات المفتوحة.
    closed: 'لم تعد هذه المباراة تستقبل لاعبين.',
    full: 'اكتمل العدد في هذه المباراة.',
    slotFull: 'في هذا الوقت مباريات مفتوحة بعدد الملاعب المتاحة، ويمكن الانضمام إلى إحداها.',
    tooLate: 'فات وقت بدء مباراة مفتوحة في هذا الموعد. يُرجى اختيار وقت لاحق.',
    tooLateAt: 'تحتاج المباريات المفتوحة إلى وقت أطول قبل البدء. أقرب موعد متاح الآن: {time}.',
    limitReached: 'لديك الحد الأقصى من المباريات المفتوحة التي لم يكتمل عددها بعد.',
    seatLimit: 'يمكن أخذ 3 مقاعد كحد أقصى، والمقعد الأخير دائمًا للاعب آخر.',
    approvalRequired: 'المنظّم يوافق على كل لاعب في هذه المباراة، لذا يلزم إرسال طلب انضمام.',
    notApproval: 'يمكن الانضمام إلى هذه المباراة مباشرة دون طلب.',
    alreadyIn: 'لديك مقعد في هذه المباراة بالفعل.',
    genderMismatch: 'هذه المباراة مخصّصة لفئة أخرى من اللاعبين.',
    unavailable: 'لا يمكن الانضمام إلى هذه المباراة.',
    timeClash: 'لديك مقعد في مباراة مفتوحة أخرى في هذا الوقت.',
    booked: 'حُجز الملعب لهذه المباراة، فلا يمكن إلغاؤها من هنا. يمكنك مغادرتها أو الاتصال بالنادي.',
    notOrganiser: 'هذا الإجراء للمنظّم فقط.',
    requestClosed: 'أُجيب عن هذا الطلب أو سُحب مسبقًا.',
    requesterIneligible: 'لا يمكن قبول هذا الطلب حاليًا، ويمكن رفضه.',
    requestLimit: 'لديك طلبات كثيرة بانتظار الرد. يمكنك سحب أحدها أو انتظار الرد.',
    seatNotFound: 'لم يعد هذا المقعد ضمن المباراة.',
    seatHolderRequired: 'لا يمكن أن تبقى مقاعد أصدقائك من دون مقعدك، ويمكنك مغادرة جميع مقاعدك.',
    seatStarted: 'بدأت المباراة. يُرجى مراجعة الاستقبال.',
    reportTargetInvalid: 'لا يمكن الإبلاغ عن هذا اللاعب من هذه المباراة.',
    blockTargetInvalid: 'لا يمكن حظر هذا اللاعب من هنا.',
    // تجاوز على مستوى الشاشة (§4.22): TERMS_REQUIRED في نسخة قُبلت شروطها الحالية.
    updateApp: 'يلزم تحديث التطبيق لاستخدام المباريات المفتوحة.',
  },
};
