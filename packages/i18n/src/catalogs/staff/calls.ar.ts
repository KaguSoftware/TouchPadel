import type { DeepMessages } from '../ws/types';
import type { staffCallsEn } from './calls.en';

export const staffCallsAr: DeepMessages<typeof staffCallsEn> = {
  title: 'نداءات الزبائن',
  rowCount: 'نداءات الزبائن · {count}',
  group: 'في الصالة',
  lead: 'يرى الصندوق هذه النداءات أيضًا. من يرد أولًا يتولّى النداء.',
  listTitle: 'النداءات المفتوحة',
  mine: 'أنت في الطريق',
  other: 'شخص آخر في الطريق',
  old: 'أقدم من ساعتين',
  emptyTitle: 'لا أحد ينتظر',
  emptyBody: 'عندما تنادي طاولة على نادل، يظهر النداء هنا ويهتز هاتفك.',
  answered: 'ردّ شخص آخر على هذا النداء بالفعل.',
  notLive: 'لا تتحدّث القائمة تلقائيًا الآن. اسحب للأسفل للتحديث.',
  age: {
    minutes: '{minutes} د',
    hours: '{hours} س {minutes} د',
    days: '{days} ي {hours} س',
  },
};
