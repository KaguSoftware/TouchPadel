import type { teamEn } from './team.en';
import type { DeepMessages } from './types';

export const teamAr: DeepMessages<typeof teamEn> = {
  tasks: {
    title: 'مهامي',
    empty: {
      title: 'لا شيء مسند إليك بعد',
      body: 'ستظهر هنا المشتريات ومهام التسويق وقوائم التحقق عندما تُسند إليك.',
    },
  },
};
