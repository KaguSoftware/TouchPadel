#!/usr/bin/env python3
"""Build the café history files from the Morabaa till PDFs.

Reads originals/*.pdf (not in git: *.pdf is ignored; SHA256SUMS proves a copy)
with `pdftotext -layout` and writes, next to this script:

  history-hours.csv     one row per calendar day and hour of the till's clock
  history-items.csv     one row per day, product name and unit price
  history-products.csv  one row per product name and unit price: our grouping
                        and the owner's cost where the cost sheet names it

Everything in the first two files is a plain sum of rows the till printed.
Nothing is estimated, spread or filled in. The third file is ours: the group
is read from the product's name, the cost is item-costs-2026-11.md matched by
name (the sheet names no sizes, so one cost covers every size).

Usage:  python3 extract.py            (needs pdftotext on PATH or in /opt/homebrew/bin)
        python3 extract.py --check    (rebuild in memory, fail if a file differs)

scripts/lib/legacy-cafe.mjs turns the three files into the data migration;
tests/legacy-cafe-source.test.ts holds the migration to them and the files to
the till's printed totals.
"""
import collections
import csv
import io
import os
import re
import shutil
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ORIGINALS = os.path.join(HERE, 'originals')

BIDI = re.compile('[‎‏‪-‮⁦-⁩]')
DATE = re.compile(r'20\d\d-\d\d-\d\d')
TIME = re.compile(r'\b\d{1,2}:\d{2}\b')

ORDER_FILES = ['2026-06-orders', '2026-07-orders', '2026-08-orders', '2026-09-orders']
ITEM_FILES = ['2026-06-items', '2026-07-items', '2026-08-items', '2026-09-items',
              '2026-07-02-to-10-31-items']
# The till's own printed totals (last page of each orders file): gross, discounts, received.
PRINTED = {
    '2026-06-orders': (20946500, 611995, 20334505),
    '2026-07-orders': (26678750, 403888, 26274863),
    '2026-08-orders': (20050250, 387613, 19662638),
    '2026-09-orders': (25205000, 568373, 24636628),
}


def norm(s):
    s = unicodedata.normalize('NFKC', s)
    s = re.sub('[ً-ْـ]', '', s)  # tashkeel, tatweel
    return re.sub(r'\s+', ' ', s).strip(' .،,')


def num(t):
    return int(t.replace(',', ''))


def fields(line):
    return [f for f in re.split(r'\s{2,}', BIDI.sub('', line).strip()) if f]


def pdf_text(name):
    exe = shutil.which('pdftotext') or '/opt/homebrew/bin/pdftotext'
    path = os.path.join(ORIGINALS, name + '.pdf')
    return subprocess.run([exe, '-layout', path, '-'], check=True, capture_output=True).stdout.decode('utf-8')


def parse_orders(text):
    rows = []
    lines = text.split('\n')
    for i, raw in enumerate(lines):
        line = BIDI.sub('', raw)
        if line.count('|') >= 3:
            continue  # the printed totals line
        ds = DATE.findall(line)
        if len(ds) != 2:
            continue
        f = fields(raw)
        left = [num(x) for x in f[:7]]
        nxt = ''
        for j in range(i + 1, min(i + 4, len(lines))):
            if TIME.search(lines[j]):
                nxt = BIDI.sub('', lines[j])
                break
        ts = TIME.findall(nxt)
        rows.append(dict(date=ds[1], time=ts[-1] if ts else None,
                         received=left[1], discount=left[3], amount=left[4]))
    return rows


def parse_items(text):
    rows = []
    for raw in text.split('\n'):
        line = BIDI.sub('', raw)
        d = DATE.search(line)
        if not d:
            continue
        f = fields(raw)
        t = TIME.search(f[0])
        g = re.match(r'^(\d+)(\D.*)$', f[-1])  # a long name glued to the row number
        if g:
            f = f[:-1] + [g.group(2), g.group(1)]
        if len(f) > 11:  # a name holding a double space
            f = f[:9] + [' '.join(f[9:-1]), f[-1]]
        rowid, name, unit, qty, total = num(f[-1]), norm(f[-2]), num(f[-3]), num(f[-4]), num(f[-5])
        seq = num(f[-6])
        if qty * unit != total:
            raise SystemExit(f'line total is not quantity x price: {raw.strip()[:160]}')
        rows.append(dict(rowid=rowid, name=name, unit=unit, qty=qty, total=total, seq=seq,
                         date=d.group(0), time=t.group(0) if t else None))
    return rows


