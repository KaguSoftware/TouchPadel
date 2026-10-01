import type { DeepMessages } from './ws/types';
import type { siteEn } from './site.en';

/**
 * `site.*` بالعربية — الموقع العام لنادي تتش بادل. Mirrors site.en.ts key-for-key; the
 * `DeepMessages` type fails the typecheck on a missing or extra key. Placeholders keep
 * the SAME names as English.
 *
 * Arabic is written, not translated: natural case (Arabic has no capitals), no letter
 * spacing, and the dual where the count is two ("ملعبان"), which the app's shared
 * `{count} ملاعب` string gets wrong for this venue. The brand name is تتش بادل in running
 * text; the Latin wordmark is artwork, not text. The location is درّة كربلاء (owner,
 * 2026-09-23: "darra karbela").
 *
 * Arabic pass 2026-09-27 (MSA, one voice across the site): verb-first sentences, Arabic
 * punctuation, «» for quoted screen names, tanwin on the letter before the alif (ملعبًا).
 * Fixed words: the venue is النادي, the front desk الاستقبال, the café's menu المنيو (so
 * it never collides with قائمة الموقع, the site's own menu button), booking goes عبر
 * واتساب. The slogan is «اللعبة لمسة واحدة.» (English "It’s all in one touch."): the name
 * says the game comes down to one touch of the ball (site.en.ts). «سماش» stays: it is the
 * word padel players use. The app band's live/hold lines now read better than their store
 * captions (framesAr in apps/mobile/store/frames.mjs); bring those in line at the next
 * store render.
 */
