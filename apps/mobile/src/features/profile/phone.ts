/**
 * Phone numbers as the app stores them: E.164, `+` then digits only
 * (`+9647701234567`). That is already the shape in `user_metadata` and in the
 * DB fixtures, so nothing downstream changes — this module only gives the UI a
 * way to SPLIT that string into a country and a national part, and to put it
 * back together.
 *
 * Iraq is the venue's country (docs/client/06 — the desk's own number is +964),
 * so it is the default for an empty field and sorts to the top of the picker.
 *
 * Deliberately RN-free: unit tests run under plain node (vitest.config.ts).
 */

export type Country = {
  /** ISO 3166-1 alpha-2 — the picker's key and the flag's source. */
  iso: string;
  /** Dial code WITHOUT the plus: '964'. */
  dial: string;
  /** English name; the picker also searches the localized name. */
  name: string;
  /**
   * How the NATIONAL digits are grouped when shown to the guest, as group
   * sizes: `'3 3 4'` renders `770 123 4567`. A leading group in parentheses
   * (`'(3) 3 4'`) is the North-American / Turkish area-code convention and
   * renders `(555) 123 4567`.
   *
   * Display only. Everything stored and validated is digits — `composePhone`
   * strips non-digits on the way to E.164 — so a wrong grouping here is a
   * cosmetic bug, never a corrupt number. Omitted for a country whose shape
   * is not worth asserting; those fall back to even groups of three.
   */
  fmt?: string;
  /**
   * Most national digits the field will accept, when that differs from the
   * length `fmt` implies. `fmt` is the COMMON shape, not a rule: a few
   * countries genuinely run longer (German numbers are 10–11 digits, Lebanese
   * mobiles 7–8), and a cap taken blindly from the pattern would make a real
   * number untypable — the failure mode `validatePhone` exists to avoid.
   * Omitted where the pattern's own length is the true maximum.
   */
  max?: number;
};

/** Iraq — the default for a field with nothing in it. */
export const DEFAULT_ISO = 'IQ';

/**
 * Iraq and its neighbours first (who actually walks into the venue), then
 * every other country and territory with a dial code, alphabetically. The rest
 * of the world was added 2026-09-15 when phone sign-in opened to all countries:
 * rows without `fmt` come from the mledoze/countries dataset (all 55 rows that
 * existed before agreed with it) and display in groups of three. Shared plans
 * keep their root code (+1, +7); Vatican City, Western Sahara, the Åland
 * Islands and Saint Helena use the code they are actually dialled on. Add or
 * fix a row here rather than reaching for a phone-number library.
 */
