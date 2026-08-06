/** Prose formatting for the ceremony voice — numbers the way the printed
 * card would say them. */

const SMALL_NUMBERS = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** 3 → "three", 14 → "14" — words up to ten, digits beyond. */
export function countWord(n: number) {
  const magnitude = Math.abs(n);
  return magnitude <= 10 ? SMALL_NUMBERS[magnitude] : String(magnitude);
}

/** "level" | "two under" | "three over" — spelled out up to ten. */
export function underOverPhrase(diff: number) {
  if (diff === 0) return "level";
  return `${countWord(diff)} ${diff < 0 ? "under" : "over"}`;
}

/** The house color for an over/under-par number. */
export function toParClass(diff: number) {
  if (diff < 0) return "text-good";
  if (diff === 0) return "text-muted-foreground";
  return "text-hazard";
}

/** 1 → "1st", 2 → "2nd", 11 → "11th" — lowercase suffix, per the card. */
export function ordinal(n: number) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}
