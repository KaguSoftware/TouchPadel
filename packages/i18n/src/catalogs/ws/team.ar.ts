import type { teamEn } from './team.en';
import type { DeepMessages } from './types';

export const teamAr: DeepMessages<typeof teamEn> = {
  tasks: {
    title: 'مهامي',
    empty: {
      title: 'لا شيء مسند إليك بعد',
      body: {
        driver: 'ستظهر هنا المشتريات وقوائم التحقق عندما تُسند إليك.',
        marketing: 'ستظهر هنا مهام التسويق وقوائم التحقق عندما تُسند إليك.',
        other: 'ستظهر هنا المهام وقوائم التحقق عندما تُسند إليك.',
      },
    },
  },
};