# --- ours: the grouping, read from the product's name -----------------------
def group(n):
    def has(*words):
        return any(w in n for w in words)
    if n in ('ماء', 'كلاص ثلج', 'كلاص ثلج مع ليمون'):
        return 'water_ice'
    if n.startswith('موهيتو'):
        return 'mojito'
    if n.startswith('اسبريسو'):
        return 'espresso'
    if has('سموذي', 'ميلك', 'ملك اوريو', 'سلاش', 'فرابجينو'):
        return 'smoothie_shake'
    if n.startswith('ايس شوكلت'):
        return 'tea_chocolate'
    if (n.startswith('ايس') and n != 'ايسكريم') or n == 'كولد برو':
        return 'iced_coffee'
    if has('لاتيه', 'تركيه', 'كبتشينو', 'امركانو', 'امريكانو', 'V60', 'كورتادو', 'فلات وايت',
           'قهوة فرنسيه', 'بستاشيو مكياتو'):
        return 'hot_coffee'
    if has('شاي', 'كركديه', 'هوت شوكلت'):
        return 'tea_chocolate'
    if has('ماتشا'):
        return 'other'
    if has('كوكيز', 'دونات', 'ايسكريم', 'سان سباستيان', 'كيك', 'براونيز', 'ترامسيو', 'فطيرة',
           'فواكه مجففه', 'سنسيره', 'سويت لندن'):
        return 'dessert_food'
    if has('برتقال', 'فراولة', 'بطيخ', 'مانكا', 'ليمون', 'تفاح', 'بولو', 'فروتي', 'اناناس',
           'موز حليب', 'بادل فريش'):
        return 'juice'
    return 'other'


# --- ours: the owner's cost sheet (item-costs-2026-11.md) matched by name ---
# (cost in IQD, the sheet's line as written). The sheet names no sizes.
def cost(n, unit):
    def has(*words):
        return any(w in n for w in words)
    if n == 'اسبريسو سنكل':
        return 300, 'اسبريسو سنكل'
    if n == 'اسبريسو دبل':
        return 540, 'اسبريسو دبل'
    if n in ('امركانو', 'ايس امركانو'):
        return 750, 'امريكانو هوت + ايس'
    if n == 'فلات وايت':
        return 1000, 'فلات وايت'
    if n == 'كورتادو':
        return 1000, 'كوردتاو'
    if n in ('تركيه وسط', 'تركيه ساده', 'تركيه حلوه'):
        return 1000, 'تركيه'
    if n == 'شاي كرك':
        return 1000, 'شاي كرك'
    if n == 'شاي ليمون':
        return 1000, 'شاي ليمون'
    if n == 'لاتيه كلاسك ساخن وسط':
        return 1000, 'لاتيه ساخن كلاسك'
    if has('كرميل لاتيه', 'موكا لاتيه'):
        return 1500, 'لاتيه كرميل موكا'
    if has('بندق لاتيه', 'فانلا لاتيه'):
        return 1750, 'لاتيه بندق + فانلا + كوكيز'
    if n == 'هوت شوكلت':
        return 1300, 'هوت شوكلت'
    if n.startswith('بستاشيو مكياتو'):
        return 2000, 'بستاشيو مكياتو'
    if n.startswith('موهيتو'):
        return 1250, 'موهيتو كل أنواعه'
    if n.startswith('سموذي باشن'):
        return 1500, 'سموذي باشن'
    if n.startswith(('سموذي فراولة', 'سموذي مانجو', 'سموذي خوخ', 'سموذي انناس')):
        return 1250, 'سموذي منكا + فراوله + خوخ + اناناس'
    if n in ('برتقال كبير', 'برتقال وسط'):
        return 1250, 'برتقال'
    if n in ('فراولة كبير', 'فراولة وسط'):
        return 1300, 'فراوله'
    if n in ('مانكا كبير', 'مانكا وسط'):
        return 1500, 'منكا'
    if n in ('ليمون كبير', 'ليمون وسط'):
        return 1250, 'ليمون'
    if n in ('بولو كبير', 'بولو وسط'):
        return 1300, 'بولو'
    if n.startswith('تفاح اخضر'):
        return 750, 'تفاح اخضر'
    if n.startswith('برتقال جزر'):
        return 1500, 'برتقال جزر'
    if n.startswith(('ميلك', 'ملك اوريو')):
        return 1600, 'ميلك شيك'
    if n.startswith('فرابجينو'):
        return 2000, 'فرابشينو'
    if n == 'سان سباستيان':
        return 1600, 'سان'
    if n == 'مافن كيك':
        return 500, 'مافن كيك'
    if n == 'دونات':
        return 600, 'دونات'
    if n == 'ليزي كيك':
        return 2500, 'ليزي كيك'
    if n == 'كوكيز':
        # The till prints both cookies under one name: 2,000 is the plain one,
        # 3,000 the stuffed one.
        return (1750, 'كوكيز محشي') if unit == 3000 else (1250, 'كوكيز')
    if n == 'كيك جزر':
        return 1000, 'كيك جزر'
    if n.startswith('براونيز'):
        return 2000, 'براونيز'
    if n == 'ترامسيو':
        return 1600, 'تراميسو'
    if n == 'انكلش كيك':
        return 350, 'انكلش كيك'
    return None, None