export const COUNTRIES: readonly Country[] = [
  { iso: 'IQ', dial: '964', name: 'Iraq', fmt: '3 3 4' },
  { iso: 'IR', dial: '98', name: 'Iran', fmt: '3 3 4' },
  { iso: 'TR', dial: '90', name: 'Türkiye', fmt: '(3) 3 2 2' },
  { iso: 'SY', dial: '963', name: 'Syria', fmt: '3 3 3' },
  { iso: 'JO', dial: '962', name: 'Jordan', fmt: '1 4 4' },
  { iso: 'KW', dial: '965', name: 'Kuwait', fmt: '4 4' },
  { iso: 'SA', dial: '966', name: 'Saudi Arabia', fmt: '2 3 4' },
  { iso: 'AE', dial: '971', name: 'United Arab Emirates', fmt: '2 3 4' },
  { iso: 'QA', dial: '974', name: 'Qatar', fmt: '4 4' },
  { iso: 'BH', dial: '973', name: 'Bahrain', fmt: '4 4' },
  { iso: 'OM', dial: '968', name: 'Oman', fmt: '4 4' },
  { iso: 'LB', dial: '961', name: 'Lebanon', fmt: '2 3 3' , max: 8 },
  { iso: 'EG', dial: '20', name: 'Egypt', fmt: '3 3 4' },
  // Rest of world, alphabetical.
  { iso: 'AF', dial: '93', name: 'Afghanistan' },
  { iso: 'AL', dial: '355', name: 'Albania' },
  { iso: 'DZ', dial: '213', name: 'Algeria' },
  { iso: 'AS', dial: '1684', name: 'American Samoa' },
  { iso: 'AD', dial: '376', name: 'Andorra' },
  { iso: 'AO', dial: '244', name: 'Angola' },
  { iso: 'AI', dial: '1264', name: 'Anguilla' },
  { iso: 'AG', dial: '1268', name: 'Antigua and Barbuda' },
  { iso: 'AR', dial: '54', name: 'Argentina' },
  { iso: 'AM', dial: '374', name: 'Armenia' },
  { iso: 'AW', dial: '297', name: 'Aruba' },
  { iso: 'AU', dial: '61', name: 'Australia', fmt: '3 3 3' },
  { iso: 'AT', dial: '43', name: 'Austria', fmt: '3 4 4' , max: 13 },
  { iso: 'AZ', dial: '994', name: 'Azerbaijan', fmt: '2 3 2 2' },
  { iso: 'BS', dial: '1242', name: 'Bahamas' },
  { iso: 'BD', dial: '880', name: 'Bangladesh' },
  { iso: 'BB', dial: '1246', name: 'Barbados' },
  { iso: 'BY', dial: '375', name: 'Belarus' },
  { iso: 'BE', dial: '32', name: 'Belgium', fmt: '3 2 2 2' },
  { iso: 'BZ', dial: '501', name: 'Belize' },
  { iso: 'BJ', dial: '229', name: 'Benin' },
  { iso: 'BM', dial: '1441', name: 'Bermuda' },
  { iso: 'BT', dial: '975', name: 'Bhutan' },
  { iso: 'BO', dial: '591', name: 'Bolivia' },
  { iso: 'BA', dial: '387', name: 'Bosnia and Herzegovina' },
  { iso: 'BW', dial: '267', name: 'Botswana' },
  { iso: 'BV', dial: '47', name: 'Bouvet Island' },
  { iso: 'BR', dial: '55', name: 'Brazil' },
  { iso: 'IO', dial: '246', name: 'British Indian Ocean Territory' },
  { iso: 'VG', dial: '1284', name: 'British Virgin Islands' },
  { iso: 'BN', dial: '673', name: 'Brunei' },
  { iso: 'BG', dial: '359', name: 'Bulgaria' },
  { iso: 'BF', dial: '226', name: 'Burkina Faso' },
  { iso: 'BI', dial: '257', name: 'Burundi' },
  { iso: 'KH', dial: '855', name: 'Cambodia' },
  { iso: 'CM', dial: '237', name: 'Cameroon' },
  { iso: 'CA', dial: '1', name: 'Canada', fmt: '(3) 3 4' },
  { iso: 'CV', dial: '238', name: 'Cape Verde' },
  { iso: 'BQ', dial: '599', name: 'Caribbean Netherlands' },
  { iso: 'KY', dial: '1345', name: 'Cayman Islands' },
  { iso: 'CF', dial: '236', name: 'Central African Republic' },
  { iso: 'TD', dial: '235', name: 'Chad' },
  { iso: 'CL', dial: '56', name: 'Chile' },
  { iso: 'CN', dial: '86', name: 'China', fmt: '3 4 4' },
  { iso: 'CX', dial: '61', name: 'Christmas Island' },
  { iso: 'CC', dial: '61', name: 'Cocos (Keeling) Islands' },
  { iso: 'CO', dial: '57', name: 'Colombia' },
  { iso: 'KM', dial: '269', name: 'Comoros' },
  { iso: 'CG', dial: '242', name: 'Congo' },
  { iso: 'CK', dial: '682', name: 'Cook Islands' },
  { iso: 'CR', dial: '506', name: 'Costa Rica' },
  { iso: 'HR', dial: '385', name: 'Croatia' },
  { iso: 'CU', dial: '53', name: 'Cuba' },
  { iso: 'CW', dial: '599', name: 'Curaçao' },
  { iso: 'CY', dial: '357', name: 'Cyprus', fmt: '2 6' },
  { iso: 'CZ', dial: '420', name: 'Czechia', fmt: '3 3 3' },
  { iso: 'DK', dial: '45', name: 'Denmark', fmt: '2 2 2 2' },
  { iso: 'DJ', dial: '253', name: 'Djibouti' },
  { iso: 'DM', dial: '1767', name: 'Dominica' },
  { iso: 'DO', dial: '1', name: 'Dominican Republic' },
  { iso: 'CD', dial: '243', name: 'DR Congo' },
  { iso: 'EC', dial: '593', name: 'Ecuador' },
  { iso: 'SV', dial: '503', name: 'El Salvador' },
  { iso: 'GQ', dial: '240', name: 'Equatorial Guinea' },
  { iso: 'ER', dial: '291', name: 'Eritrea' },
  { iso: 'EE', dial: '372', name: 'Estonia' },
  { iso: 'SZ', dial: '268', name: 'Eswatini' },
  { iso: 'ET', dial: '251', name: 'Ethiopia' },
  { iso: 'FK', dial: '500', name: 'Falkland Islands' },
  { iso: 'FO', dial: '298', name: 'Faroe Islands' },
  { iso: 'FJ', dial: '679', name: 'Fiji' },
  { iso: 'FI', dial: '358', name: 'Finland', fmt: '2 3 3' , max: 10 },
  { iso: 'FR', dial: '33', name: 'France', fmt: '1 2 2 2 2' },
  { iso: 'GF', dial: '594', name: 'French Guiana' },
  { iso: 'PF', dial: '689', name: 'French Polynesia' },
  { iso: 'TF', dial: '262', name: 'French Southern and Antarctic Lands' },
  { iso: 'GA', dial: '241', name: 'Gabon' },
  { iso: 'GM', dial: '220', name: 'Gambia' },
  { iso: 'GE', dial: '995', name: 'Georgia', fmt: '3 2 2 2' },
  { iso: 'DE', dial: '49', name: 'Germany', fmt: '3 4 4' , max: 11 },
  { iso: 'GH', dial: '233', name: 'Ghana' },
  { iso: 'GI', dial: '350', name: 'Gibraltar' },
  { iso: 'GR', dial: '30', name: 'Greece', fmt: '3 3 4' },
  { iso: 'GL', dial: '299', name: 'Greenland' },
  { iso: 'GD', dial: '1473', name: 'Grenada' },
  { iso: 'GP', dial: '590', name: 'Guadeloupe' },
  { iso: 'GU', dial: '1671', name: 'Guam' },
  { iso: 'GT', dial: '502', name: 'Guatemala' },
  { iso: 'GG', dial: '44', name: 'Guernsey' },
  { iso: 'GN', dial: '224', name: 'Guinea' },
  { iso: 'GW', dial: '245', name: 'Guinea-Bissau' },
  { iso: 'GY', dial: '592', name: 'Guyana' },
  { iso: 'HT', dial: '509', name: 'Haiti' },
  { iso: 'HN', dial: '504', name: 'Honduras' },
  { iso: 'HK', dial: '852', name: 'Hong Kong' },
  { iso: 'HU', dial: '36', name: 'Hungary' },
  { iso: 'IS', dial: '354', name: 'Iceland' },
  { iso: 'IN', dial: '91', name: 'India', fmt: '5 5' },
  { iso: 'ID', dial: '62', name: 'Indonesia', fmt: '3 4 4' },
  { iso: 'IE', dial: '353', name: 'Ireland', fmt: '2 3 4' },
  { iso: 'IM', dial: '44', name: 'Isle of Man' },
  { iso: 'IL', dial: '972', name: 'Israel' },
  { iso: 'IT', dial: '39', name: 'Italy', fmt: '3 3 4' , max: 10 },
  { iso: 'CI', dial: '225', name: 'Ivory Coast' },
  { iso: 'JM', dial: '1876', name: 'Jamaica' },
  { iso: 'JP', dial: '81', name: 'Japan', fmt: '2 4 4' },
  { iso: 'JE', dial: '44', name: 'Jersey' },
  { iso: 'KZ', dial: '7', name: 'Kazakhstan', fmt: '3 3 2 2' , max: 10 },
  { iso: 'KE', dial: '254', name: 'Kenya' },
  { iso: 'KI', dial: '686', name: 'Kiribati' },
  { iso: 'XK', dial: '383', name: 'Kosovo' },
  { iso: 'KG', dial: '996', name: 'Kyrgyzstan' },
  { iso: 'LA', dial: '856', name: 'Laos' },
  { iso: 'LV', dial: '371', name: 'Latvia' },
  { iso: 'LS', dial: '266', name: 'Lesotho' },
  { iso: 'LR', dial: '231', name: 'Liberia' },
  { iso: 'LY', dial: '218', name: 'Libya' },
  { iso: 'LI', dial: '423', name: 'Liechtenstein' },
  { iso: 'LT', dial: '370', name: 'Lithuania' },
  { iso: 'LU', dial: '352', name: 'Luxembourg' },
  { iso: 'MO', dial: '853', name: 'Macau' },
  { iso: 'MG', dial: '261', name: 'Madagascar' },
  { iso: 'MW', dial: '265', name: 'Malawi' },
  { iso: 'MY', dial: '60', name: 'Malaysia', fmt: '2 3 4' },
  { iso: 'MV', dial: '960', name: 'Maldives' },
  { iso: 'ML', dial: '223', name: 'Mali' },
  { iso: 'MT', dial: '356', name: 'Malta' },
  { iso: 'MH', dial: '692', name: 'Marshall Islands' },
  { iso: 'MQ', dial: '596', name: 'Martinique' },
  { iso: 'MR', dial: '222', name: 'Mauritania' },
  { iso: 'MU', dial: '230', name: 'Mauritius' },
  { iso: 'YT', dial: '262', name: 'Mayotte' },
  { iso: 'MX', dial: '52', name: 'Mexico' },
  { iso: 'FM', dial: '691', name: 'Micronesia' },
  { iso: 'MD', dial: '373', name: 'Moldova' },
  { iso: 'MC', dial: '377', name: 'Monaco' },
  { iso: 'MN', dial: '976', name: 'Mongolia' },
  { iso: 'ME', dial: '382', name: 'Montenegro' },
  { iso: 'MS', dial: '1664', name: 'Montserrat' },
  { iso: 'MA', dial: '212', name: 'Morocco', fmt: '3 3 3' },
  { iso: 'MZ', dial: '258', name: 'Mozambique' },
  { iso: 'MM', dial: '95', name: 'Myanmar' },
  { iso: 'NA', dial: '264', name: 'Namibia' },
  { iso: 'NR', dial: '674', name: 'Nauru' },
  { iso: 'NP', dial: '977', name: 'Nepal' },
  { iso: 'NL', dial: '31', name: 'Netherlands', fmt: '1 4 4' , max: 9 },
  { iso: 'NC', dial: '687', name: 'New Caledonia' },
  { iso: 'NZ', dial: '64', name: 'New Zealand', fmt: '2 3 4' },
  { iso: 'NI', dial: '505', name: 'Nicaragua' },
  { iso: 'NE', dial: '227', name: 'Niger' },
  { iso: 'NG', dial: '234', name: 'Nigeria' },
  { iso: 'NU', dial: '683', name: 'Niue' },
  { iso: 'NF', dial: '672', name: 'Norfolk Island' },
  { iso: 'KP', dial: '850', name: 'North Korea' },
  { iso: 'MK', dial: '389', name: 'North Macedonia' },
  { iso: 'MP', dial: '1670', name: 'Northern Mariana Islands' },
  { iso: 'NO', dial: '47', name: 'Norway', fmt: '3 2 3' , max: 8 },
  { iso: 'PK', dial: '92', name: 'Pakistan', fmt: '3 7' },
  { iso: 'PW', dial: '680', name: 'Palau' },
  { iso: 'PS', dial: '970', name: 'Palestine' },
  { iso: 'PA', dial: '507', name: 'Panama' },
  { iso: 'PG', dial: '675', name: 'Papua New Guinea' },
  { iso: 'PY', dial: '595', name: 'Paraguay' },
  { iso: 'PE', dial: '51', name: 'Peru' },
  { iso: 'PH', dial: '63', name: 'Philippines' },
  { iso: 'PN', dial: '64', name: 'Pitcairn Islands' },
  { iso: 'PL', dial: '48', name: 'Poland', fmt: '3 3 3' },
  { iso: 'PT', dial: '351', name: 'Portugal', fmt: '3 3 3' },
  { iso: 'PR', dial: '1', name: 'Puerto Rico' },
  { iso: 'RO', dial: '40', name: 'Romania', fmt: '3 3 3' },
  { iso: 'RU', dial: '7', name: 'Russia', fmt: '3 3 2 2' , max: 10 },
  { iso: 'RW', dial: '250', name: 'Rwanda' },
  { iso: 'RE', dial: '262', name: 'Réunion' },
  { iso: 'BL', dial: '590', name: 'Saint Barthélemy' },
  { iso: 'SH', dial: '290', name: 'Saint Helena, Ascension and Tristan da Cunha' },
  { iso: 'KN', dial: '1869', name: 'Saint Kitts and Nevis' },
  { iso: 'LC', dial: '1758', name: 'Saint Lucia' },
  { iso: 'MF', dial: '590', name: 'Saint Martin' },
  { iso: 'PM', dial: '508', name: 'Saint Pierre and Miquelon' },
  { iso: 'VC', dial: '1784', name: 'Saint Vincent and the Grenadines' },
  { iso: 'WS', dial: '685', name: 'Samoa' },
  { iso: 'SM', dial: '378', name: 'San Marino' },
  { iso: 'SN', dial: '221', name: 'Senegal' },
  { iso: 'RS', dial: '381', name: 'Serbia' },
  { iso: 'SC', dial: '248', name: 'Seychelles' },
  { iso: 'SL', dial: '232', name: 'Sierra Leone' },
  { iso: 'SG', dial: '65', name: 'Singapore', fmt: '4 4' },
  { iso: 'SX', dial: '1721', name: 'Sint Maarten' },
  { iso: 'SK', dial: '421', name: 'Slovakia' },
  { iso: 'SI', dial: '386', name: 'Slovenia' },
  { iso: 'SB', dial: '677', name: 'Solomon Islands' },
  { iso: 'SO', dial: '252', name: 'Somalia' },
  { iso: 'ZA', dial: '27', name: 'South Africa', fmt: '2 3 4' },
  { iso: 'GS', dial: '500', name: 'South Georgia' },
  { iso: 'KR', dial: '82', name: 'South Korea' },
  { iso: 'SS', dial: '211', name: 'South Sudan' },
  { iso: 'ES', dial: '34', name: 'Spain', fmt: '3 3 3' },
  { iso: 'LK', dial: '94', name: 'Sri Lanka' },
  { iso: 'SD', dial: '249', name: 'Sudan' },
  { iso: 'SR', dial: '597', name: 'Suriname' },
  { iso: 'SJ', dial: '4779', name: 'Svalbard and Jan Mayen' },
  { iso: 'SE', dial: '46', name: 'Sweden', fmt: '2 3 2 2' },
  { iso: 'CH', dial: '41', name: 'Switzerland', fmt: '2 3 2 2' },
  { iso: 'ST', dial: '239', name: 'São Tomé and Príncipe' },
  { iso: 'TW', dial: '886', name: 'Taiwan' },
  { iso: 'TJ', dial: '992', name: 'Tajikistan' },
  { iso: 'TZ', dial: '255', name: 'Tanzania' },
  { iso: 'TH', dial: '66', name: 'Thailand', fmt: '2 3 4' },
  { iso: 'TL', dial: '670', name: 'Timor-Leste' },
  { iso: 'TG', dial: '228', name: 'Togo' },
  { iso: 'TK', dial: '690', name: 'Tokelau' },
  { iso: 'TO', dial: '676', name: 'Tonga' },
  { iso: 'TT', dial: '1868', name: 'Trinidad and Tobago' },
  { iso: 'TN', dial: '216', name: 'Tunisia', fmt: '2 3 3' },
  { iso: 'TM', dial: '993', name: 'Turkmenistan' },
  { iso: 'TC', dial: '1649', name: 'Turks and Caicos Islands' },
  { iso: 'TV', dial: '688', name: 'Tuvalu' },
  { iso: 'UG', dial: '256', name: 'Uganda' },
  { iso: 'UA', dial: '380', name: 'Ukraine', fmt: '2 3 2 2' },
  { iso: 'GB', dial: '44', name: 'United Kingdom', fmt: '4 6' },
  { iso: 'US', dial: '1', name: 'United States', fmt: '(3) 3 4' },
  { iso: 'UM', dial: '268', name: 'United States Minor Outlying Islands' },
  { iso: 'VI', dial: '1340', name: 'United States Virgin Islands' },
  { iso: 'UY', dial: '598', name: 'Uruguay' },
  { iso: 'UZ', dial: '998', name: 'Uzbekistan', fmt: '2 3 2 2' },
  { iso: 'VU', dial: '678', name: 'Vanuatu' },
  { iso: 'VA', dial: '39', name: 'Vatican City' },
  { iso: 'VE', dial: '58', name: 'Venezuela' },
  { iso: 'VN', dial: '84', name: 'Vietnam' },
  { iso: 'WF', dial: '681', name: 'Wallis and Futuna' },
  { iso: 'EH', dial: '212', name: 'Western Sahara' },
  { iso: 'YE', dial: '967', name: 'Yemen', fmt: '3 3 3' },
  { iso: 'ZM', dial: '260', name: 'Zambia' },
  { iso: 'ZW', dial: '263', name: 'Zimbabwe' },
  { iso: 'AX', dial: '358', name: 'Åland Islands' },
];

