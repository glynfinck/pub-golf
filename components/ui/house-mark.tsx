import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The house mark, in the app: a pint with the flagstick planted in it.
 *
 * Raster rather than the inline SVG this used to be, because the artwork
 * arrived as artwork — so it cannot ink itself from the semantic tokens the
 * way the old pennant did. In here it wears no plate at all: `mark-*.png`
 * are the glass alone on transparency, so the mark takes whatever ground
 * the screen already has instead of laying a second one over it. Two files
 * only because the glass is inked light for the Midnight ground and dark
 * for cream stock; both render and CSS picks, so the swap costs no
 * JavaScript and cannot flash the wrong one during hydration.
 */
export function HouseMark({ className }: { className?: string }) {
  const shared = "size-full object-contain";
  return (
    <span
      className={cn("relative inline-block size-9 overflow-hidden", className)}
    >
      <Image
        src="/brand/mark-cream.png"
        alt=""
        aria-hidden
        width={512}
        height={512}
        className={cn(shared, "dark:hidden")}
        priority
      />
      <Image
        src="/brand/mark-dark.png"
        alt=""
        aria-hidden
        width={512}
        height={512}
        className={cn(shared, "hidden dark:block")}
        priority
      />
    </span>
  );
}
