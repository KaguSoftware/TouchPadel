/**
 * Per-question router (owner assistant, cost lane H): an easy question stops
 * running on the most expensive setting.
 *
 * Until now every chat message ran on claude-opus-5-5 with adaptive thinking
 * at effort 'medium', including "where is day close?". A LOOKUP (where a page,
 * button or setting is, how to do something in the app, what a feature, rule
 * or setting means) is answered from the system map through search /
 * page_lookup and needs no business figure, so it runs on LOOKUP_MODEL at
 * effort 'low' with the map retrieved up front. Everything else is ANALYSIS:
 * the chat's own default model (model: null) at effort 'medium'.
 *
 * 2026-10-09: ANALYSIS is split by how hard it is (see DEEP_REASONS): advice,
 * a plan, why and long asks stay on the chat's default at medium; comparisons,
 * trends and "what happened" run on LOOKUP_MODEL at medium; plain figure
 * questions run on LOOKUP_MODEL at low. The owner's own model pick still wins.
 *
 * Conservative by construction: a question is a lookup only when a positive
 * lookup pattern matches AND no figure signal (how much / how many, a time
 * period, a comparison, a ranking, a trend, who / why / what happened, advice,
 * any digit) is present. When unsure, ANALYSIS.
 *
 * Precedence, per sentence:
 *   0. a chat whose scopes are only 'howto' and/or 'docs' is a lookup: no data
 *      tool is on, so there is nothing for the dearer setting to read;
 *   1. advice phrased as a location ("where can I save money", "where do you
 *      think we should cut costs") -> analysis;
 *   2. a strong navigation ask by "I" (where can I find / see / open / set ...,
 *      where to ..., show me where, وين / أين + an ا- verb) -> lookup, even when
 *      the sentence also names a figure ("أين أرى كم كلّف المساعد هذا الشهر":
 *      the owner is asking where the page is). "We", "you" and "one", and any
 *      other verb, are not strong: a hard signal beats them;
 *   3. any hard figure signal (how much / many, a period, a number, a
 *      comparison, a trend, why / who / what happened, advice including growth
 *      how-tos such as "how can we attract more players") -> analysis;
 *   4. a growth verb next to a money noun ("how do I increase revenue") -> analysis;
 *   5. "where is the ... page" ending on a page noun -> lookup (loses to 3);
 *   6. a how-to / can-I / "can you" + configuration verb / where-we-do-X /
 *      meaning pattern -> lookup, unless a money noun (revenue, sales, cash ...)
 *      is also named for the weak patterns: the how-to, can-I and meaning
 *      patterns still win over a bare money noun ("how do I see sales"), the
 *      weak where / navigate patterns do not ("where is revenue coming from").
 *      "Can you show me the sales" is a data request, not a how-to;
 *   7. otherwise analysis.
 * A message is split into sentences and on "and what / and how much ..."
 * conjunctions; one analysis part makes the whole message analysis. Only a
 * bare greeting or thanks is ignored; any other short leftover ("any refunds")
 * counts as a question.
 *
 * English plus Arabic in MSA and Iraqi dialect. Arabic is normalised first
 * (alef forms, ة/ه, ى/ي, diacritics, tatweel, Persian/Iraqi letter forms,
 * Arabic-Indic digits). "Day close" (اغلاق اليوم, close the day) is masked
 * before the time signals run, or "اليوم" would read as "today".
 *
 * Pure: no imports, no Deno or Node API; loads under vitest and Deno. The
 * chat lane calls routeTurn(); this file never touches the model or the db.
 */

export type TurnKind = 'lookup' | 'analysis';

/** The cheaper model a lookup turn runs on (owner rule 0307/0312: opus-5-5 and sonnet-5-5 only). */
export const LOOKUP_MODEL = 'claude-sonnet-5-5';

export interface TurnRoute {
  kind: TurnKind;
  /** The model for this turn; null = the chat's own default. */
  model: string | null;
  effort: 'low' | 'medium';
  /**
   * A cheap-tier route (lookup, or a plain figure question on Sonnet): inside
   * the 5-minute cache window it keeps the previous turn's model and effort
   * instead of re-writing the cached prefix (turnPolicy keepWarmRoute). A deep
   * analysis is never sticky: its model is a quality call.
   */
  sticky?: boolean;
  /** Retrieve the system map before the first model call. */
  preRetrieve: boolean;
  /** Short machine-readable cause, e.g. 'where-pattern', 'money-signal', 'scopes-howto-only'. */
  reason: string;
}

