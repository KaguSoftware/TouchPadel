import type { DeepMessages } from './ws/types';
import type { workEn } from './work.en';

/**
 * `work.*` بالعربية. Mirrors work.en.ts key-for-key; the `DeepMessages` type
 * fails the typecheck on a missing or extra key.
 */
export const workAr: DeepMessages<typeof workEn> = {
  protocol: {
    kind: {
      product_release: 'صنف جديد',
      tournament: 'بطولة',
      hiring: 'توظيف',
      price_promo: 'تغيير سعر أو عرض',
    },
    variant: {
      type1: 'النوع 1',
      type2: 'النوع 2 (مجتمعي)',
      type3: 'النوع 3 (راعٍ أو عميل)',
    },
    runStatus: {
      active: 'قيد التنفيذ',
      scheduled: 'مجدول',
      live: 'أُطلق',
      done: 'منتهٍ',
      stopped: 'متوقف',
      withdrawn: 'مسحوب',
    },
    stepStatus: {
      waiting: 'لم يُفتح بعد',
      open: 'للتنفيذ',
      submitted: 'بانتظار القرار',
      passed: 'تم',
      skipped: 'تم تخطّيه',
      stopped: 'متوقف',
    },
    decision: {
      approve: 'موافَق عليه',
      auto: 'مرّ تلقائيًا',
      send_back: 'أُعيد للتعديل',
      stop: 'أُوقف',
    },
    action: {
      start: 'ابدأ',
      submit: 'أرسل',
      withdraw: 'اسحب',
      approve: 'موافقة',
      sendBack: 'أعده للتعديل',
      stop: 'أوقف',
      skip: 'تخطَّ',
      launchNow: 'أطلقه الآن',
      launchOnDate: 'أطلقه في تاريخ محدد',
      applyNow: 'طبّقه الآن',
      applyOnDate: 'طبّقه في تاريخ محدد',
      cancelSchedule: 'ألغِ التاريخ',
    },
    needsOwnerOk: 'يحتاج موافقة المالك',
    optional: 'اختياري',
    round: 'الجولة {round}',
    autoPassed: 'مرّ تلقائيًا: أرسله شخص يقرّر في هذه الخطوة.',
    involved: 'يشملك',
    noteDeleted: 'حُذفت الملاحظة بعد 90 يومًا',
    change: {
      price: 'تغيير أسعار صنف',
      shop_launch: 'طرح منتج من المتجر للبيع',
      addon_price: 'تغيير أسعار الإضافات',
      promotion: 'اقتراح عرض',
      promotion_edit: 'تغيير عرض',
      promotion_enable: 'تشغيل عرض',
      rate: 'تغيير سعر ملعب أو إضافته',
      featured_discount: 'تغيير خصم الصنف المميز',
    },
  },
  checklist: {
    slot: {
      open: 'الافتتاح',
      close: 'الإغلاق',
    },
  },
  shopping: {
    status: {
      open: 'للشراء',
      bought: 'تم شراؤه',
      cancelled: 'أُلغي',
      received: 'استُلم',
      acknowledged: 'تم التحقق',
    },
  },
  purchase: {
    status: {
      to_receive: 'بانتظار الاستلام',
      done: 'تم',
      received: 'استُلم',
      acknowledged: 'تم التحقق',
    },
  },
  item: {
    kind: {
      drink: 'مشروب',
      dessert: 'حلوى',
      food: 'طعام',
    },
  },
};
