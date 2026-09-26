/**
 * ============================================================================
 *  CONNECT A MODEL HERE. This is the only file that knows which AI reads the
 *  photos: supplier receipts (-> Goods in) AND waiters' order slips (-> the
 *  till). Everything around it (the photo, the spend cap, validation, matching
 *  to stock or to the menu, the review, Goods in and the till) is already
 *  built and tested with the fake reader (RECEIPT_READER=fake, fake.ts).
 * ============================================================================
 *
 * Until this function returns a reader, receipt-scan answers 503
 * RECEIPT_READER_NOT_CONFIGURED, the paper stays "uploaded", and staff type
 * the lines by hand against the photo (a manager on Goods in, a cashier on the
 * till). Nothing breaks.
 *
 * TO CONNECT ONE (Gemini, Claude Sonnet, an OpenAI-compatible vision model…):
 *
 *   1. Implement read() below with the vendor's HTTP API (plain fetch is
 *      simplest; an SDK is fine as `npm:<package>@<version>`):
 *        - system text:  input.system
 *        - user content: the image (input.imageBase64, input.mediaType)
 *                        + input.userText
 *        - output:       JSON matching input.schema; use the vendor's
 *                        structured output / JSON mode if it has one, else
 *                        paste JSON.stringify(input.schema) into the prompt
 *      The pipeline fills those per kind of paper (prompt.ts promptFor), so
 *      the same code reads receipts and order slips; input.kind is there if
 *      a vendor needs to know (a model per kind, say).
 *        - pass input.signal to fetch so the 60 s limit can cancel the call
 *        - return { reading: <the parsed JSON, or the raw JSON text>,
 *                   usage: { input: <prompt tokens>, output: <output tokens> } }
 *        - throw new ReceiptReaderError(code, message) on failure:
 *            429 -> 'RATE_LIMITED', timeout/abort -> 'TIMEOUT',
 *            other HTTP or network errors -> 'UPSTREAM',
 *            the vendor refused the image -> 'UNREADABLE'
 *      validate.ts cleans whatever comes back; do not post-process here.
 *
 *   2. Store the key:  npx supabase secrets set RECEIPT_API_KEY=...
 *      (from packages/db; never in the repo or config.toml). Locally, put it
 *      in supabase/functions/.env.
 *
 *   3. Name the model: npx supabase secrets set RECEIPT_MODEL=<model id>
 *
 *   4. Price it, or it is billed at the blended fallback rate: add the model
 *      to platform_settings.llm_pricing (USD micros per million tokens,
 *      {"input":…, "cache_write":…, "cache_read":…, "output":…}) in a
 *      migration, as 0142 did for openai/gpt-oss-120b.
 *
 *   5. Check the AI budget lets it run: platform_settings.llm_daily_request_limit
 *      must be above 0 and llm_monthly_cost_cap_micros above what is spent
 *      (the owner's usage page, or app.assistant_set_monthly_cap). The
 *      assistant was gated on hosted with a limit of 0; receipts share that
 *      meter, so a 0 there answers 429 LLM_DAILY_QUOTA on every scan.
 *
 * Then redeploy receipt-scan (a push to main does it) and tap "Read again" on
 * a receipt. Vendor host names, SDK imports and key names belong in THIS file
 * only; tests/receipt-scan.test.ts fails if they leak anywhere else.
 *
 * ============================================================================
 *  WHAT IS LEFT (written 2026-09-27, when the pipeline was built; Milestone 4b)
 * ============================================================================
 *
 * Everything below the model is built, tested and pushed: the phone's two
 * camera pages, the tables and RPCs (migrations 0236-0239), matching, the
 * reviews on Goods in and on the till, the audit trail. What is not done:
 *
 * A. CHOOSE AND CONNECT A MODEL (Parsa decides the vendor).
 *    - Needs: image input, JSON output, good Arabic HANDWRITING. The papers are
 *      mostly handwritten Iraqi Arabic (receipts from suppliers, order slips
 *      from waiters). Try two or three candidates on the real papers (B) before
 *      committing to one; accuracy on handwriting matters more than price.
 *    - Candidates: Google Gemini (Flash for cost, Pro for accuracy), Anthropic
 *      Claude (Sonnet), an OpenAI-compatible vision model.
 *    - Gemini sketch (REST, no SDK):
 *        POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
 *        header x-goog-api-key: <key>
 *        body {
 *          systemInstruction: { parts: [{ text: input.system }] },
 *          contents: [{ role: 'user', parts: [
 *            { inline_data: { mime_type: input.mediaType, data: input.imageBase64 } },
 *            { text: input.userText + '\nReply with JSON matching: ' + JSON.stringify(input.schema) } ] }],
 *          generationConfig: { responseMimeType: 'application/json', temperature: 0 } }
 *        reading = body.candidates[0].content.parts[0].text (a JSON string is fine)
 *        usage   = { input: body.usageMetadata.promptTokenCount,
 *                    output: body.usageMetadata.candidatesTokenCount }
 *      Gemini's own responseSchema accepts only an OpenAPI subset; our schema
 *      uses additionalProperties and exclusiveMinimum, so paste it into the
 *      text (as above) or strip those keywords before passing it.
 *    - Claude sketch (REST):
 *        POST https://api.anthropic.com/v1/messages
 *        headers x-api-key: <key>, anthropic-version: 2023-06-01
 *        body { model, max_tokens: 4096, system: input.system,
 *               messages: [{ role: 'user', content: [
 *                 { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
 *                 { type: 'text', text: input.userText + '\nReply with JSON matching: ' + JSON.stringify(input.schema) } ] }] }
 *        reading = the text block of body.content
 *        usage   = { input: body.usage.input_tokens, output: body.usage.output_tokens }
 *      (The owner assistant already talks to Claude through
 *      _shared/assistant/provider.ts; do NOT import it here: this seam stays
 *      vendor-free except for this one file.)
 *    - Map failures: HTTP 429 -> RATE_LIMITED, an abort -> TIMEOUT, other HTTP
 *      and network errors -> UPSTREAM, a refused image -> UNREADABLE. Pass
 *      usage in the error when the vendor reports tokens on a failure.
 *    - Then steps 2-5 above. The pricing row is a new migration (the next free
 *      ordinal; check supabase/migrations, it was 0240 when this was written).
 *    - Test: add a case to packages/db/tests/receipt-scan.test.ts that stubs
 *      fetch (vi.stubGlobal, as tests/sms-provider.test.ts does) with a
 *      recorded vendor answer and checks connectReceiptModel's reader returns
 *      { reading, usage } and maps a 429 to RATE_LIMITED.
 *
 * B. TUNE ON REAL PAPERS. The client owes 20-30 real handwritten supplier
 *    receipts and 20-30 waiters' order slips (photos from the phone, as staff
 *    will take them). Run them through the chosen model locally
 *    (`npx supabase functions serve` from packages/db with RECEIPT_API_KEY and
 *    RECEIPT_MODEL in supabase/functions/.env and RECEIPT_READER unset, then
 *    scan from the phone or Goods in) and adjust the prompts in prompt.ts:
 *    RECEIPT_SYSTEM_PROMPT and SLIP_SYSTEM_PROMPT (the thousands shorthand,
 *    table numbers, the café's own abbreviations). Keep the "copy only what is
 *    written" and "unclear" rules: a wrong number that looks sure is worse
 *    than a flagged one. Matching thresholds are in SQL: 0.45 for stock
 *    (app.match_receipt_lines, 0237) and 0.4 for the menu
 *    (app.match_slip_lines, 0239); change them by a new migration only.
 *    Aliases learn from every confirm and send, so matching improves with use.
 *
 * C. SHIP THE SCREENS. The operator's new panels (Goods in > Scanned receipts,
 *    Till > Scanned orders) reach the stations with the next operator tag
 *    (installed on every station); the phone's "Scan an order" and "Scan a
 *    receipt" reach staff with the next mobile build (owner-run `eas build`).
 *    Until then the database and receipt-scan are live but nobody sees them.
 *
 * D. CLIENT REVIEW of the Arabic: packages/i18n/src/catalogs/ws/receipts.ar.ts,
 *    ws/slips.ar.ts, staff/scan.ar.ts and the new op.errors lines in
 *    opErrors.protocols.ar.ts. Drafted by the build team.
 *
 * E. FOLLOW-UPS, not started:
 *    - Photo retention: nothing deletes the photos. A 90-day purge of the
 *      staff-media `receipts` and `slips` paths claimed by confirmed, sent or
 *      rejected papers (a cron tick like protocol-action's incident purge).
 *    - Spend per feature: app.llm_record_usage takes p_surface
 *      ('receipt_scan' / 'order_slip_scan') but does not store it; the owner's
 *      usage page shows one total for the assistant and the scans together.
 *    - The driver's purchases (staff-purchase, 0166) keep their typed lines;
 *      scanning them could reuse the receipt path.
 *    - The till's slip review needs the station online (no offline queue).
 *
 * WHERE THINGS ARE: _shared/receipts/ (this seam: types, prompt, validate,
 * fake, index), functions/receipt-scan/ (the flow, scan.ts, and index.ts),
 * migrations 0236-0239, tests/receipts.test.ts, tests/order-slips.test.ts,
 * tests/receipt-scan.test.ts, apps/operator/src/features/stock/receipts/,
 * apps/operator/src/features/till/slips/, apps/mobile/src/features/staff/scan/,
 * e2e/tests/operator-scan.spec.ts. The full record: HANDOFF.md, Day 37.
 */
import type { ReceiptReader } from './types.ts';

// Uncomment when the implementation needs it:
// import { ReceiptReaderError } from './types.ts';

export function connectReceiptModel(get: (name: string) => string | undefined): ReceiptReader | null {
  const apiKey = get('RECEIPT_API_KEY');
  const model = get('RECEIPT_MODEL');
  if (!apiKey || !model) return null;

  // Not connected yet: return a reader here, e.g.
  //
  //   return {
  //     model,
  //     async read(input) {
  //       const res = await fetch('<vendor endpoint>', { method: 'POST', signal: input.signal, … });
  //       if (res.status === 429) throw new ReceiptReaderError('RATE_LIMITED', 'rate limited');
  //       if (!res.ok) throw new ReceiptReaderError('UPSTREAM', `HTTP ${res.status}`);
  //       const body = await res.json();
  //       return { reading: <JSON text or object from body>, usage: { input: …, output: … } };
  //     },
  //   };
  return null;
}