/** A question longer than this many words is never a lookup. */
const MAX_LOOKUP_WORDS = 40;

const HOWTO_SCOPES: ReadonlySet<string> = new Set(['howto', 'docs']);

// ---------------------------------------------------------------- normalise

/** Lower-case, fold the Arabic letter variants, drop diacritics, map digits to ASCII. */
function normalizeText(raw: string): string {
  let s = raw.normalize('NFKC').toLowerCase();
  s = s.replace(/[ً-ٰٟـۖ-ۭ]/g, '');
  s = s.replace(/[أإآٱ]/g, 'ا'); // أ إ آ ٱ -> ا
  s = s.replace(/ة/g, 'ه'); // ة -> ه
  s = s.replace(/[ىی]/g, 'ي'); // ى ی -> ي
  s = s.replace(/ؤ/g, 'و'); // ؤ -> و
  s = s.replace(/ئ/g, 'ي'); // ئ -> ي
  s = s.replace(/[کگچ]/g, 'ك'); // ک گ چ -> ك (Iraqi "چم" = كم)
  s = s.replace(/پ/g, 'ب'); // پ -> ب
  s = s.replace(/ڤ/g, 'ف'); // ڤ -> ف
  s = s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  s = s.replace(/[‘’ʼ]/g, "'");
  return s;
}

