import { useEffect, useState } from 'react';
import { RESEND_COOLDOWN_S } from './phoneOtp';

/**
 * The resend button's countdown (verify-email's pattern): a code was just
 * sent, so it starts running on mount when `startNow`, and `restart` runs it
 * again after each resend. It ticks only while running.
 */
export function useResendCooldown(startNow = true) {
  const [cooldownEnd, setCooldownEnd] = useState(() => (startNow ? Date.now() + RESEND_COOLDOWN_S * 1000 : 0));
  const [secondsLeft, setSecondsLeft] = useState(startNow ? RESEND_COOLDOWN_S : 0);

  useEffect(() => {
    if (cooldownEnd === 0) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setCooldownEnd(0);
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [cooldownEnd]);

  const restart = () => {
    setCooldownEnd(Date.now() + RESEND_COOLDOWN_S * 1000);
    setSecondsLeft(RESEND_COOLDOWN_S);
  };

  return { secondsLeft, coolingDown: secondsLeft > 0, restart };
}
