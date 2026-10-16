import type { activityEn } from './activity.en';
import type { DeepMessages } from './types';

export const activityAr: DeepMessages<typeof activityEn> = {
  title: 'مراقبة النشاط',
  lead: 'من يستخدم برنامج الحاسوب وتطبيق الهاتف الآن، ومتى ظهر كل شخص آخر مرة، وآخر ما فعله.',
  summary: 'المتصلون الآن: {operator} على برنامج الحاسوب، و{mobile} على تطبيق الهاتف.',
  filters: {
    label: 'العرض',
    all: 'الجميع',
    online: 'المتصلون الآن',
    notToday: 'لم يظهروا اليوم',
  },
  columns: {
    person: 'الموظف',
    operator: 'برنامج الحاسوب',
    mobile: 'تطبيق الهاتف',
  },
  status: {
    online: 'متصل',
    away: 'بعيد',
    offline: 'غير متصل',
    signedOut: 'سجّل الخروج',
    never: 'لم يستخدمه قط',
  },
  onBreak: 'في استراحة',
  lastSeen: 'آخر ظهور: {time}',
  lastAction: '{action}، {time}',
  noAction: 'لا إجراءات بعد',
  screen: 'الشاشة: {screen}',
  device: 'الجهاز {device}',
  ago: {
    justNow: 'الآن',
    minutes: {
      zero: 'الآن',
      one: 'منذ دقيقة',
      two: 'منذ دقيقتين',
      few: 'منذ {count} دقائق',
      many: 'منذ {count} دقيقة',
      other: 'منذ {count} دقيقة',
    },
    hours: {
      zero: 'الآن',
      one: 'منذ ساعة',
      two: 'منذ ساعتين',
      few: 'منذ {count} ساعات',
      many: 'منذ {count} ساعة',
      other: 'منذ {count} ساعة',
    },
    days: {
      zero: 'اليوم',
      one: 'أمس',
      two: 'منذ يومين',
      few: 'منذ {count} أيام',
      many: 'منذ {count} يومًا',
      other: 'منذ {count} يوم',
    },
  },
  audit: 'سجل التدقيق',
  auditFor: 'سجل التدقيق: {name}',
  empty: {
    title: 'لا موظفين في هذا الفرع بعد',
    body: 'يظهر الموظفون هنا بعد إضافتهم في صفحة الموظفين.',
  },
};
