# Supplier price watch on the shop desk (2026-10-08)

Majed, 2026-10-08: the shop desk should notice by itself when a supplier changes the price of a
product the Touch Shop sells. It reads each product's page on the supplier's website every hour.
When the price there changes, the owner and the shop assistants get a push on the phone. In the
operator, "Apply new price" fills the new price in. The supplier's price becomes the shop's price
as it is, with no margin added and no calculation.

The same day, the shop desk lost its Waste page. Shop breakage now shows up as a difference in a
shop stock count. The café's `/stock/waste` stays.

## Decisions (Majed)

| Question | Answer |
| --- | --- |
| Which suppliers | Any. Staff paste the link to the product page, one link per shop size, and the desk reads the standard price data the page publishes. No per-supplier code. |
| How often | Every hour |
| Who hears of a change | The owner and the shop assistants (`shop_staff`), by push |
| New shop price | The supplier price as it is, applied by a person ("Apply new price"), never automatically |
| Where it runs | On the shop desk PC |

## Where it runs, and why the PC

The reading runs in the Electron operator shell on the station whose mode is `shop`, not on the
server:

- Supplier sites often refuse or challenge requests from cloud addresses. The shop PC is an
  ordinary customer connection in Iraq, the same one staff use to open those pages by hand.
- No new edge function, cron job, secret or deploy step is needed. The server only stores what the
  desk reports.
- The cost is that nothing is read while the shop PC is off. That is accepted: the shop's prices
  only matter while the shop is open.

The shell fetches a page (`touch:fetch-supplier-page`, `apps/operator-shell/src/main/supplier-fetch.ts`)
and refuses on any machine that is not a shop station. The link was typed by staff, and the PC sits
on the venue network, so the fetch only ever reaches the public web:

- https on port 443 only;
- the host name is resolved and refused if any address is private, loopback or link-local;
- the connection is pinned to the addresses that were checked;
- each redirect (four at most) is checked the same way;
- one page takes at most 15 s and 3 MB.

The operator (`apps/operator/src/features/shop/priceWatch/`) reads the price from the page's
structured data, in this order: JSON-LD `offers`, then price meta tags, then microdata. It reads
one link every few seconds in an hourly pass, and reports each result to the server. A link read
less than 30 minutes ago (by the server's clock, against the PC's at the start of the pass) is
skipped, so a quick restart does not read everything again; the margin is half the hour so that a
long pass or a PC clock running behind does not push links to every other pass. On a page whose
JSON-LD lists one offer per variant, each with its own `url` (Shopify's `?variant=`), a link that
names its variant reads that offer's price instead of `ambiguous`.

## The data

`public.shop_price_watches` (migration 0322) has one row per shop size with a link. Each row holds:

- the link;
- the last supplier price read and the one before the latest change;
- when the price changed;
- the last attempt and the last good read;
- the last read error.

Managers, the owner and the branch's shop assistants can read it. Writes go only through the two
RPCs below.

- `app.set_shop_price_watch(p_variant_id, p_url)` sets or removes a size's link. A link must be
  https, 12 to 2000 characters, with no spaces, no user name and no `\` or `%` in the host part,
  and its host must be a public name
  with a dot: not an IP address, not `localhost`, and not ending in `.local`, `.localhost`,
  `.internal`, `.lan` or `.home.arpa`. Otherwise it fails with `SUPPLIER_URL_INVALID`. A café size
  fails with `NOT_SHOP_CATEGORY`. A new link clears everything read from the old one.
- `app.record_shop_supplier_price(p_variant_id, p_url, p_price_iqd, p_error)` is the desk's report
  of one read. It answers with one of these statuses:
  - `stale`: the link was changed or removed while the page was being read, so the read is
    dropped;
  - `error`: the read failed, and the error is kept;
  - `first`: the first good read, stored with no push;
  - `same`: the price has not changed;
  - `changed`: the old price is kept as the previous one, and the change is audited as
    `shop.price_watch.changed`.

## Read errors

There is one closed list, shared by the table's CHECK, the shell and the operator. A size whose
last read failed shows "Supplier link not read" on its Products row (the reason in its tooltip and
in the size form), and a listed change whose latest read failed says so under its time, until a
good read clears it.

| Error | Meaning |
| --- | --- |
| `no_price` | The page publishes no price the desk can read |
| `ambiguous` | The page publishes more than one different price |
| `not_iqd` | The price is in another currency |
| `blocked_url` | The link, or a redirect, leads somewhere the desk will not go |
| `http_error` | The site answered with an error status |
| `timeout` | No full answer within 15 s |
| `too_large` | The page is over 3 MB |
| `not_html` | The answer is not a web page |
| `fetch_failed` | The site could not be reached |

The shell can also answer `not_shop_station` or `unavailable` (in a browser). Neither is reported,
because the watch simply does not run there.

## The push rule

A `changed` read sends a push only when the new supplier price differs from the size's current
shop price. A change the shop already sells at sends nothing.

- The push is `staff_info` with `title_key` `shop_price_changed` and route `staff`, so it opens
  Today on the phone. The phone app needs no change.
- It goes to the owners and the branch's active shop assistants, the person whose session sent the
  report included when they are one of them. `notify_staff` skips its caller, and here the caller
  is whoever is signed in at the shop PC, usually the shop assistant on shift, so the RPC queues
  that person's row itself, in the same shape and under the same dedupe. The desk also tells them:
  after an hourly pass that left a new price to apply, a toast on whatever page is open says so and
  points to Products ("A supplier changed a price. Open
  Products to apply it."). On `/shop/products` the change is listed under "Supplier price
  changes" and marked on its row.
- The push names the product, and the size in brackets when the product has more than one
  size. It never shows a price, because of the lock-screen rule in `notify_staff`. The prices are
  in the operator and the audit log.
- One push goes out per size every 15 minutes, whatever the price, using the dedupe key
  `shop-price:<variant>`. Keying it on the price too would let a caller who steps the price on
  every call push the owner without limit; honest hourly reads are 60 minutes apart, well past
  the 15-minute window.

Copy: EN "Supplier price changed" / "{product}: the supplier changed the price. Open Products on the
shop desk to apply it." The Arabic is in `send-push/staffStrings.ts`. It is a draft and is on the
client's review list.

## Applying a new price

On `/shop/products`, a size whose supplier price differs from its shop price shows the supplier
price next to it and an "Apply new price" button. The button opens the size form with the supplier
price filled in. Saving goes through the existing `app.upsert_retail_variant`, with the same rules
as any edit:

- the owner and the shop assistants change a price directly;
- a manager on a product that is on sale gets `PRICE_VIA_PROTOCOL` and goes through "Change the
  price".

No new write path to `menu_item_variants.price_iqd` was added.