/**
 * The country a SHARED dial code resolves to when nothing else tells them
 * apart. +1 and +7 keep the order this table had before the full list was
 * added (Canada, Kazakhstan); every other shared code resolves to the
 * sovereign country rather than its territories. The guest can always pick
 * another in the picker, and the composed E.164 is identical either way.
 */
export const PRIMARY_BY_DIAL: Readonly<Record<string, string>> = {
  '1': 'CA',
  '7': 'KZ',
  '39': 'IT',
  '44': 'GB',
  '47': 'NO',
  '61': 'AU',
  '64': 'NZ',
  '212': 'MA',
  '262': 'RE',
  '268': 'SZ',
  '358': 'FI',
  '500': 'FK',
  '590': 'GP',
  '599': 'CW',
};

export function countryByIso(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? defaultCountry();
}

/**
 * Iraq, as an object. The literal is the fallback rather than `COUNTRIES[0]`
 * so that this never depends on the table's order surviving an edit — and so
 * it has a type without a `noUncheckedIndexedAccess` assertion.
 */
export function defaultCountry(): Country {
  return COUNTRIES.find((c) => c.iso === DEFAULT_ISO) ?? { iso: 'IQ', dial: '964', name: 'Iraq' };
}

/**
 * The flag emoji for an ISO code, built from regional-indicator codepoints
 * rather than shipped as literals — no font asset, no 50 pasted emoji.
 */
