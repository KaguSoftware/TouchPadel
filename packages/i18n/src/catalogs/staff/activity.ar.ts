import type { DeepMessages } from '../ws/types';
import type { staffActivityEn } from './activity.en';

export const staffActivityAr: DeepMessages<typeof staffActivityEn> = {
  title: 'نشاط الموظفين',
  entry: 'نشاط الموظفين',
  entryPreview: 'من يستخدم أي تطبيق، ومتى',
  filter: {
    all: 'الجميع',
    online: 'المتصلون الآن',
  },
  summary: 'المتصلون الآن: {operator} على تطبيق سطح المكتب، و{mobile} على الهاتف',
  surface: {
    operator: 'تطبيق سطح المكتب',
    mobile: 'تطبيق الهاتف',
  },
  status: {
    online: 'متصل',
    away: 'خامل',
    offline: 'غير متصل',
    never: 'لم يُستخدم قط',
  },
  onBreak: 'في استراحة',
  lastSeen: 'آخر ظهور {when}',
  lastAction: 'آخر إجراء: {action}، {when}',
  noAction: 'لا يوجد إجراء مسجّل',
  screen: 'الصفحة {screen}',
  version: 'الإصدار {version}',
  ago: {
    now: 'قبل لحظات',
    minutes: {
      zero: 'قبل لحظات',
      one: 'منذ دقيقة',
      two: 'منذ دقيقتين',
      few: 'منذ {count} دقائق',
      many: 'منذ {count} دقيقة',
      other: 'منذ {count} دقيقة',
    },
    hours: {
      zero: 'قبل لحظات',
      one: 'منذ ساعة',
      two: 'منذ ساعتين',
      few: 'منذ {count} ساعات',
      many: 'منذ {count} ساعة',
      other: 'منذ {count} ساعة',
    },
    days: {
      zero: 'اليوم',
      one: 'منذ يوم',
      two: 'منذ يومين',
      few: 'منذ {count} أيام',
      many: 'منذ {count} يومًا',
      other: 'منذ {count} يوم',
    },
    date: 'في {date}',
  },
  empty: 'لا يوجد موظفون في هذا الفرع.',
  emptyOnline: 'لا أحد متصل الآن.',
  loadFailed: 'تعذّر تحميل النشاط.',
};
