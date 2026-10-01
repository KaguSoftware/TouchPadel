import type { DeepMessages } from '../ws/types';
import type { staffCallsEn } from './calls.en';

export const staffCallsAr: DeepMessages<typeof staffCallsEn> = {
  title: 'نداءات الضيوف',
  rowCount: 'نداءات الضيوف · {count}',
  group: 'في الصالة',
  lead: 'يرى الصندوق هذه النداءات أيضًا. أول من يردّ يتولّى النداء.',
  listTitle: 'النداءات المفتوحة',
  mine: 'أنت في الطريق',
  other: 'شخص آخر في الطريق',
  old: 'أقدم من ساعتين',
  emptyTitle: 'لا أحد ينتظر',
  emptyBody: 'عندما تنادي طاولة نادلًا، يظهر النداء هنا ويهتز هاتفك.',
  answered: 'سبق أن ردّ شخص آخر على هذا النداء.',
  notLive: 'لا تتحدّث القائمة تلقائيًا الآن. اسحب للأسفل للتحديث.',
  age: {
    minutes: '{minutes} د',
    hours: '{hours} س {minutes} د',
    days: '{days} يوم {hours} س',
  },
};