export function flagOf(iso: string): string {
  const A = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
  const cps = iso
    .toUpperCase()
    .split('')
    .map((ch) => A + (ch.charCodeAt(0) - 65));
  if (cps.some((cp) => cp < A || cp > A + 25)) return '';
  return String.fromCodePoint(...cps);
}

/** Everything that is not a digit — spaces, dashes, parens the guest typed. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export type ParsedPhone = {
  /** ISO of the matched country, or DEFAULT_ISO when nothing matched. */
  iso: string;
  /** National part: digits only, no leading zero, no dial code. */
  national: string;
};

/**
 * Splits a stored number into its country and national parts.
 *
 * Handles the three shapes that actually exist in the data:
 *  - E.164 (`+9647701234567`) — what this app writes;
 *  - the international-prefix form (`009647701234567`) — the seeded venue
 *    number is written that way, and guests type it;
 *  - a bare national number (`07701234567`) — no country information at all,
 *    so it falls back to Iraq and the leading trunk `0` is dropped.
 *
 * Ambiguity is resolved by LONGEST dial code first (`+964` must not be read as
 * `+9` … no such code, but `+1` vs `+964` shows the principle), then by the
 * table's own order — so a shared code like +7 lands on Kazakhstan/Russia in
 * the order listed, and +1 on Canada before the US. The guest can always
 * correct it in the picker, and either way the composed E.164 is identical.
 */
