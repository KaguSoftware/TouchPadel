import { useCallback } from 'react';
import { useAcceptTerms, useSetAgeBand, useSetBirthDate, useUpdateProfile } from '../profile/hooks';
import { useSetMyGender } from '../matches/hooks';
import { rpcErrorCode } from '../booking/errors';
import { errorMessageOf } from '../../lib/network';
import { captureException } from '../../lib/telemetry';
import { useLocale } from '../../i18n/LocaleProvider';
import { ageBandOf } from '../playProfile/logic';
import { birthDateToLocalDate } from '../profile/birthDate';
import { namePatch } from '../profile/names';
import { getSignUpDraft, resetSignUpDraft } from './signUpDraft';

/**
 * Writes the create-account form onto the account the verified code just made:
 * names, gender, birth date and its age band, the Terms and the language. The
 * form is read once and cleared. Each write is its own try: the account exists
 * by now, and whatever one write misses is asked again where it matters (Edit
 * profile, the gender gate, the Terms screen), never a reason to lose the others.
 */
export function useApplySignUpDraft() {
  const { setLocale } = useLocale();
  const updateProfile = useUpdateProfile();
  const setMyGender = useSetMyGender();
  const setAgeBand = useSetAgeBand();
  const setBirth = useSetBirthDate();
  const acceptTerms = useAcceptTerms();

  return useCallback(async () => {
    const d = getSignUpDraft();
    resetSignUpDraft();
    const step = async (scope: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (err) {
        captureException(err, { scope });
      }
    };
    if (d.firstName.trim()) await step('signUp.names', () => updateProfile.mutateAsync(namePatch(d.firstName, d.lastName)));
    if (d.gender) {
      const gender = d.gender;
      await step('signUp.gender', async () => {
        try {
          await setMyGender.mutateAsync(gender);
        } catch (err) {
          if (rpcErrorCode(errorMessageOf(err)) !== 'GENDER_ALREADY_SET') throw err;
        }
      });
    }
    if (d.birthDate) {
      const birth = d.birthDate;
      await step('signUp.birth', async () => {
        await setBirth.mutateAsync(birth);
        const local = birthDateToLocalDate(birth);
        if (local) await setAgeBand.mutateAsync(ageBandOf(local));
      });
    }
    if (d.agreed) await step('consent.accept', () => acceptTerms.mutateAsync());
    if (d.preferredLang) await step('signUp.lang', () => setLocale(d.preferredLang!));
  }, [updateProfile, setMyGender, setAgeBand, setBirth, acceptTerms, setLocale]);
}
