/**
 * The rematch's name: one step up from the night before.
 *
 * "The Glyn Invitational XXX" hosts XXXI; "Quarterly Cup 2" hosts 3; a name
 * with no number to step gets " II" appended — the second running of the
 * same fixture. Pure string work: the action clamps the result to the
 * rounds.name limit, not this helper.
 */

const ROMAN_VALUES: [string, number][] = [
  ["M", 1000],
  ["CM", 900],
  ["D", 500],
  ["CD", 400],
  ["C", 100],
  ["XC", 90],
  ["L", 50],
  ["XL", 40],
  ["X", 10],
  ["IX", 9],
  ["V", 5],
  ["IV", 4],
  ["I", 1],
];

/** Real words spell in roman letters too ("MIX" reads as 1009), and no pub
 * crawl is on its two-hundredth running — past this, the word is a word. */
const MAX_SEQUEL = 200;

function toRoman(value: number): string {
  let out = "";
  let left = value;
  for (const [glyph, step] of ROMAN_VALUES) {
    while (left >= step) {
      out += glyph;
      left -= step;
    }
  }
  return out;
}

/** Canonical numerals only: "IIII" reads as 4 but is not a numeral this
 * helper would ever have written, so a word shaped like it is left alone. */
function fromRoman(numeral: string): number | null {
  let total = 0;
  let rest = numeral;
  for (const [glyph, step] of ROMAN_VALUES) {
    while (rest.startsWith(glyph)) {
      total += step;
      rest = rest.slice(glyph.length);
    }
  }
  if (rest !== "") return null;
  return toRoman(total) === numeral ? total : null;
}

export function rematchName(name: string): string {
  const trimmed = name.trim();

  const arabic = trimmed.match(/^(.*?)(\d+)$/);
  if (arabic) return `${arabic[1]}${Number(arabic[2]) + 1}`;

  const roman = trimmed.match(/^(.* )([IVXLCDM]+)$/);
  if (roman) {
    const value = fromRoman(roman[2]);
    if (value !== null && value < MAX_SEQUEL)
      return `${roman[1]}${toRoman(value + 1)}`;
  }

  return `${trimmed} II`;
}