export function parsePhone(stored: string | null | undefined): ParsedPhone {
  const raw = (stored ?? '').trim();
  if (!raw) return { iso: DEFAULT_ISO, national: '' };

  let rest: string | null = null;
  if (raw.startsWith('+')) rest = digitsOnly(raw);
  else {
    const d = digitsOnly(raw);
    // `00` is the international access prefix, equivalent to a leading `+`.
    if (d.startsWith('00')) rest = d.slice(2);
  }

  if (rest !== null) {
    const byLongest = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    const first = byLongest.find((c) => rest!.startsWith(c.dial) && rest!.length > c.dial.length);
    // A code several countries share resolves to its main country, not to
    // whichever territory sorts first alphabetically (+44 is the UK, not Guernsey).
    const hit = first ? (COUNTRIES.find((c) => c.iso === PRIMARY_BY_DIAL[first.dial]) ?? first) : undefined;
    if (hit) return { iso: hit.iso, national: stripTrunk(rest.slice(hit.dial.length)) };
    // A `+` we cannot attribute: keep the digits so nothing is silently lost,
    // and let the guest pick the country.
    return { iso: DEFAULT_ISO, national: stripTrunk(rest) };
  }

  return { iso: DEFAULT_ISO, national: stripTrunk(digitsOnly(raw)) };
}