/** One sentence as space-padded word tokens, so Arabic patterns can anchor on whitespace. */
function pad(sentence: string): string {
  const words = sentence
    .replace(/[^\p{L}\p{N}%'\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return ` ${words.join(' ')} `;
}

/** "Day close" must not read as the time word "today" / "اليوم". */
function maskDayClose(p: string): string {
  return p
    .replace(
      /\b(?:day[- ]?close|close(?: out)?(?: the| a| my| our)?(?: trading)? day|end[- ]of[- ]day|day[- ]?end|eod)\b/g,
      ' dayclose ',
    )
    .replace(/ ((?:و|ل|ب|ف)?(?:اغلاق|اقفال|قفل|تقفيل|تسكير|اغلق|اقفل|اسكر|نغلق|نقفل)) (?:ال)?يوم(?:ي|نا)? /g, ' $1 dayclose ')
    .replace(/\s+/g, ' ');
}

// ------------------------------------------------------------ pattern kit

/** An Arabic word (or alternation) with the common clitics around it, on padded text. */
function ar(alts: string): RegExp {
  return new RegExp(`(?<=\\s)(?:و|ف|ب|ل|ك)?(?:ال)?(?:${alts})(?:نا|ي|ه|ها|هم|ك|كم|ات|ين|ون)?(?=\\s)`);
}

type Signal = readonly [reason: string, re: RegExp];

/** Hard signals: a figure, a period, a comparison, a cause, a person, advice. Any one forces analysis. */
const HARD: readonly Signal[] = [
  // how much / how many
  ['figure-signal', /\bhow (?:much|many|often)\b/],
  ['figure-signal', /\b(?:number of|count of|amount of|sum of|total|totals|average|avg|median|percent|percentage|ratio|occupancy|utili[sz]ation|kpis?|stats|statistics|numbers|figures|metrics)\b/],
  ['figure-signal', ar('كم|كام|شكد|اشكد|شكثر|قديش|بكم|بكام|عدد|مجموع|اجمالي|معدل|متوسط|نسبه|احصائيات|احصائيه|ارقام')],
  ['figure-signal', /\bhow (?:do|can|could|would) (?:i|we) (?:know|tell|find out|figure out|check) (?:if|whether|which|who|what|when|how|why)\b/],
  ['figure-signal', /\bby (?:day|week|month|year|hour|court|item|product|staff|category|player|customer|coach|branch)\b/],
  // time periods
  ['time-signal', /\b(?:today|todays|tonight|yesterday|tomorrow|so far|ytd|mtd|ago|currently|right now|at the moment|latest|recent|recently)\b/],
  ['time-signal', /\b(?:this|last|past|previous|next|every|each|per) (?:morning|evening|afternoon|night|day|week|weekend|month|year|quarter)s?\b/],
  ['time-signal', /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december|jan|feb|apr|jun|jul|aug|sept?|oct|nov|dec)\b/],
  ['time-signal', ar('امس|البارحه|بارحه|غدا|بكره|اليوم|هاليوم|هذا اليوم|الليله|هاليله|الان|حاليا|مؤخرا|اخيرا|الاخير|الاخيره|الماضي|الماضيه|الفايت|الفايته|السابق|السابقه|القادم|القادمه|الجاي|الجايه')],
  ['time-signal', /(?<=\s)(?:و|ف|ب|ل|ك)?(?:ها|هذا|هذه|هاي|هادا)? ?(?:ال)?(?:اسبوع|شهر|سنه|عام|ربع|اسابيع|اشهر|شهور|سنوات|اعوام)(?:ي|يا|ين|ان)?(?=\s)/],
  ['time-signal', ar('الاحد|الاثنين|الاتنين|الثلاثاء|الاربعاء|الخميس|الجمعه|السبت|كانون|شباط|اذار|نيسان|ايار|حزيران|تموز|ايلول|تشرين|يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر')],
  ['time-signal', /(?<=\s)(?:هال|ها)(?:اسبوع|شهر|سنه|يوم)(?=\s)/],
  // any digit
  ['number-signal', /\d/],
  // comparisons, rankings
  ['compare-signal', /\b(?:compare|compared|comparison|versus|vs|than|top|best|worst|highest|lowest|most|least|biggest|smallest|busiest|slowest|fastest|popular|leading|rank|ranking|ranked|bottom|better|worse)\b/],
  ['compare-signal', ar('قارن|مقارنه|مقابل|بالمقارنه|اكثر|اقل|الاكثر|الاقل|اعلي|اعلا|ادني|افضل|اسوا|اسوء|اكبر|اصغر|ترتيب|اشهر|اغلي|ارخص|اغلب')],
  // trends
  ['trend-signal', /\b(?:trend|trends|trending|growth|grew|grow|growing|decline|declined|declining|drop|dropped|dropping|fell|fall|falling|spike|spiked|dip|dipped|surge|slump|lost|loss|losses|losing)\b/],
  ['trend-signal', ar('اتجاه|نمو|تراجع|انخفاض|انخفض|ارتفاع|ارتفع|زياده|زاد|نقص|هبوط|هبط|نزل|نزول|خسر|خسارات|خسائر|خساره|ضيع|ذروه')],
  // why, who, what happened
  ['why-signal', /\b(?:why|how come|reason for|reasons for|cause of|causes of)\b/],
  ['why-signal', ar('ليش|لماذا|ليه|علاما|سبب|اسباب')],
  ['who-signal', /\b(?:who|whom|whose)\b/],
  ['who-signal', ar('مين|منو|منهو')],
  ['who-signal', /^ (?:و)?من /],
  ['event-signal', /\b(?:what happened|what's happening|what is happening|what's going on|what is going on|how are we doing|how's business|how is business|how did we do|how did|did we|did the|did anyone|has anyone|have we|have any|were there|was there|which (?:customers?|players?|staff|employees?|waiters?|courts?|items?|products?|days?|hours?|coach(?:es)?|cashiers?|members?|bookings?|orders?|tabs?))\b/],
  ['event-signal', /(?<=\s)(?:ماذا|شنو|شو|ايش|وش) (?:حدث|صار|يحدث|يصير)(?=\s)|(?<=\s)(?:شصار|حدث|هل تم|هل تمت|هل كان|هل كانت|كيف حال|كيف كانت|كيف كان|كيف الاداء|كيف الوضع|شلون الوضع|شلون الاداء|شلون كانت|شلون كان)(?=\s)/],
  // advice
  ['advice-signal', /\b(?:should i|should we|what should|recommend|recommendation|suggest|suggestion|advice|advise|ideas?|opportunit(?:y|ies)|improve|optimi[sz]e|strategy|worth it|better to|what do you think|your opinion|make money|more money|more customers|more bookings|cut costs|save money|reduce costs|increase (?:our |the |my )?(?:revenue|sales|profit|income|bookings|occupancy|business|numbers|footfall))\b/],
  ['advice-signal', /(?<=\s)(?:شنو|ماذا|شو|ايش|وش) (?:اسوي|افعل|اعمل|الافضل|ينبغي|تنصح|تقترح|لازم اسوي|نسوي|نفعل|نعمل)(?=\s)|(?<=\s)(?:هل يجب|هل الافضل|هل ينبغي|هل يستاهل|يستاهل|انصحني|ننصح|نصيحه|نصائح|اقتراح|اقترح|افكار|فكره|تحسين|احسن|اطور|اوفر|اقلل|ازيد|اربح|اكسب|ارباح اكثر|نزيد|نربح|نكسب|نحسن|نطور|نوفر|نقلل|نكبر|نوسع|نشجع|نجيب|نجذب|نرجع|نملي|نبيع|نزود|نرفع|نخفض|اجيب|اجذب|ارجع|املي|ابيع|ازود|ارفع|اخفض)(?=\s)/],
  // growth asked as a how-to: "how can we attract more players", "how do we fill empty courts"
  ['advice-signal', /\bhow (?:do|can|could|would|should|might) (?:i|we|you|one) (?:attract|fill|grow|retain|encourage|persuade|convince|motivate|win|boost|drive|expand|upsell|sell|bring (?:back|in|more|people|players|customers|guests|them)|get (?:more|new|players|customers|guests|people|members|clients|them)|keep (?:players|customers|guests|people|members|clients|them))\b/],
  // money nouns are soft: see SOFT
];

/** Soft signal: a money noun alone. Forces analysis unless a how-to / can-I / meaning pattern also matched. */
const SOFT: RegExp[] = [
  /\b(?:revenues?|sales|profits?|income|earnings?|takings|turnover|margins?|money|cash|expenses?|costs?|spend|spent|paid|owe|owed|debts?|balances?|payroll|takings)\b/,
  ar('مبيعات|مبيع|مبيعه|ارباح|ربح|ايراد|ايرادات|دخل|مدخول|فلوس|مصاري|مبلغ|مبالغ|نقد|نقدي|نقديه|كاش|مصروف|مصاريف|مصروفات|تكلف|تكلفه|تكاليف|ذمم|ديون|دين|رصيد|ماليه|مالي'),
];

// ------------------------------------------------------- lookup patterns

/** Arabic first-person verb stems (I find / I add / I change ...), Iraqi continuous forms included. */
const AR_STEMS =
  String.raw`(?:سجل|ضيف|ضبط|غير|ري|جد|شوف|عدل|سوي|طلع|عرف|ضغط|روح|دخل|فتح|غلق|قفل|نشئ|كتب|حذف|ضع|ختار|ختر|حفظ|رسل|طبع|صدر|ستعرض|عرض|تحكم|تابع|راجع|راقب|قدر|كدر|شاهد|بحث|حدد|فعل|عطل|وقف|ظهر|لغي|حول|بدل|دير|رتب|حرر|نسخ|صفي|خرج|ستخرج|حمل|ستعمل|ستخدم|وصل|ربط|عين|وزع|وافق|قبل|رفض|عمل|دفع|حجز|خلق|بدا|نهي|تحقق|ضيف|اضاف|ظبط)\S*`;
/** "I" forms only (ا-): the owner asking where HE goes. The "we" forms (ن-) are an ask for advice as often as for a page. */
const AR_VERB_I = String.raw`ا${AR_STEMS}|(?:الاقي|القي)\S*`;
/** "I" and "we" forms. */
const AR_VERB = String.raw`(?:ا|ن)${AR_STEMS}|(?:الاقي|القي)\S*`;
/** Arabic verbal nouns an owner asks "how can I ..." about (تغيير سعر, تعديل ...). */
const AR_MASDAR = String.raw`(?:تغيير|تغير|تعديل|تفعيل|تعطيل|تسجيل|تحديث|تصدير|تحويل|تحديد|تبديل|تثبيت|تنزيل|تحميل|تعيين|تكوين|تقديم|توزيع|ترتيب|تصفيه|تحرير|تعطيل)\S*`;
const AR_FILL = String.raw`(?:(?:ممكن|بالضبط|لو|سمحت|هسه|الان|اقدر|اكدر|يمكنني|استطيع|يمكن|نقدر|نكدر|لازم|احتاج|اريد) )*`;
const AR_PAGE = String.raw`(?:ال)?(?:صفحه|شاشه|زر|قسم|تبويب|خيار|اعداد|اعدادات|قائمه|قايمه|رابط|تقرير|خانه|مكان|واجهه|لوحه|نافذه|ازرار|اقسام|صفحات|شاشات|سجل|خاصيه|ميزه|ضبط|ازاحه)(?:ها|ه|ات)?`;

const EN_PAGE_NOUN = String.raw`(?:page|screen|button|settings?|tab|menu|section|option|toggle|link|report|dashboard|panel|form|list|view|log|route|feature)`;

const AI_NOT_STAND = String.raw`(?! (?:stand|lose|lost|spend|waste|make|earn|save|cut|invest))`;

/** Advice phrased as a location: still analysis. Checked before navigation. */
const ADVICE_FIRST: readonly RegExp[] = [
  /\bwhere (?:can|could|should|do|would) (?:i|we) (?:save|cut|improve|grow|increase|boost|make|earn|reduce|lose|spend|invest|stand)\b/,
  /\bwhere (?:am i|are we) (?:losing|wasting|overspending|leaking)\b/,
  /\bwhere (?:do|would|should|can|could) (?:you|we|i) (?:think|expect|reckon|believe|suggest|recommend|guess|imagine)\b/,
  /\bwhere\b.{0,40}\b(?:should|ought to|need to) (?:we|i) (?:cut|save|invest|spend|focus|put|allocate|improve|grow|reduce)\b/,
  new RegExp(String.raw`(?<=\s)(?:وين|اين|فين) (?:(?:اقدر|اكدر|ممكن) )*(?:اوفر|اقلل|اربح|اخسر|اصرف|احسن|اطور|ازيد|اكسب|استثمر|نخسر|نصرف)\S*(?=\s)`),
];

/** Verbs a location ask is about: where do I FIND / SEE / OPEN / CHANGE ... */
const EN_NAV_VERB = String.raw`(?:find|see|view|check|look at|open|access|reach|go to|get to|manage|set|change|edit|add|enable|disable|configure|customi[sz]e|create|record|log|register|update|assign|schedule|reset|export|print|download|upload|import|switch|turn|rename|delete|remove|cancel|approve|decline|reject|refund|void|close|start|stop|send|book|apply|attach|link|connect|invite|hide|merge|split|move|select|choose|pause|resume|override|block|unblock|activate|deactivate)`;

/** A strong navigation ask by "I": wins over hard and soft signals. The "we", "you" and "one" forms, and any other verb, are in WHERE_MIXED / WEAK. */
const NAV_STRONG: readonly RegExp[] = [
  new RegExp(String.raw`\bwhere (?:can|do|could|would|might|will) i ${EN_NAV_VERB}\b`),
  /\bwhere to (?:find|see|view|check|look|open|go|set|change|edit|add|enable|disable|configure|create|record|log|register|update|assign|export|print|download|upload|import|switch|turn|manage|access)\b/,
  /\bshow me where (?:i|to|we)\b/,
  new RegExp(String.raw`(?<=\s)(?:وين|اين|فين|منين|واين|ووين) ${AR_FILL}(?:${AR_VERB_I})(?=\s)`),
];

/** A page named as the thing asked for ("where is the day close page"): loses to a hard signal, beats a money noun. */
const NAV_PAGE: readonly RegExp[] = [
  new RegExp(String.raw`\bwhere(?:'s| is| are) (?:the |my |our |a |an )?(?:[\w'-]+ ){0,3}${EN_PAGE_NOUN}s?\s*$`),
  new RegExp(String.raw`(?<=\s)(?:وين|اين|فين|منين|واين|ووين) ${AR_FILL}${AR_PAGE}(?=\s)`),
];

/** "where do we / you / one ..." and any "where can I ..." verb: loses to a hard signal, beats a money noun when the verb is a navigation verb. */
const WHERE_MIXED = new RegExp(String.raw`\bwhere (?:can|do|could|would|might|will) (?:i|we|you|one) ${EN_NAV_VERB}\b`);
const WHERE_ANY_VERB = new RegExp(String.raw`\bwhere (?:can|do|could|would|might|will) (?:i|we|you|one)\b${AI_NOT_STAND}(?! (?:think|expect|reckon|believe|suggest|recommend|say|guess|imagine))`);

/** how-to / can-I / meaning: win over a bare money noun, lose to every hard signal. */
const HOWTO: readonly (readonly [string, RegExp])[] = [
  ['how-pattern', /\bhow (?:do|can|could|would|should|might) (?:i|we|you|one)\b/],
  ['where-pattern', WHERE_MIXED],
  // "where do we add ..." (ن-): navigation when the verb is an app verb, advice otherwise (the advice list is checked first)
  ['where-pattern', new RegExp(String.raw`(?<=\s)(?:وين|اين|فين|منين|واين|ووين) ${AR_FILL}(?:${AR_VERB})(?=\s)`)],
  ['how-pattern', /\bhow to\b/],
  ['how-pattern', /\bhow (?:does|do|is|are) (?:the |this |that |a |an |my |our )?[\w' -]{1,40}? (?:work|works|calculated|computed|determined|set|configured|used|applied|counted|shown|displayed)\b/],
  ['how-pattern', new RegExp(String.raw`(?<=\s)(?:كيف|شلون|ازاي|كيفيه) ${AR_FILL}(?:${AR_VERB}|${AR_MASDAR}|ا(?!ل)(?!(?:ايراد|ايام|اسعار|ارباح|اجمالي|افضل|اكثر|اقل|اعلي|اسوا|اخر|اول|احد|اغلب|اشكد|اذا|اداء|انواع|اسماء)\S*)\S{2,})(?=\s)`)],
  ['how-pattern', /(?<=\s)(?:كيف|شلون) (?:يعمل|تعمل|يشتغل|تشتغل|يتم|تتم|يحسب|تحسب|يحتسب|تحتسب|يضبط|تضبط|تنضبط|ينضبط)(?=\s)/],
  ['can-pattern', /\b(?:can|could) (?:i|we) (?:change|set|edit|add|remove|delete|create|enable|disable|turn|configure|customi[sz]e|rename|export|print|assign|schedule|reset|undo|cancel|merge|split|move|hide|show|find|see|switch|select|choose|upload|import|link|connect|invite|deactivate|activate|block|unblock|pause|resume|override|approve|decline|reject|refund|void|close|open|start|stop|send|record|log|register|book|apply|attach)\b/],
  // "can you ..." asks the assistant to do something: only a configuration verb is a how-to ("can you show me the sales" is a data request)
  ['can-pattern', /\b(?:can|could) you (?:change|set|edit|add|remove|delete|create|enable|disable|configure|customi[sz]e|rename|export|assign|schedule|reset|undo|merge|split|hide|switch|upload|import|link|connect|invite|deactivate|activate|block|unblock|pause|resume|override|approve|decline|reject|void|apply|attach)\b/],
  ['can-pattern', /\b(?:is there|are there) (?:a|an|any) (?:way|page|button|setting|option|screen|report|tab|menu|shortcut)\b/],
  ['can-pattern', new RegExp(String.raw`(?<=\s)هل (?:يمكنني|اقدر|اكدر|استطيع|بالامكان|ممكن) ${AR_FILL}(?:${AR_VERB}|${AR_MASDAR})(?=\s)`)],
  ['can-pattern', /\b(?:which|what) (?:page|screen|menu|tab|section|setting|button|option|route|link|report)\b/],
  ['meaning-pattern', /\bwhat (?:does|do|is|are)\b.{0,60}\b(?:mean|means|stand for)\b/],
  ['meaning-pattern', /\bwhat does (?:the |this |that |a )?(?:[\w'-]+ ){1,4}(?:do|control|affect|change|allow|mean)\b/],
  ['meaning-pattern', /\bwhat(?:'s| is| are) (?:the |a |an )?(?:[\w'-]+ ){0,3}(?:setting|rule|toggle|option|feature|role|permission|policy|limit|threshold)s?\b/],
  ['meaning-pattern', /\b(?:definition of|explain (?:the|what|how|this|that))\b/],
  ['meaning-pattern', /(?<=\s)(?:شنو|ايش|شو|وش|ماذا|ما) (?:يعني|معني|يقصد|المقصود)(?=\s)|(?<=\s)يعني (?:شنو|ايش|شو|وش|ماذا)(?=\s)|(?<=\s)(?:ما|شنو|ايش) (?:هو |هي )?(?:ال)?(?:معني|مقصود|فرق|وظيفه|فايده|فائده)(?=\s)/],
  ['meaning-pattern', /(?<=\s)(?:اشرح|وضح|اشرحلي|وضحلي)(?=\s)/],
];

/** Weak location asks: lose to a hard signal AND to a money noun. */
const WEAK: readonly (readonly [string, RegExp])[] = [
  ['where-pattern', WHERE_ANY_VERB],
  ['where-pattern', /(?<=\s)(?:وين|اين|فين|منين|واين|ووين) (?:\S+ ){0,2}dayclose $/],
  ['where-pattern', /\bwhere(?: is|'s| are) (?:the |my |our |a |an )?[\w'-]+(?: [\w'-]+){0,3}\s*$/],
  ['where-pattern', new RegExp(String.raw`(?<=\s)(?:وين|اين|فين|منين|واين|ووين) (?:ال)\S+(?: \S+){0,3} $`)],
  ['navigate-pattern', new RegExp(String.raw`\b(?:take me to|go to|navigate to|bring me to|open|link me to|link to|point me to|direct me to)\b.{0,50}?\b${EN_PAGE_NOUN}\b`)],
];

// ---------------------------------------------------------------- engine

/** Verbs of getting more or less of a money figure; with a money noun they are advice. */
const GROWTH_VERB = new RegExp(
  String.raw`\b(?:increase|boost|grow|raise|improve|maximi[sz]e|reduce|lower|decrease|cut|minimi[sz]e|double|triple)\b|` +
    String.raw`(?<=\s)(?:ا|ن)(?:زيد|زود|رفع|خفض|قلل|وفر|حسن|طور|كبر|وسع|ضاعف)(?=\s)`,
);

/** Words of a greeting or thanks: a short part made only of these is neutral, not a question. */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'hi', 'hello', 'hey', 'thanks', 'thank', 'you', 'thx', 'ok', 'okay', 'please', 'sure', 'yes', 'no', 'good', 'morning', 'evening', 'great', 'cool', 'got', 'it',
  'شكرا', 'شكرن', 'مرحبا', 'هلا', 'هلو', 'اهلا', 'السلام', 'عليكم', 'سلام', 'تمام', 'اوكي', 'ok', 'يعطيك', 'العافيه', 'لو', 'سمحت', 'من', 'فضلك', 'ممتاز', 'حلو', 'زين', 'صباح', 'الخير', 'مساء', 'النور',
]);

type Part = { kind: TurnKind | 'neutral'; reason: string };

function classifyPart(padded: string): Part {
  const wordCount = padded.trim().length === 0 ? 0 : padded.trim().split(' ').length;
  if (wordCount === 0) return { kind: 'neutral', reason: 'empty' };
  if (wordCount > MAX_LOOKUP_WORDS) return { kind: 'analysis', reason: 'long-question' };

  for (const re of ADVICE_FIRST) if (re.test(padded)) return { kind: 'analysis', reason: 'advice-signal' };

  for (const re of NAV_STRONG) if (re.test(padded)) return { kind: 'lookup', reason: 'where-pattern' };

  // Every hard signal that matches, so the tier follows the hardest one: "why did revenue drop last week" is a why (deep), not just a period.
  let hard: string | null = null;
  for (const [reason, re] of HARD) if (re.test(padded) && (hard === null || analysisRank(reason) > analysisRank(hard))) hard = reason;
  if (hard !== null) return { kind: 'analysis', reason: hard };

  const soft = SOFT.some((re) => re.test(padded));
  // "how do I increase revenue": a growth verb next to a money noun is advice, not a how-to.
  if (soft && GROWTH_VERB.test(padded)) return { kind: 'analysis', reason: 'advice-signal' };

  for (const re of NAV_PAGE) if (re.test(padded)) return { kind: 'lookup', reason: 'where-pattern' };

  for (const [reason, re] of HOWTO) if (re.test(padded)) return { kind: 'lookup', reason };

  if (!soft) for (const [reason, re] of WEAK) if (re.test(padded)) return { kind: 'lookup', reason };

  if (soft) return { kind: 'analysis', reason: 'money-signal' };
  // Only a bare greeting or thanks next to a real question is neutral; any other short leftover ("any refunds") is a question.
  if (wordCount <= 3 && padded.trim().split(' ').every((w) => FILLER_WORDS.has(w))) return { kind: 'neutral', reason: 'short' };
  return { kind: 'analysis', reason: 'no-lookup-pattern' };
}

/** Split a message into the questions it asks (sentences, then "and what / and how much ..."). */
function splitParts(normalized: string): string[] {
  const out: string[] = [];
  for (const sentence of normalized.split(/[.!?؟\n;]+/)) {
    if (sentence.trim().length === 0) continue;
    const padded = pad(sentence);
    const pieces = padded.split(
      /\s+(?:and|also|then|plus|but)\s+(?=(?:how|what|where|who|why|which|when|did|does|do|is|are|can|should)\b)|\s+(?:(?:ثم|بعدين|وبعدين|كمان|وكمان)\s*|و\s*)(?=(?:كم|شكد|شنو|ليش|مين|منو|كيف|شلون|اين|وين|ماذا|لماذا)\s)/,
    );
    const merged: string[] = [];
    for (const piece of pieces) {
      if (piece === undefined) continue;
      const t = piece.trim();
      if (t.length === 0) continue;
      // "what and why": a one- or two-word tail is the same question, not a second one.
      if (merged.length > 0 && t.split(' ').length < 3) merged[merged.length - 1] += ` ${t}`;
      else merged.push(t);
    }
    for (const t of merged) out.push(` ${t} `);
  }
  return out;
}

/**
 * How hard an analysis is (owner call 2026-10-09: the bill was dominated by
 * Opus on every message). DEEP is judgement: advice, a plan, why something
 * happened, a long multi-part ask. These run on the chat's default model at
 * effort medium. MEDIUM is reading several numbers against each other
 * (compare, trend). Everything else is a plain figure question
 * (how much, a period, a number, who, a money noun): one or two aggregate
 * tools and a sentence, which Sonnet at effort low answers as well as Opus.
 * When unsure, MEDIUM on Sonnet, never DEEP by default.
 */
const DEEP_REASONS: ReadonlySet<string> = new Set(['advice-signal', 'why-signal', 'long-question', 'empty']);
const MEDIUM_REASONS: ReadonlySet<string> = new Set(['compare-signal', 'trend-signal', 'no-lookup-pattern']);

function analysisRank(reason: string): number {
  return DEEP_REASONS.has(reason) ? 2 : MEDIUM_REASONS.has(reason) ? 1 : 0;
}

function analysis(reason: string, explicitModel: string | null = null): TurnRoute {
  if (analysisRank(reason) === 2) return { kind: 'analysis', model: null, effort: 'medium', preRetrieve: false, reason };
  const model = explicitModel !== null && explicitModel.length > 0 ? explicitModel : LOOKUP_MODEL;
  return { kind: 'analysis', model, effort: analysisRank(reason) === 1 ? 'medium' : 'low', sticky: true, preRetrieve: false, reason };
}

function lookup(explicitModel: string | null, reason: string): TurnRoute {
  const model = explicitModel !== null && explicitModel.length > 0 ? explicitModel : LOOKUP_MODEL;
  return { kind: 'lookup', model, effort: 'low', sticky: true, preRetrieve: true, reason };
}

/**
 * Route one chat message. `scopes` are the chat's active context scopes,
 * `explicitModel` the model the owner picked for this chat (null = none): a
 * lookup keeps the owner's pick, an analysis always defers to the chat default.
 */
export function routeTurn(input: { text: string; scopes: readonly string[]; explicitModel: string | null }): TurnRoute {
  if (input.scopes.length > 0 && input.scopes.every((s) => HOWTO_SCOPES.has(s))) {
    return lookup(input.explicitModel, 'scopes-howto-only');
  }
  const text = typeof input.text === 'string' ? input.text : '';
  if (text.trim().length === 0) return analysis('empty', input.explicitModel);

  const parts = splitParts(normalizeText(text)).map((p) => classifyPart(maskDayClose(p)));
  // One analysis part makes the whole message analysis, and the hardest part sets the tier.
  const bad = parts.filter((p) => p.kind === 'analysis').sort((a, b) => analysisRank(b.reason) - analysisRank(a.reason))[0];
  if (bad) return analysis(bad.reason, input.explicitModel);
  const good = parts.find((p) => p.kind === 'lookup');
  if (good) return lookup(input.explicitModel, good.reason);
  return analysis('no-lookup-pattern', input.explicitModel);
}
