import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


/** "+3" | "−2" | "even" — spelled out; nobody should need golf's lone
 * "E" explained to them at hole six. */
export function formatToPar(diff: number) {
  if (diff === 0) return "even";
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}