/**
 * Drops the national trunk prefix `0` (`0770…` → `770…`). Iraqi mobiles are
 * dialled `07XX` locally but carry no zero in E.164, and that zero is the most
 * common way a guest's number would otherwise be stored wrong.
 */
export function stripTrunk(national: string): string {
  return national.replace(/^0+/, '');
}

/** Joins a country and a typed national number into stored E.164. */
export function composePhone(iso: string, national: string): string {
  const digits = stripTrunk(digitsOnly(national));
  if (!digits) return '';
  return `+${countryByIso(iso).dial}${digits}`;
}

/**
 * What the guest is allowed to type into the national box.
 *
 * With an `iso` the input is also CAPPED at that country's own length, so the
 * field simply stops accepting digits rather than letting a guest type a
 * number that could never dial. Without one it only strips non-digits — the
 * shape every existing caller relies on.
 */
export function sanitizeNationalInput(input: string, iso?: string): string {
  const digits = digitsOnly(input);
  if (!iso) return digits;
  return digits.slice(0, maxNationalDigits(iso));
}

/** Groups of three, for a country whose own shape is not worth asserting. */
const DEFAULT_FMT = '3 3 3 3';

/**
 * E.164 caps a whole number — dial code included — at 15 digits, so this is
 * the ceiling for a country with no shape of its own.
 */
