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
      type3: 'النوع 3 (راعٍ أو زبون)',
    },
    runStatus: {
      active: 'قيد التنفيذ',
      scheduled: 'مجدول',
      live: 'أُطلق',
      done: 'مكتمل',
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
      start: 'بدء',
      submit: 'إرسال',
      withdraw: 'سحب',
      approve: 'موافقة',
      sendBack: 'إعادة للتعديل',
      stop: 'إيقاف',
      skip: 'تخطّي',
      launchNow: 'إطلاق الآن',
      launchOnDate: 'إطلاق في تاريخ محدد',
      applyNow: 'تطبيق الآن',
      applyOnDate: 'تطبيق في تاريخ محدد',
      cancelSchedule: 'إلغاء التاريخ',
    },
    needsOwnerOk: 'يحتاج موافقة المالك',
    optional: 'اختياري',
    round: 'الجولة {round}',
    autoPassed: 'مرّ تلقائيًا: أرسله من يملك قرار هذه الخطوة.',
    involved: 'لك دور فيه',
    noteDeleted: 'حُذفت الملاحظة بعد 90 يومًا',
    change: {
      price: 'تغيير أسعار الأصناف',
      shop_launch: 'طرح منتج من المتجر للبيع',
      addon_price: 'تغيير أسعار الإضافات',
      promotion: 'اقتراح عرض',
      promotion_edit: 'تعديل عرض',
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
      bought: 'اشتُري',
      cancelled: 'أُلغي',
      received: 'استُلم',
      acknowledged: 'تم التحقق',
      pending: 'بانتظار رئيس الطهاة',
      declined: 'مرفوض',
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
  marketingRequest: {
    status: {
      open: 'بانتظار التسويق',
      done: 'تم',
      declined: 'مرفوض',
      withdrawn: 'مسحوب',
    },
  },
  recipeChange: {
    status: {
      waiting: 'بانتظار المالك',
      approved: 'موافَق عليه',
      declined: 'مرفوض',
      withdrawn: 'مسحوب',
    },
  },
  idea: {
    status: {
      waiting: 'بانتظار المراجعة',
      started: 'بدأ تنفيذها كصنف جديد',
      declined: 'مرفوضة',
      withdrawn: 'مسحوبة',
    },
  },
  team: {
    bar: 'البار',
    kitchen: 'المطبخ',
  },
  store: {
    cafe: 'مخزن الكافيه',
    bakery: 'مخزن المخبز',
    shop: 'مخزن المتجر',
  },
  deduction: {
    status: {
      waiting: 'بانتظار القرار',
      approved: 'موافَق عليه',
      declined: 'مرفوض',
      withdrawn: 'مسحوب',
      cancelled: 'ملغى',
    },
  },
  incident: {
    kind: {
      accident: 'حادث',
      injury: 'إصابة',
      fight: 'شجار',
      damage: 'ضرر',
      other: 'أخرى',
    },
    place: {
      court: 'الملعب',
      cafe: 'الكافيه',
      shop: 'المتجر',
      outside: 'خارج المكان',
      other: 'مكان آخر',
    },
    status: {
      open: 'مفتوح',
      reviewed: 'تمت المراجعة',
    },
  },
  content: {
    status: {
      waiting: 'بانتظار الموافقة',
      changes: 'طُلبت تعديلات',
      approved: 'موافَق عليه',
      declined: 'مرفوض',
      withdrawn: 'مسحوب',
    },
    decision: {
      approve: 'موافقة',
      changes: 'طلب تعديلات',
      decline: 'رفض',
    },
    channel: {
      instagram: 'إنستغرام',
      tiktok: 'تيك توك',
      facebook: 'فيسبوك',
      snapchat: 'سناب شات',
      whatsapp: 'واتساب',
      telegram: 'تيليغرام',
      guest_site: 'موقع الضيوف',
      in_venue: 'داخل المكان',
      print: 'مطبوعات',
      other: 'أخرى',
    },
  },
};
