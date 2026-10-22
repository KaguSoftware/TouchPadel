import type { DeepMessages } from './ws/types';
import type { matchesWalletEn } from './matches.wallet.en';

/**
 * `matches.{tickets, pay, reservations}` بالعربية. Owned by the mobile wallet
 * and account lane; spread into matches.ar.ts. Mirrors matches.wallet.en.ts
 * key-for-key (a missing key fails typecheck).
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/open-matches/guest.md §4.24, R38), including the word for
 * "ticket": Latin digits through the formatters (money through `formatIQD`),
 * verbal nouns on buttons, no gendered imperative to the reader.
 *
 * Text addressed to the reader reads the same for a woman or a man: passives
 * (أُضيفت، أُرسل), «يمكن / يلزم + noun», and object suffixes (ينقصك) that the
 * unvocalised script writes alike. `{tickets}` is the subject of those verbs,
 * so it is the nominative `count.tickets` (تذكرتان), never `ticketsGen`.
 */
export const matchesWalletAr: DeepMessages<typeof matchesWalletEn> = {
  tickets: {
    title: 'تذاكر المباريات المفتوحة',
    sandbox: 'تذاكر تجريبية',
    pending: 'عملية دفع جارية',
    pendingContinue: 'متابعة',
    needJoin: 'للانضمام إلى هذه المباراة ينقصك {tickets}.',
    needRequest: 'لطلب الانضمام إلى هذه المباراة ينقصك {tickets}.',
    needStart: 'لبدء هذه المباراة ينقصك {tickets}.',
    buyTitle: 'شراء تذاكر',
    priceLine: '{count} × {price} = {total}',
    buy: 'الدفع عبر Qi Card',
    buyNote:
      'يُدفع ثمن التذاكر إلكترونيًا عبر Qi Card. التذكرة ليست حصتك من سعر الملعب، وتُدفع حصتك عند الاستقبال.',
    tooManyAttempts: 'محاولات دفع كثيرة اليوم. يمكن المحاولة مجددًا غدًا.',
    rulesTitle: 'كيف تعمل التذاكر',
    rule1: 'تذكرة واحدة لكل مقعد، ومقاعد أصدقائك تُحسب من تذاكرك.',
    rule2: 'عند الانضمام تُستخدم تذكرة، وتعود إلى محفظتك بعد اللعب.',
    rule3: 'طلب الانضمام يحجز التذكرة إلى أن يردّ المنظّم.',
    rule4: 'إذا أُلغيت المباراة أو لم يكتمل عددها، تعود تذاكرك.',
    rule5:
      'إذا غادرت قبل حجز الملعب، تعود التذكرة. وإذا غادرت بعد الحجز، تبقى التذكرة محجوزة حتى يأخذ لاعب آخر مقعدك. وإن لم يأخذه أحد قبل البدء، تُفقد التذكرة.',
    rule6: 'الغياب يُفقدك التذكرة. والتذاكر لا تنتهي صلاحيتها.',
    rule7: 'تبقى حصتك من سعر الملعب مستحقة عند الاستقبال.',
    historyTitle: 'تذاكرك',
    rowHeld: 'محجوزة لطلب انضمام · {when}',
    rowInMatch: 'في مباراة · {when}',
    rowLost: 'فُقدت · {date}',
    rowRefunded: 'رُدّ ثمنها إلى بطاقتك · {date}',
    cashOut:
      'لاسترداد ثمن التذاكر غير المستخدمة، يمكن مراجعة الاستقبال. يردّ المدير المبلغ إلى البطاقة التي دُفع بها. ويكون ذلك لكل عملية شراء على حدة، بعد أن تخرج كل تذاكرها من المباريات.',
    walletLine: 'التذاكر · {ready}',
  },
  pay: {
    summaryTitle: 'تذاكر المباريات المفتوحة',
    summaryCount: '× {count}',
    ticketsBoughtTitle: 'أُضيفت التذاكر',
    ticketsBoughtBody: 'أُضيفت {tickets} إلى محفظتك.',
    joining: 'جارٍ الانضمام إلى المباراة…',
    requesting: 'جارٍ إرسال طلبك…',
    starting: 'جارٍ بدء مباراتك…',
    viewTickets: 'عرض تذاكري',
    backToMatch: 'العودة إلى المباراة',
    continueStart: 'بدء المباراة',
    joined: 'لك مقعد في المباراة',
    requestSent: 'أُرسل الطلب',
    started: 'فُتحت مباراتك. مشاركة الرابط تساعد على اكتمال العدد.',
    ticketsKept: 'تذاكرك في محفظتك.',
    ticketRefundPending:
      'لم يكتمل الدفع كما يجب، لذا يُعاد المبلغ إلى بطاقتك. لم تُضف أي تذاكر.',
    expiredBody: 'لم يُقتطع أي مبلغ.',
    failedNoAttempts: 'انتهت محاولات الدفع المسموحة لشراء التذاكر اليوم. يمكن المحاولة مجددًا غدًا.',
    leaveBody:
      'إذا اكتمل الدفع، ستُضاف تذاكرك وتظهر في «تذاكر المباريات المفتوحة».',
    stillCheckingBody:
      'يستغرق الأمر وقتًا أطول من المعتاد. سيصلك إشعار فور ردّ البنك. إذا اكتمل الدفع، فتذاكرك محفوظة.',
  },
  reservations: {
    openMatches: 'المباريات المفتوحة',
    viewMatch: 'عرض المباراة',
  },
};