const E164_MAX = 15;

/**
 * How many national digits this country's field accepts.
 *
 * `max` when the table states one, otherwise the length `fmt` implies, and for
 * a country with neither, whatever E.164 leaves after the dial code. Capping
 * the field at this is what stops a guest typing past their own number's
 * length; it is deliberately a MAXIMUM and never a minimum, so a shorter valid
 * number is still accepted and judged by `validatePhone`.
 */
export function maxNationalDigits(iso: string): number {
  const c = countryByIso(iso);
  const room = E164_MAX - c.dial.length;
  if (c.max) return Math.min(c.max, room);
  if (!c.fmt) return room;
  const implied = c.fmt.split(' ').reduce((n, t) => n + Number(t.replace(/[()]/g, '')), 0);
  return Math.min(implied, room);
}

/**
 * The national digits, grouped the way that country writes them:
 * `formatNational('TR', '5551234567')` → `'(555) 123 45 67'`.
 *
 * DISPLAY ONLY. The value the app stores and validates is always bare digits —
 * `composePhone` and `validatePhone` both run `digitsOnly` first — so a
 * grouping that is wrong for some carrier is a cosmetic bug and can never
 * produce a malformed E.164 number.
 *
 * Digits past the last group are appended unbroken rather than dropped: the
 * table's shapes are the COMMON case, not a length rule, and a guest with a
 * longer number must still be able to see everything they typed. Validation is
 * length-based and lives in `validatePhone`; this function never judges.
 */
