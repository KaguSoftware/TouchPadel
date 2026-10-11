import type { rewardsEn } from './rewards.en';
import type { DeepMessages } from './types';

export const rewardsAr: DeepMessages<typeof rewardsEn> = {
  title: 'المكافآت',
  lead: 'حدّد مكافأة مالية أو جائزة لعدد من الطلبات المسجّلة في الشهر. لا يرى كل شخص على هاتفه إلا تقدّمه هو. وتُضاف المكافأة المالية إلى راتبه في الشهر الذي يلي بلوغها.',
  links: {
    wages: 'الرواتب',
  },
  count: {
    orders: {
      zero: 'لا طلبات',
      one: 'طلب واحد',
      two: 'طلبان',
      few: '{count} طلبات',
      many: '{count} طلبًا',
      other: '{count} طلب',
    },
    daysLeft: {
      zero: 'آخر يوم',
      one: 'آخر يوم',
      two: 'بقي يومان',
      few: 'بقيت {count} أيام',
      many: 'بقي {count} يومًا',
      other: 'بقي {count} يوم',
    },
  },
  cols: {
    person: 'الشخص',
    thisMonth: 'هذا الشهر',
    lastMonth: 'الشهر الماضي',
    rewards: 'المكافآت',
  },
  reward: {
    at: 'عند {orders}',
    reached: 'تحققت',
    toGo: 'بقي {orders}',
    none: 'لا مكافآت محدّدة.',
    limit: 'لكل شخص {max} مكافآت على الأكثر: أزل واحدة لتضيف أخرى.',
  },
  actions: {
    add: 'إضافة مكافأة',
    remove: 'إزالة',
    removeFor: 'إزالة مكافأة {name} عند {orders}',
  },
  form: {
    title: 'إضافة مكافأة لـ {name}',
    target: 'عدد الطلبات في الشهر',
    targetHint: 'من 1 إلى 100,000.',
    bonus: 'المكافأة المالية',
    bonusHint: 'حتى 10,000,000. اتركها فارغة إن كانت المكافأة جائزة فقط.',
    prize: 'الجائزة',
    prizeHint: 'حتى {max} حرفًا، مثل عشاء لشخصين.',
    needOne: 'أدخل مكافأة مالية أو جائزة أو كليهما.',
    save: 'حفظ المكافأة',
    saved: 'حُفظت المكافأة.',
    issue: {
      target: 'أدخل عدد طلبات من 1 إلى 100,000.',
      bonus: 'أدخل مبلغًا لا يتجاوز 10,000,000.',
      prize: 'لا تتجاوز {max} حرفًا.',
    },
  },
  remove: {
    title: 'إزالة هذه المكافأة؟',
    body: 'لن يرى {name} المكافأة عند {orders} بعد الآن. لكن هذا الشهر ما زال يُحتسب: إن بلغها قبل نهاية الشهر فهي من حقه.',
    confirm: 'إزالة المكافأة',
    keep: 'إبقاؤها',
    done: 'أُزيلت المكافأة.',
  },
  empty: {
    title: 'لا أحد في هذا الفرع يمكن مكافأته',
    body: 'يظهر هنا النُّدُل والكاشيرية والمديرون العاملون حاليًا في هذا الفرع.',
  },
};
