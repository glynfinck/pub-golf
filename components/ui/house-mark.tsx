import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The house mark, in the app: a pint with the flagstick planted in it.
 *
 * Raster rather than the inline SVG this used to be, because the artwork
 * arrived as artwork — so it cannot ink itself from the semantic tokens the
 * way the old pennant did. It carries its own ground instead, which is why
 * there are two files: the dark plate would be a hole punched in cream
 * stock, and the cream plate a bright patch on the Midnight Invitational.
 * Both are rendered and CSS picks, so the swap costs no JavaScript and
 * never flashes the wrong one during hydration.
 */
export function HouseMark({ className }: { className?: string }) {
  const shared = "size-full object-contain";
  return (
    <span
      className={cn("relative inline-block size-9 overflow-hidden", className)}
    >
      <Image
        src="/brand/icon-cream.png"
        alt=""
        aria-hidden
        width={512}
        height={512}
        className={cn(shared, "dark:hidden")}
        priority
      />
      <Image
        src="/brand/icon-dark.png"
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
