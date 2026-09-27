/**
 * Qi's hosted payment page, in the system's in-app browser (plan §5.2).
 *
 * `openBrowserAsync`, NOT `openAuthSessionAsync`: the auth session shows iOS's
 * "Touch Padel wants to use qi.iq to sign in" alert, which is the wrong words
 * for a payment. SFSafariViewController (iOS) and a Custom Tab (Android) both
 * hand a `touchpadel://` redirect straight to the app, and app/pay/return.tsx
 * closes the sheet itself.
 *
 * NOTHING IS INFERRED FROM HOW THE SHEET CLOSED. `cancel` means the guest
 * closed it, which they may do one second after the bank approved; the status
 * screen underneath simply asks the server again.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { captureException } from '../../lib/telemetry';

/**
 * Open the payment page. Resolves when the sheet is gone (iOS) or open
 * (Android). Falls back to the system browser if the in-app one cannot be
 * shown; never throws, because the status screen is already there with an
 * "Open payment page again" of its own.
 */
export async function openPaymentPage(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      dismissButtonStyle: 'close',
      enableBarCollapsing: false,
      showTitle: true,
      // Android: the Custom Tab joins the app's own task, so the return
      // intent brings the app forward over it and closes it (there is no
      // dismissBrowser on Android). Verify on a device (plan §10 checklist).
      createTask: false,
    });
  } catch (error) {
    // "Another WebBrowser is already being presented" (a double tap) is not a
    // failure worth a second window.
    const message = error instanceof Error ? error.message : String(error); // QUIET-ERROR-OK: only matched against a regex to skip a double tap, never rendered
    if (/already being presented/i.test(message)) return;
    captureException(error, { scope: 'deposit.openBrowser' });
    try {
      await Linking.openURL(url);
    } catch (fallbackError) {
      captureException(fallbackError, { scope: 'deposit.openBrowser.fallback' });
    }
  }
}

/**
 * Close the payment sheet when the return link arrives. iOS only: Android's
 * Custom Tab has no such call (the module leaves it undefined, and some
 * versions throw), and the intent that opened the app already put it on top.
 */
export async function dismissPaymentPage(): Promise<void> {
  try {
    await WebBrowser.dismissBrowser?.();
  } catch {
    // Nothing was open, or this platform cannot dismiss it: either way the app is in front.
  }
}