export function formatNational(iso: string, national: string): string {
  const digits = digitsOnly(national);
  if (!digits) return '';
  const spec = countryByIso(iso).fmt ?? DEFAULT_FMT;

  const out: string[] = [];
  let at = 0;
  for (const token of spec.split(' ')) {
    if (at >= digits.length) break;
    // `(3)` — a parenthesised group, the area-code convention.
    const paren = token.startsWith('(');
    const size = Number(paren ? token.slice(1, -1) : token);
    const part = digits.slice(at, at + size);
    at += part.length;
    // The bracket CLOSES only once a digit follows the group — not merely when
    // the group is full. Closing it on the third digit made `(555)` the last
    // character of the field, so a backspace deleted the bracket, the digits
    // were unchanged, and this function put the bracket straight back: the
    // field looked frozen and those three digits could not be erased. Waiting
    // for the next digit means the final character is always one the guest
    // typed, so a backspace always removes a digit.
    const closed = paren && at < digits.length;
    out.push(paren ? (closed ? `(${part})` : `(${part}`) : part);
  }
  // Anything the shape did not account for, kept visible.
  if (at < digits.length) out.push(digits.slice(at));
  return out.join(' ');
}

/**
 * A stored number as a guest reads it back: `+964 770 123 4567`,
 * `+44 7700 900123`. Country code first so a number from anywhere is
 * unambiguous on screen (the code screen's "we sent a code to …"). Empty in,
 * empty out.
 */
export function displayPhone(stored: string | null | undefined): string {
  const { iso, national } = parsePhone(stored);
  if (!national) return '';
  return `+${countryByIso(iso).dial} ${formatNational(iso, national)}`;
}

export type PhoneValidation = 'PHONE_REQUIRED' | 'PHONE_INVALID' | null;

/**
 * Length-only validation, deliberately. Carrier prefixes change, and a wrong
 * "invalid" locks a real guest out of booking — the number's true test is the
 * desk ringing it. E.164 caps the whole number at 15 digits (dial code
 * included); below 4 national digits nothing is a phone number.
 */
export function validatePhone(iso: string, national: string): PhoneValidation {
  const digits = stripTrunk(sanitizeNationalInput(national));
  if (!digits) return 'PHONE_REQUIRED';
  const dial = countryByIso(iso).dial;
  if (digits.length < 4 || dial.length + digits.length > 15) return 'PHONE_INVALID';
  return null;
}

/**
 * Does saving this phone number need a 6-digit code first?
 *
 * Changing the number the desk dials is a contact-detail change, and until now
 * Save wrote whatever was typed. With phone OTP switched on, a CHANGED number
 * has to prove itself: the code goes to the new number, and `profiles.phone`
 * is only rewritten once it comes back (app/verify-otp.tsx, mode `link`).
 *
 * Three conditions, all required:
 *
 *  - `enabled` — EXPO_PUBLIC_PHONE_OTP is on. While the scaffold is dormant
 *    there is no vendor to deliver anything, so demanding a code would simply
 *    make the phone field unsaveable (docs/client/phone-otp-activation.md).
 *  - the number actually CHANGED. Editing only the name, or re-saving the same
 *    number written differently, must not spend a message — the comparison is
 *    on composed E.164, so `00964…` and `+964…` are the same number.
 *  - the new number is a real number (`validatePhone` accepts it). Since
 *    2026-09-15 the code gate accepts every country, so a changed number from
 *    anywhere has to prove itself; before that only Iraqi mobiles did. Since
 *    2026-09-16 a number with no WhatsApp still gets the code, as an SMS (the
 *    vendor falls back), so the change is no longer blocked on having WhatsApp.
 *
 * Pure and RN-free so the rule is unit-tested rather than inferred from a
 * screen. `next`/`current` are stored E.164 (or anything `parsePhone` accepts).
 */
export function phoneChangeNeedsCode(args: {
  enabled: boolean;
  current: string | null | undefined;
  next: string;
}): boolean {
  if (!args.enabled) return false;
  const cur = parsePhone(args.current);
  const nxt = parsePhone(args.next);
  const currentE164 = composePhone(cur.iso, cur.national);
  const nextE164 = composePhone(nxt.iso, nxt.national);
  if (!nextE164 || nextE164 === currentE164) return false;
  return validatePhone(nxt.iso, nxt.national) === null;
}
