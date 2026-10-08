import { describe, expect, it } from 'vitest';
import { parseSupplierPrice, parsePriceNumber } from './parseSupplierPrice';

// The fixtures are cut down from the shapes real shop platforms print; only
// the parts the parser reads (and some it must ignore) are kept.

const page = (head: string, body = '') => `<!doctype html><html><head><title>Racket</title>${head}</head><body>${body}</body></html>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe('parsePriceNumber', () => {
  it.each([
    [25000, 25000],
    [25000.4, 25000],
    ['25000', 25000],
    ['25,000', 25000],
    ['1,250,000', 1250000],
    ['25.000', 25000],
    ['1.250.000', 1250000],
    ['25000.00', 25000],
    ['25000.5', 25001],
    ['1,234.50', 1235],
    ['1.234,50', 1235],
    ['12,5', 13],
    ['25 000', 25000],
    ['25 000', 25000],
    ['٢٥٬٠٠٠', 25000],
    ['٢٥٠٠٠٫٠٠', 25000],
    ['۲۵۰۰۰', 25000],
    ['25,000 IQD', 25000],
    ['IQD 25,000', 25000],
    ['25,000 د.ع', 25000],
    ['  25000  ', 25000],
  ])('%j → %d', (raw, want) => {
    expect(parsePriceNumber(raw)).toBe(want);
  });

  it.each([[0], ['0'], ['0.00'], [-5], ['-5'], ['abc'], [''], ['25,00,0'], ['1.2.3'], ['25.'], [Number.NaN], [Infinity], [null], [undefined], [{}], ['2e12'], [2e12], ['0.4']])(
    'refuses %j',
    (raw) => {
      expect(parsePriceNumber(raw)).toBeNull();
    },
  );

  it('keeps the ceiling the server holds (1e12)', () => {
    expect(parsePriceNumber(1e12)).toBe(1e12);
    expect(parsePriceNumber(1e12 + 1)).toBeNull();
  });
});

describe('parseSupplierPrice: JSON-LD', () => {
  it('reads a Shopify product (offers array, one variant, string price)', () => {
    const html = page(
      ld({
        '@context': 'http://schema.org/',
        '@type': 'Product',
        name: 'Bullpadel Vertex 04',
        url: 'https://shop.example.iq/products/vertex-04',
        offers: [
          {
            '@type': 'Offer',
            sku: 'VX04',
            availability: 'http://schema.org/InStock',
            price: '290000.00',
            priceCurrency: 'IQD',
            url: 'https://shop.example.iq/products/vertex-04?variant=1',
          },
        ],
      }),
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 290000, source: 'jsonld' });
  });

  it('reads a WooCommerce @graph with a priceSpecification and skips the strike-through price', () => {
    const html = page(
      ld({
        '@context': 'https://schema.org/',
        '@graph': [
          { '@type': 'BreadcrumbList', itemListElement: [] },
          {
            '@type': 'Product',
            '@id': 'https://store.example.com/product/balls/#product',
            name: 'Head Padel Pro (3 balls)',
            offers: [
              {
                '@type': 'Offer',
                priceSpecification: [
                  { '@type': 'UnitPriceSpecification', price: '15000', priceCurrency: 'IQD', valueAddedTaxIncluded: 'false' },
                  { '@type': 'UnitPriceSpecification', price: '18000', priceCurrency: 'IQD', priceType: 'https://schema.org/ListPrice' },
                ],
                availability: 'http://schema.org/InStock',
              },
            ],
          },
        ],
      }),
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 15000, source: 'jsonld' });
  });

  it('reads a Salla / Zid style product: type array, offers object without @type, numeric price', () => {
    const html = page(
      `<script type='application/ld+json'>
        {"@context":"https://schema.org","@type":["Product","Thing"],"name":"مضرب بادل","offers":{"price":125000,"priceCurrency":"IQD","availability":"https://schema.org/InStock"}}
      </script>`,
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 125000, source: 'jsonld' });
  });

  it('reads an AggregateOffer whose low and high prices agree', () => {
    const html = page(ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: '45000', highPrice: '45000', priceCurrency: 'IQD', offerCount: 2 } }));
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 45000, source: 'jsonld' });
  });

  it('calls a price range ambiguous', () => {
    const html = page(ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 40000, highPrice: 55000, priceCurrency: 'IQD' } }));
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'ambiguous' });
  });

  it('calls a "from" price (an AggregateOffer with one end over several offers) ambiguous', () => {
    const from = page(ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: '40000', offerCount: 3, priceCurrency: 'IQD' } }));
    expect(parseSupplierPrice(from)).toEqual({ ok: false, error: 'ambiguous' });
    const unsaid = page(ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: '40000', priceCurrency: 'IQD' } }));
    expect(parseSupplierPrice(unsaid)).toEqual({ ok: false, error: 'ambiguous' });
    // One offer, or listed offers that agree, is one price.
    const one = page(ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: '40000', offerCount: 1, priceCurrency: 'IQD' } }));
    expect(parseSupplierPrice(one)).toEqual({ ok: true, priceIqd: 40000, source: 'jsonld' });
    const listed = page(
      ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: '40000', priceCurrency: 'IQD', offers: [{ price: '40000' }, { price: '40,000' }] } }),
    );
    expect(parseSupplierPrice(listed)).toEqual({ ok: true, priceIqd: 40000, source: 'jsonld' });
  });

  it('calls two variants with different prices ambiguous', () => {
    const html = page(
      ld({
        '@type': 'Product',
        offers: [
          { '@type': 'Offer', price: '90000', priceCurrency: 'IQD', name: 'Small' },
          { '@type': 'Offer', price: '95000', priceCurrency: 'IQD', name: 'Large' },
        ],
      }),
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'ambiguous' });
  });

  it('reads the linked variant on a Shopify-style page that lists every variant, and stays ambiguous with no variant named', () => {
    const html = page(
      ld({
        '@type': 'Product',
        url: 'https://shop.example.iq/products/vertex-04',
        offers: [
          { '@type': 'Offer', price: '90000.00', priceCurrency: 'IQD', url: 'https://shop.example.iq/products/vertex-04?variant=1' },
          { '@type': 'Offer', price: '95000.00', priceCurrency: 'IQD', url: '/products/vertex-04?variant=2' },
        ],
      }),
    );
    expect(parseSupplierPrice(html, 'https://shop.example.iq/products/vertex-04?variant=2')).toEqual({ ok: true, priceIqd: 95000, source: 'jsonld' });
    expect(parseSupplierPrice(html, 'https://shop.example.iq/products/vertex-04?variant=1&ref=x')).toEqual({ ok: true, priceIqd: 90000, source: 'jsonld' });
    expect(parseSupplierPrice(html, 'https://shop.example.iq/products/vertex-04')).toEqual({ ok: false, error: 'ambiguous' });
    expect(parseSupplierPrice(html, 'https://shop.example.iq/products/vertex-04?variant=9')).toEqual({ ok: false, error: 'ambiguous' });
    expect(parseSupplierPrice(html, 'https://shop.example.iq/products/other?variant=2')).toEqual({ ok: false, error: 'ambiguous' });
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'ambiguous' });
  });

  it('reads two variants at the same price as that price', () => {
    const html = page(
      ld({
        '@type': 'ProductGroup',
        hasVariant: [
          { '@type': 'Product', offers: { '@type': 'Offer', price: '90000', priceCurrency: 'IQD' } },
          { '@type': 'Product', offers: { '@type': 'Offer', price: '90,000', priceCurrency: 'IQD' } },
        ],
      }),
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 90000, source: 'jsonld' });
  });

  it('refuses a page priced in dollars', () => {
    const html = page(ld({ '@type': 'Product', offers: { '@type': 'Offer', price: '199.99', priceCurrency: 'USD' } }));
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'not_iqd' });
  });

  it('takes the AggregateOffer currency down to its own offers', () => {
    const html = page(
      ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', priceCurrency: 'USD', offers: [{ '@type': 'Offer', price: '120' }] } }),
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'not_iqd' });
  });

  it('skips a malformed block and reads the next one', () => {
    const html = page(
      `<script type="application/ld+json">{"@type":"Organization", "name": "Broken",</script>` +
        ld({ '@type': 'Organization', name: 'Shop' }) +
        ld([{ '@type': 'WebSite' }, { '@type': 'Product', offers: { '@type': 'Offer', price: '35000', priceCurrency: 'IQD' } }]),
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 35000, source: 'jsonld' });
  });

  it('reads a block wrapped in CDATA or an HTML comment', () => {
    const body = JSON.stringify({ '@type': 'Product', offers: { price: 61000, priceCurrency: 'IQD' } });
    expect(parseSupplierPrice(page(`<script type="application/ld+json"><![CDATA[${body}]]></script>`))).toMatchObject({ ok: true, priceIqd: 61000 });
    expect(parseSupplierPrice(page(`<script type="application/ld+json"><!--${body}--></script>`))).toMatchObject({ ok: true, priceIqd: 61000 });
  });

  it('wins over the meta tags when both are on the page', () => {
    const html = page(
      ld({ '@type': 'Product', offers: { '@type': 'Offer', price: '70000', priceCurrency: 'IQD' } }) +
        '<meta property="product:price:amount" content="99000">',
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 70000, source: 'jsonld' });
  });

  it('falls through to the meta tags when the JSON-LD has no price', () => {
    const html = page(ld({ '@type': 'Product', name: 'Grip', offers: { '@type': 'Offer', availability: 'InStock' } }) + '<meta property="og:price:amount" content="5,000">');
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 5000, source: 'meta' });
  });

  it('reads a schema.org URL as a type', () => {
    const html = page(ld({ '@type': 'http://schema.org/Product', offers: { '@type': 'http://schema.org/Offer', price: '8000', priceCurrency: 'IQD' } }));
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 8000, source: 'jsonld' });
  });
});

describe('parseSupplierPrice: meta tags', () => {
  it('reads Open Graph product tags with an IQD currency', () => {
    const html = page(
      '<meta property="og:type" content="product">' +
        '<meta property="product:price:amount" content="45000.00" />' +
        '<meta property="product:price:currency" content="IQD" />',
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 45000, source: 'meta' });
  });

  it('reads og:price and product:price together when they agree', () => {
    const html = page('<meta property="og:price:amount" content="45000"><meta content="45,000" property="product:price:amount">');
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 45000, source: 'meta' });
  });

  it('refuses a meta price in another currency', () => {
    const html = page('<meta property="og:price:amount" content="35.00"><meta property="og:price:currency" content="usd">');
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'not_iqd' });
  });

  it('reads a name="price" tag with Arabic-Indic digits and entity-encoded content', () => {
    expect(parseSupplierPrice(page('<meta name="price" content="٣٥٬٠٠٠">'))).toEqual({ ok: true, priceIqd: 35000, source: 'meta' });
    expect(parseSupplierPrice(page('<meta name="price" content="35&#44;000">'))).toEqual({ ok: true, priceIqd: 35000, source: 'meta' });
  });

  it('does not take a meta tag that only looks like a price (description, twitter data)', () => {
    const html = page('<meta name="description" content="Only 25,000 IQD!"><meta name="twitter:data1" content="25000">');
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'no_price' });
  });
});

describe('parseSupplierPrice: microdata', () => {
  it('reads itemprop="price" content= with its priceCurrency', () => {
    const html = page(
      '',
      `<div itemscope itemtype="https://schema.org/Product">
         <h1 itemprop="name">Wristband</h1>
         <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
           <span itemprop="price" content="3000">3,000 د.ع</span>
           <span itemprop="priceCurrency" content="IQD"></span>
         </div>
       </div>`,
    );
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 3000, source: 'microdata' });
  });

  it('takes a currency given on a meta tag for a microdata price', () => {
    const html = page('', '<meta itemprop="priceCurrency" content="EUR"><span itemprop="price" content="20.00">€20</span>');
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'not_iqd' });
  });

  it('ignores an itemprop price with no content attribute, and markup inside scripts', () => {
    const html = page('', `<span itemprop="price">25,000</span><script>var t = '<span itemprop="price" content="1">';</script>`);
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'no_price' });
  });

  it('calls two different microdata prices ambiguous', () => {
    const html = page('', '<span itemprop="price" content="10000"></span><span itemprop="price" content="12000"></span>');
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'ambiguous' });
  });
});

describe('parseSupplierPrice: a hostile or broken page', () => {
  // The page is a stranger's and the parse runs on the till's own thread:
  // a page the size the shell lets through (3 MB) must not stall it, whatever
  // it holds. The first, regex-only scan stalled for minutes on pages like these.
  const big = (unit: string) => unit.repeat(Math.floor((3 * 1024 * 1024) / unit.length));

  it.each([
    ['unclosed <script', big('<script ')],
    ['unclosed ld+json openers', big('<script type="application/ld+json"')],
    ['unclosed tags', big('<a ')],
    ['opened scripts that never close', big('<script>x')],
    ['a long run inside meta tags', big(`<meta ${'x'.repeat(4000)}>`)],
    ['unclosed attribute values', big(`<meta ${'a="x '.repeat(800)}>`)],
  ])('reads %s in well under a second', (_name, html) => {
    const t = performance.now();
    expect(parseSupplierPrice(html)).toEqual({ ok: false, error: 'no_price' });
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('still reads a price after an unclosed script further down the page', () => {
    const html = page('<meta property="product:price:amount" content="12000">', '<script>var never = "closed";');
    expect(parseSupplierPrice(html)).toEqual({ ok: true, priceIqd: 12000, source: 'meta' });
  });

  it('skips bare attributes and reads unquoted and single-quoted values', () => {
    expect(parseSupplierPrice(page('', "<div itemscope><span itemprop=price content=7000></span><span itemprop='priceCurrency' content='IQD'></span></div>"))).toEqual({
      ok: true,
      priceIqd: 7000,
      source: 'microdata',
    });
  });
});

describe('parseSupplierPrice: nothing to read', () => {
  it('says no_price for a page with no structured price', () => {
    expect(parseSupplierPrice(page('<meta property="og:title" content="Racket">', '<p>Price: 25,000 IQD</p>'))).toEqual({ ok: false, error: 'no_price' });
    expect(parseSupplierPrice('')).toEqual({ ok: false, error: 'no_price' });
  });

  it('says no_price when the only price is zero or nonsense', () => {
    expect(parseSupplierPrice(page(ld({ '@type': 'Product', offers: { price: '0', priceCurrency: 'IQD' } })))).toEqual({ ok: false, error: 'no_price' });
    expect(parseSupplierPrice(page('<meta property="og:price:amount" content="call us">'))).toEqual({ ok: false, error: 'no_price' });
  });

  it('reads a "$25" price string as dollars, not as 25 dinars', () => {
    expect(parseSupplierPrice(page(ld({ '@type': 'Product', offers: { price: '$25' } })))).toEqual({ ok: false, error: 'not_iqd' });
  });
});
