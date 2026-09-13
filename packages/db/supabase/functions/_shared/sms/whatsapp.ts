/**
 * Meta WhatsApp Cloud API adapter — the OFFICIAL API, no reseller (owner
 * decision 2026-09-13: "fully Meta official API", replacing OTPIQ).
 *
 * Contract (developers.facebook.com, Cloud API "messages" + authentication
 * templates, checked 2026-09-13; Graph API v26.0 current since 2026-07-29):
 *   POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages
 *   Authorization: Bearer <system-user access token>
 *   { messaging_product: "whatsapp", recipient_type: "individual",
 *     to: "9647701234567",                       // digits, no '+'
 *     type: "template",
 *     template: { name, language: { code },
 *       components: [
 *         { type: "body",   parameters: [{ type: "text", text: "<code>" }] },
 *         { type: "button", sub_type: "url", index: "0",
 *                           parameters: [{ type: "text", text: "<code>" }] } ] } }
 *   200 -> { messaging_product, contacts: [{ input, wa_id }], messages: [{ id: "wamid.…", message_status? }] }
 *   4xx -> { error: { message, type, code, error_subcode?, error_data?: { details }, fbtrace_id } }
 *     190      token expired / invalid            (401)
 *     130429 / 131056 / 80007  throughput, per-recipient pace, WABA rate  (429)
 *     131026   recipient cannot receive (no WhatsApp, old app)           (400)
 *     132001 / 132015 / 132016  template unapproved, paused, disabled    (400)
 *
 * The TEXT is Meta's, not ours: an AUTHENTICATION-category template has a
 * fixed body ("<code> is your verification code." plus optional security and
 * expiry lines) and a copy-code button; both take the code as their single
 * parameter. One template NAME, created once per language (en, ar) in
 * WhatsApp Manager; the language is chosen per send from the guest's
 * preferred_lang when the caller knows it (SmsSendArgs.lang), else the
 * configured default. `body` (our bilingual SMS text) is ignored.
 *
 * No SMS fallback exists on this adapter: a number with no WhatsApp fails with
 * 131026 and the guest must use email. Cost is not reported by the API
 * (billed per message on the Meta invoice), so costIqd is undefined.
 *
 * Secrets: WHATSAPP_ACCESS_TOKEN (permanent System User token),
 * WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME (default "touch_otp");
 * optional WHATSAPP_TEMPLATE_LANG_EN / _AR (default "en" / "ar" — must equal
 * the template's language code in WhatsApp Manager, e.g. "en_US"),
 * WHATSAPP_DEFAULT_LANG (default "ar"), WHATSAPP_GRAPH_VERSION (default "v26.0").
 */
import { SmsProviderError, type SmsLang, type SmsProvider, type SmsSendArgs, type SmsSendResult } from './types.ts';

export const WHATSAPP_GRAPH_BASE = 'https://graph.facebook.com';
export const WHATSAPP_DEFAULT_GRAPH_VERSION = 'v26.0';

export interface WhatsappEnv {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  /** Template language code per app language; defaults to the language itself. */
  langCodes?: Partial<Record<SmsLang, string>>;
  defaultLang?: SmsLang;
  graphVersion?: string;
}

export function whatsappProvider(env: WhatsappEnv): SmsProvider {
  const version = env.graphVersion?.trim() || WHATSAPP_DEFAULT_GRAPH_VERSION;
  const defaultLang: SmsLang = env.defaultLang ?? 'ar';
  const codeFor = (lang: SmsLang) => env.langCodes?.[lang]?.trim() || lang;
  return {
    name: 'whatsapp',
    async send(args: SmsSendArgs): Promise<SmsSendResult> {
      const lang = args.lang ?? defaultLang;
      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: args.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: env.templateName,
          language: { code: codeFor(lang) },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: args.code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: args.code }] },
          ],
        },
      };
      const res = await fetch(`${WHATSAPP_GRAPH_BASE}/${version}/${encodeURIComponent(env.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
      };
      if (!res.ok) {
        const e = data.error ?? {};
        const code = e.code !== undefined ? `${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}` : 'no code';
        throw new SmsProviderError('whatsapp', `whatsapp ${res.status} (${code}): ${e.error_data?.details ?? e.message ?? 'send failed'}`, res.status);
      }
      return { id: data.messages?.[0]?.id, channel: 'whatsapp' };
    },
  };
}
