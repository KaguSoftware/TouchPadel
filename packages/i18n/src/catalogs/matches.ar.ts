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
    genderAlreadySet: 'هذه المعلومة محدَّدة مسبقًا. يمكن لموظفي الاستقبال تعديلها.',
    // 0259: شراء التذاكر.
    ticketCountInvalid: 'يمكنك شراء ما بين تذكرة واحدة و3 تذاكر في كل مرة.',
    walletLimit: 'لديك الحد الأقصى من التذاكر غير المستخدمة. يمكنك شراء المزيد بعد استخدامها في مباراة.',
    off: 'المباريات المفتوحة غير متاحة في هذا الفرع حاليًا.',
    termsRequired: 'نحتاج إلى موافقتك على الشروط المحدَّثة لاستخدام المباريات المفتوحة.',
    banned: 'المباريات المفتوحة غير متاحة لحسابك. يُرجى التواصل مع النادي.',
    // 0260: نواة المباريات.
    genderRequired: 'نسأل مرة واحدة فقط: امرأة أم رجل؟ بعض المباريات والأوقات مخصصة للنساء أو للرجال.',
    notFound: 'هذه المباراة غير متاحة.',
    needTickets: 'ليست لديك تذاكر كافية. يمكنك شراء تذاكر للمتابعة.',
    // {tickets} is the nominative `count.tickets`: no verb or adjective that
    // agrees with the reader or the count (§4.24 rule 2).
    needTicketsCount: 'ينقصك {tickets} للمتابعة.',
    // 0261: طلبات الضيف في المباريات المفتوحة.
    closed: 'لم تعد هذه المباراة تستقبل لاعبين.',
    full: 'اكتمل العدد في هذه المباراة.',
    slotFull: 'كل الملاعب المتاحة في هذا الوقت لها مباريات مفتوحة. يمكنك الانضمام إلى إحداها.',
    tooLate: 'فات أوان بدء مباراة مفتوحة في هذا الموعد. يمكنك اختيار وقت لاحق.',
    tooLateAt: 'تحتاج المباريات المفتوحة إلى وقت أطول قبل البدء. أقرب موعد متاح الآن: {time}.',
    limitReached: 'لديك الحد الأقصى من المباريات المفتوحة التي لم يكتمل عددها بعد.',
    seatLimit: 'يمكن أخذ 3 مقاعد على الأكثر. المقعد الأخير دائمًا للاعب آخر.',
    approvalRequired: 'ينضم اللاعبون إلى هذه المباراة بموافقة المنظّم. يمكنك إرسال طلب انضمام.',
    notApproval: 'يمكن الانضمام إلى هذه المباراة مباشرة دون طلب.',
    alreadyIn: 'لديك مقعد في هذه المباراة بالفعل.',
    genderMismatch: 'هذه المباراة مخصّصة لفئة أخرى من اللاعبين.',
    unavailable: 'لا يمكن الانضمام إلى هذه المباراة.',
    timeClash: 'لديك مقعد في مباراة مفتوحة أخرى في هذا الوقت.',
    booked: 'حُجز الملعب لهذه المباراة، فلا يمكن إلغاؤها من هنا. يمكنك مغادرتها أو الاتصال بالنادي.',
    notOrganiser: 'هذا الإجراء للمنظّم فقط.',
    requestClosed: 'سبق الرد على هذا الطلب أو سحبه.',
    requesterIneligible: 'لا يمكن قبول هذا الطلب حاليًا. يمكنك رفضه.',
    requestLimit: 'لديك طلبات كثيرة بانتظار الرد. يمكنك سحب أحدها أو انتظار الرد.',
    seatNotFound: 'لم يعد هذا المقعد ضمن المباراة.',
    seatHolderRequired: 'لا يمكن أن تبقى مقاعد أصدقائك من دون مقعدك. يمكنك مغادرة جميع مقاعدك.',
    seatStarted: 'بدأت المباراة. يُرجى مراجعة الاستقبال.',
    reportTargetInvalid: 'لا يمكن الإبلاغ عن هذا اللاعب من هذه المباراة.',
    blockTargetInvalid: 'لا يمكن حظر هذا اللاعب من هنا.',
    // تجاوز على مستوى الشاشة (§4.22): TERMS_REQUIRED في نسخة قُبلت شروطها الحالية.
    updateApp: 'يُرجى تحديث التطبيق لاستخدام المباريات المفتوحة.',
  },
};