export const siteAr: DeepMessages<typeof siteEn> = {
  skipToContent: 'انتقل إلى المحتوى',
  brandHome: 'تتش بادل، الصفحة الرئيسية',
  nav: {
    label: 'التنقل الرئيسي',
    club: 'النادي',
    lessons: 'الدروس',
    menu: 'منيو الكافيه',
    visit: 'زُرنا',
    book: 'احجز ملعبًا',
    toggle: 'قائمة الموقع',
    language: 'English',
    languageLabel: 'اقرأ هذه الصفحة بالإنجليزية',
  },
  theme: {
    toNight: 'التبديل إلى الوضع الليلي',
    toLight: 'التبديل إلى الوضع الفاتح',
  },
  hours: {
    openNow: 'مفتوح الآن',
    closedNow: 'مغلق الآن',
    opensAt: 'يفتح الساعة {time}',
    everyDay: 'كل يوم',
  },
  // الصيغة حسب قواعد الجمع العربية (Intl.PluralRules): ساعة واحدة، ساعتين، 3–10 ساعات،
  // 11 فما فوق ساعة. «حتى ساعتين قبل الموعد» لا «حتى 2 ساعات». تأتي «ساعتين» مجرورة لأن
  // العبارة تقع دائمًا بعد حرف جر («حتى»، «أقل من»).
  hoursCount: {
    zero: '{count} ساعة',
    one: 'ساعة واحدة',
    two: 'ساعتين',
    few: '{count} ساعات',
    many: '{count} ساعة',
    other: '{count} ساعة',
  },
  onWhatsApp: '، عبر واتساب',
  whatsapp: {
    court: 'مرحبًا تتش بادل، أودّ حجز ملعب.',
    lesson: 'مرحبًا تتش بادل، أودّ حجز درس.',
    events: 'مرحبًا تتش بادل، أودّ التسجيل في البطولة القادمة. هل يمكنكم إرسال التفاصيل إليّ؟',
    eventsNamed:
      'مرحبًا تتش بادل، معكم {name}. أودّ التسجيل في البطولة القادمة. هل يمكنكم إرسال التفاصيل إليّ؟',
    general: 'مرحبًا تتش بادل،',
  },
  hero: {
    lineOne: 'اللعبة',
    lineTwo: 'لمسة واحدة',
    lead: 'نادي بادل وكافيه في درّة كربلاء، يضمّ ملعبين داخليين.',
    ctaWhatsApp: 'احجز عبر واتساب',
    ctaCall: 'اتصل بالاستقبال',
    ctaVisit: 'خطّط لزيارتك',
  },
  club: {
    titleOne: 'كل نقطة',
    titleTwo: 'تحسمها لمسة.',
    body: 'احجز موعدك، واجعل لكل لمسة وزنها.',
    pointIndoor: 'ملعبان داخليان',
    pointRent: 'مضارب وكرات للإيجار في الاستقبال',
    pointLockers: 'خزائن لحفظ أغراضك',
    courtLabel: 'مجسّم ثلاثي الأبعاد لملعب بادل خلف الزجاج، تتبادل فيه أربعة مضارب الكرة.',
    courtCta: 'احجز ملعبًا',
  },
  lessons: {
    titleOne: 'لمستك الأولى؟',
    titleTwo: 'ابدأ من هنا.',
    body: 'نقدّم دروسًا في تتش. راسلنا عبر واتساب بالأوقات التي تناسبك، وسنخبرك بالمتاح منها.',
    cta: 'اسأل عن الدروس',
  },
  events: {
    label: 'العب. سماش. اربح.',
    play: 'العب',
    smash: 'سماش',
    win: 'اربح',
    eyebrow: 'انطلقت البطولات في تتش',
    title: 'اختر شريكك. خذ تذكرتك.',
    body: 'تُقام البطولات والفعاليات الآن في تتش، وقد تحسم لمسة واحدة المباراة النهائية. راسلنا عبر واتساب لتشارك في البطولة القادمة.',
    cta: 'شارك في بطولة',
    ticket: {
      brand: 'تتش بادل',
      admit: 'لثنائي واحد',
      titleOne: 'تذكرة',
      titleTwo: 'بطولة',
      player1: 'اللاعب الأول',
      player2: 'اللاعب الثاني',
      you: 'أنت',
      rival: 'منافسك',
      category: 'الفئة',
      level: 'مستواك',
      venue: 'المكان',
      venueName: 'تتش',
      nameLabel: 'اسمك',
      namePlaceholder: 'اكتبه هنا',
      nameHint: 'سنضيفه إلى رسالتك عبر واتساب.',
      nameLocked: 'وُقِّعت تذكرتك وقُطعت.',
      tear: 'اقطع هنا · أرسلها لتشارك',
    },
  },
  cafe: {
    titleOne: 'قبل المباراة.',
    titleTwo: 'وبعدها.',
    body: 'تتش كافيه جزء من النادي، ولا طابور فيه: على طاولتك رمز، وهاتفك هو المنيو.',
    stepsLabel: 'طريقة الطلب',
    step1Title: 'اختر طاولة',
    step1Body: 'بجانب الملعب أو في الداخل، قبل مباراتك أو بعدها.',
    step2Title: 'امسح الرمز الذي عليها',
    step2Body: 'تفتح كاميرا هاتفك منيو طاولتك، دون الحاجة إلى تثبيت أي تطبيق.',
    step3Title: 'أرسل طلبك بلمسة واحدة',
    step3Body: 'اختر وأرسل ثم عُد إلى مباراتك، فالكافيه يعرف طاولتك.',
    artTable: 'طاولة 4',
    artScan: 'امسح الرمز',
    artBasket: 'صنفان',
    cta: 'افتح المنيو',
  },
  app: {
    titleOne: 'ملعبك على بُعد لمسة.',
    titleTwo: 'قريبًا.',
    liveEyebrow: 'كل المواعيد، كل يوم',
    liveTitle: 'اعرف الأوقات المتاحة قبل أن تنطلق.',
    liveAlt: 'شاشة «الأوقات المتاحة» في التطبيق: أيام الأسبوع وكل وقت لا يزال متاحًا.',
    holdEyebrow: 'لن يسبقك إليه أحد',
    holdTitle: 'نحتفظ لك بالموعد ريثما تقرّر.',
    holdAlt: 'شاشة «المراجعة والتأكيد» في التطبيق: الموعد محجوز لك، والعدّاد التنازلي يعمل.',
    placeEyebrow: 'القادمة · المُلعَبة · الملغاة',
    placeTitle: 'كل مبارياتك في مكان واحد.',
    placeAlt: 'شاشة «حجوزاتي» في التطبيق: المباراة القادمة أولًا، ثم كل الحجوزات القادمة.',
    body: 'وإلى ذلك الحين، احجز عبر واتساب أو اتصل بالاستقبال.',
    downloadOnAppStore: 'حمّله من App Store',
    getItOnGooglePlay: 'احصل عليه من Google Play',
    soon: 'قريبًا',
    appStoreSoon: 'App Store، قريبًا',
    googlePlaySoon: 'Google Play، قريبًا',
  },
  faq: {
    title: 'زيارتك الأولى',
    lead: 'سبعة أسئلة يطرحها الجميع على الاستقبال قبل مباراتهم الأولى.',
    askTitle: 'لديك سؤال آخر؟',
    askCta: 'اسأل الاستقبال',
    bookQ: 'كيف أحجز ملعبًا؟',
    bookA: 'راسلنا عبر واتساب، أو اتصل بالاستقبال، أو تعال مباشرة في ساعات العمل.',
    payQ: 'كيف أدفع؟',
    payA: 'تدفع في الاستقبال عند وصولك. وإذا حجزت عبر التطبيق، فقد يُتاح لك دفع عربون مسبقًا ببطاقة كي كارد.',
    racketQ: 'ليس لديّ مضرب، فهل يمكنني اللعب؟',
    racketA: 'نعم، تتوفّر المضارب والكرات للإيجار في الاستقبال.',
    lockersQ: 'هل يوجد مكان أحفظ فيه أغراضي؟',
    lockersA: 'نعم، في النادي خزائن لحفظ الأغراض.',
    beginnerQ: 'لم ألعب البادل من قبل، فهل في ذلك مشكلة؟',
    beginnerA: 'لا مشكلة إطلاقًا، فكل لاعب بدأ بلمسته الأولى، ونحن نقدّم دروسًا. اسألنا عنها عبر واتساب.',
    cancelQ: 'ماذا أفعل إن احتجت إلى الإلغاء؟',
    cancelA: 'راسل الاستقبال أو اتصل به في أقرب وقت ممكن.',
    hoursQ: 'ما ساعات العمل؟',
    hoursA: 'كل يوم، {hours}.',
    hoursALate: 'كل يوم، {hours}. نبقى مفتوحين إلى ما بعد منتصف الليل.',
    hoursANoHours: 'راسلنا عبر واتساب أو اتصل بالاستقبال لتعرف ساعات العمل اليوم.',
  },
  visit: {
    titleOne: 'تجدنا',
    titleTwo: 'في كربلاء.',
    address: 'درّة كربلاء، كربلاء، العراق',
    addressTitle: 'العنوان',
    maps: 'افتح في خرائط Google',
    hoursTitle: 'ساعات العمل',
    contactTitle: 'تواصل معنا',
    whatsapp: 'واتساب',
    call: 'اتصل بالاستقبال',
    walkIn: 'أو زُرنا مباشرة في ساعات العمل.',
  },
  photos: {
    heroAlt: 'لاعب بادل بملابس سوداء ينحني ليردّ الكرة على ملعب أزرق تحت إضاءة خافتة.',
    clubAlt: 'شبكة ملعب بادل داخلي خالٍ، أرضيته من العشب الصناعي الأزرق، وخلفه جدران من الشبك والزجاج.',
    lessonsAlt: 'لاعبة بادل بقميص داكن تتابع الكرة وهي تستعدّ لضربتها في ملعب داخلي.',
    eventsAlt: 'لاعبا بادل يتصافحان على ملعب أزرق ليلًا.',
  },
  footer: {
    tagline: 'اللعبة لمسة واحدة.',
    hoursTitle: 'ساعات العمل',
    phoneTitle: 'الاستقبال',
    whatsapp: 'واتساب',
    addressTitle: 'عنواننا',
    exploreTitle: 'تتش بادل',
    legalTitle: 'معلومات قانونية',
    lessons: 'الدروس',
    coaching: 'التدريب',
    menu: 'منيو الكافيه',
    support: 'الدعم',
    privacy: 'سياسة الخصوصية',
    terms: 'شروط الخدمة',
    deleteAccount: 'حذف الحساب',
    copyright: '© {year} تتش بادل',
    developedBy: 'من تطوير Kagu',
  },
  notFound: {
    title: 'خارج الملعب',
    body: 'خرجت هذه اللمسة عن الملعب، فالصفحة التي تبحث عنها ليست هنا. عُد إلى البداية أو افتح منيو الكافيه.',
    home: 'العودة إلى تتش بادل',
    menu: 'منيو الكافيه',
  },
  error: {
    title: 'تعذّر تحميل هذه الصفحة.',
    body: 'حدث خلل من جهتنا. حاول مرة أخرى أو عُد إلى الصفحة الرئيسية.',
    retry: 'إعادة المحاولة',
    home: 'العودة إلى تتش بادل',
  },
  // لا تذكر هذه الصفحة نتيجة الدفع أبدًا: لا «دُفع» ولا «نجح» ولا ما يشبههما (راجع site.en.ts).
  payReturn: {
    metaTitle: 'العودة إلى التطبيق',
    title: 'ارجع إلى تطبيق تتش بادل لترى حجزك',
    body: 'في التطبيق آخر مستجدات حجزك. إن لم يُفتح تلقائيًا، فاضغط الزر أدناه.',
    open: 'افتح التطبيق',
    noApp: 'ليس لديك التطبيق؟',
  },
  seo: {
    title: 'تتش بادل · نادي بادل وكافيه في كربلاء',
    description:
      'نادي بادل وكافيه في درّة كربلاء، يضمّ ملعبين داخليين وتتش كافيه، ويقدّم دروسًا. احجز عبر واتساب أو اتصل بالاستقبال أو زُرنا مباشرة.',
    ogAlt: 'تتش بادل. اللعبة لمسة واحدة.',
    menuTitle: 'المنيو · تتش كافيه',
  },
};