def build():
    orders = {name: parse_orders(pdf_text(name)) for name in ORDER_FILES}
    items = {name: parse_items(pdf_text(name)) for name in ITEM_FILES}

    for name, (gross, disc, recv) in PRINTED.items():
        got = sum(r['amount'] for r in orders[name])
        if got != gross:
            raise SystemExit(f'{name}: orders sum {got} is not the printed total {gross}')

    # One line list with no day twice: June's file, 1 July from July's file, then
    # the longer export (2 July to 31 October). Where the files overlap they are
    # identical row for row (README, "How well the files agree").
    longer = items['2026-07-02-to-10-31-items']
    lines = (items['2026-06-items']
             + [r for r in items['2026-07-items'] if r['date'] == '2026-07-01']
             + longer)
    seen = set()
    for r in lines:
        if r['rowid'] in seen:
            raise SystemExit(f'row {r["rowid"]} twice')
        seen.add(r['rowid'])
    for name in ('2026-07-items', '2026-08-items', '2026-09-items'):
        have = {r['rowid']: r for r in longer}
        for r in items[name]:
            if r['date'] == '2026-07-01':
                continue
            o = have.get(r['rowid'])
            if o is None or (o['name'], o['unit'], o['qty'], o['date'], o['time']) != (r['name'], r['unit'], r['qty'], r['date'], r['time']):
                raise SystemExit(f'{name}: row {r["rowid"]} is not in the longer export as printed')

    all_orders = [r for name in ORDER_FILES for r in orders[name]]
    order_days = {r['date'] for r in all_orders}

    hours = collections.defaultdict(lambda: dict(lines=0, units=0, items_gross=0, tickets=set(),
                                                 orders=0, orders_gross=0, discount=0, received=0))
    # A ticket (the till's order counter, `seq`) belongs to the hour of its first line.
    first = {}
    for r in lines:
        k = (r['date'], r['seq'])
        if k not in first or r['time'] < first[k]:
            first[k] = r['time'].zfill(5)
    for r in lines:
        h = hours[(r['date'], int(r['time'].split(':')[0]))]
        h['lines'] += 1
        h['units'] += r['qty']
        h['items_gross'] += r['total']
    for (day, seq), t in first.items():
        hours[(day, int(t.split(':')[0]))]['tickets'].add(seq)
    for r in all_orders:
        if r['time'] is None:
            raise SystemExit(f'an order on {r["date"]} has no time')
        h = hours[(r['date'], int(r['time'].split(':')[0]))]
        h['orders'] += 1
        h['orders_gross'] += r['amount']
        h['discount'] += r['discount']
        h['received'] += r['received']

    hour_rows = []
    for (day, hour) in sorted(hours):
        h = hours[(day, hour)]
        covered = day in order_days
        hour_rows.append([day, hour, h['lines'], h['units'], h['items_gross'], len(h['tickets']),
                          h['orders'] if covered else '', h['orders_gross'] if covered else '',
                          h['discount'] if covered else '', h['received'] if covered else ''])

    item_days = collections.Counter()
    for r in lines:
        item_days[(r['date'], r['name'], r['unit'])] += r['qty']
    item_rows = [[d, n, u, q] for (d, n, u), q in sorted(item_days.items())]

    pairs = collections.Counter()
    for (d, n, u), q in item_days.items():
        pairs[(n, u)] += q
    product_rows = []
    for (n, u) in sorted(pairs):
        c, stated = cost(n, u)
        product_rows.append([n, u, group(n), '' if c is None else c, stated or ''])

    return {
        'history-hours.csv': (['day', 'hour', 'item_lines', 'units', 'items_gross_iqd', 'tickets',
                               'orders', 'orders_gross_iqd', 'discount_iqd', 'received_iqd'], hour_rows),
        'history-items.csv': (['day', 'product', 'unit_price_iqd', 'units'], item_rows),
        'history-products.csv': (['product', 'unit_price_iqd', 'group_key', 'cost_iqd', 'cost_stated'], product_rows),
    }


def render(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def main():
    check = '--check' in sys.argv
    bad = 0
    for name, (header, rows) in build().items():
        text = render(header, rows)
        path = os.path.join(HERE, name)
        if check:
            same = os.path.exists(path) and open(path, encoding='utf-8').read() == text
            print(f'{name}: {"same" if same else "DIFFERENT"} ({len(rows)} rows)')
            bad += 0 if same else 1
        else:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(text)
            print(f'{name}: {len(rows)} rows')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
