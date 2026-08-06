import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Alphabet for join codes — no 0/O or 1/I, per lobby UX research. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6) {
  const chars = new Uint32Array(length);
  crypto.getRandomValues(chars);
  return Array.from(chars, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join(
    "",
  );
}

/** "+3" | "−2" | "even" — spelled out; nobody should need golf's lone
 * "E" explained to them at hole six. */
export function formatToPar(diff: number) {
  if (diff === 0) return "even";
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}
