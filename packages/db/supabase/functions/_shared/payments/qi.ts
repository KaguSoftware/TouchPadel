/**
 * Qi Card payment gateway adapter — the only file that knows Qi's URLs,
 * headers and field names (plan §2; developers-gate.qi.iq v2.0.4, checked
 * 2026-09-27, and the public sandbox probed the same day).
 *
 *   POST /payment                              create → formUrl (hosted page)
 *   GET  /payment/{paymentId}/status           the authoritative state
 *   GET  /payment/status/by/request/{requestId} recovery when create timed out
 *   POST /payment/{paymentId}/cancel           our window ended, still unpaid
 *   POST /payment/{paymentId}/refund           every refund
 *
 * Auth: `Authorization: Basic base64(user:pass)` + `X-Terminal-Id`, and an
 * `X-Signature` on each call when the terminal uses signature-based auth
 * (only when a signing key is configured).
 *
 * What the sandbox showed that the docs do not say (2026-09-27):
 *   - a reused requestId answers 403 {"error":{"code":5,"description":
 *     "RequestId … was already used."}}, not code 1 or 10;
 *   - "not found" is 403 with code 12;
 *   - the status object carries no formUrl; the create response's formUrl is
 *     `${base}/payment/${paymentId}`, so a recovered payment gets that;
 *   - a cancelled payment keeps status CREATED and says canceled: true;
 *   - amounts come back as 20000.000 (a JSON number: 20000).
 */
import { redactGatewayMessage } from './redact.ts';
import {
  PaymentProviderError,
  type CreatePaymentArgs,
  type GatewayPayment,
  type GatewayRefund,
  type PaymentErrorKind,
  type PaymentProvider,
  type RefundArgs,
} from './types.ts';
import { requestSignedString, signQiRequest } from './verify.ts';

export const QI_SANDBOX_BASE_URL = 'https://uat-sandbox-3ds-api.qi.iq/api/v1';

export interface QiConfig {
  /** e.g. https://uat-sandbox-3ds-api.qi.iq/api/v1 (no trailing slash needed). */
  baseUrl: string;
  terminalId: string;
  username: string;
  password: string;
  /** Our RSA private key (PEM), only for a terminal on signature-based auth. */
  signingKeyPem?: string | null;
  timeoutMs?: number;
  /** Label for logs and errors: 'qi' or 'qi-sandbox'. */
  label?: string;
}

const QI_LOCALE: Record<'en' | 'ar', string> = { en: 'en_US', ar: 'ar_IQ' };

/** Qi's error codes, by what we do about them (plan §2, error codes page). */
export function kindForQiCode(code: number | undefined, description: string, httpStatus: number): PaymentErrorKind {
  if (code === 1 || code === 10 || (code === 5 && /already used/i.test(description))) return 'already_used';
  if (code === 2 || code === 12) return 'not_found';
  if (code === 9 || code === 27) return 'config';
  if (code === 20 || code === 23 || code === 24) return 'transport';
  if (code !== undefined) return 'refused';
  if (httpStatus === 401) return 'config';
  return httpStatus >= 500 ? 'transport' : 'refused';
}

/** E.164 "+9647…" → "009647…", the shape Qi's examples use. */
export function qiPhone(e164: string | null | undefined): string | undefined {
  if (!e164) return undefined;
  const digits = e164.replace(/[^\d+]/g, '');
  if (!digits) return undefined;
  return digits.startsWith('+') ? `00${digits.slice(1)}` : digits;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function qiProvider(cfg: QiConfig): PaymentProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const label = cfg.label ?? 'qi';
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  const auth = `Basic ${btoa(`${cfg.username}:${cfg.password}`)}`;

  function toPayment(body: Record<string, unknown>): GatewayPayment {
    const paymentId = str(body.paymentId);
    if (!paymentId) throw new PaymentProviderError(label, 'transport', 'answer without paymentId');
    return {
      requestId: str(body.requestId),
      paymentId,
      status: str(body.status) ?? '',
      canceled: body.canceled === true,
      amount: num(body.confirmedAmount) ?? num(body.amount),
      currency: str(body.currency),
      formUrl: str(body.formUrl) ?? `${base}/payment/${paymentId}`,
      creationDate: str(body.creationDate),
      raw: redactGatewayMessage(body),
    };
  }

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | null,
    signParts: Array<string | number | boolean | null | undefined>,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: auth,
      'X-Terminal-Id': cfg.terminalId,
      Accept: 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';
    if (cfg.signingKeyPem) {
      headers['X-Signature'] = await signQiRequest(cfg.signingKeyPem, requestSignedString([cfg.terminalId, ...signParts]));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (error) {
      const why = error instanceof Error && error.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(error);
      throw new PaymentProviderError(label, 'transport', `${method} ${path}: ${why}`);
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown = null;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
    const err = (typeof obj.error === 'object' && obj.error !== null ? obj.error : null) as
      | { code?: unknown; description?: unknown }
      | null;
    if (res.ok && !err) return obj;

    const code = typeof err?.code === 'number' ? err.code : undefined;
    const description = typeof err?.description === 'string' ? err.description : text.slice(0, 200);
    throw new PaymentProviderError(
      label,
      kindForQiCode(code, description, res.status),
      `${method} ${path} → ${res.status}${code !== undefined ? ` code ${code}` : ''}: ${description}`,
      code,
      res.status,
    );
  }

  return {
    name: 'qi',

    async create(args: CreatePaymentArgs): Promise<GatewayPayment> {
      const customerInfo: Record<string, string> = {};
      const phone = qiPhone(args.customer.phone);
      if (phone) customerInfo.phone = phone;
      if (args.customer.accountId) customerInfo.accountId = args.customer.accountId;
      const body = await call(
        'POST',
        '/payment',
        {
          requestId: args.requestId,
          amount: args.amountIqd,
          currency: 'IQD',
          locale: QI_LOCALE[args.locale] ?? QI_LOCALE.ar,
          finishPaymentUrl: args.finishPaymentUrl,
          notificationUrl: args.notificationUrl,
          ...(Object.keys(customerInfo).length ? { customerInfo } : {}),
          additionalInfo: args.additionalInfo,
          appChannel: false,
        },
        [args.requestId, args.amountIqd, 'IQD', null, null, null],
      );
      return toPayment(body);
    },

    async status(paymentId: string, requestId?: string | null): Promise<GatewayPayment> {
      return toPayment(await call('GET', `/payment/${encodeURIComponent(paymentId)}/status`, null, [requestId ?? null, paymentId]));
    },

    async statusByRequest(requestId: string): Promise<GatewayPayment> {
      return toPayment(
        await call('GET', `/payment/status/by/request/${encodeURIComponent(requestId)}`, null, [requestId, requestId]),
      );
    },

    async cancel(paymentId: string, cancelRequestId: string): Promise<GatewayPayment> {
      return toPayment(
        await call('POST', `/payment/${encodeURIComponent(paymentId)}/cancel`, { requestId: cancelRequestId }, [
          cancelRequestId,
          null,
          paymentId,
        ]),
      );
    },

    async refund(args: RefundArgs): Promise<GatewayRefund> {
      const body = await call(
        'POST',
        `/payment/${encodeURIComponent(args.paymentId)}/refund`,
        {
          requestId: args.refundRequestId,
          amount: args.amountIqd,
          ...(args.message ? { message: args.message.slice(0, 200) } : {}),
        },
        [args.refundRequestId, args.amountIqd, args.paymentId],
      );
      return { refundId: str(body.refundId), status: str(body.status) ?? '', raw: redactGatewayMessage(body) };
    },
  };
}
