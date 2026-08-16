"use client";

import { Putt } from "@/components/ui/putt";
import { highlight } from "@/lib/caddy/thinking";
import { cn } from "@/lib/utils";

/**
 * The caddy's wait, narrated — the one implementation of it.
 *
 * There were two: this one on the drafting table and a second, differently
 * shaped one inside the gallery's panel, which reserved a different height and
 * jumped as the lines arrived. Two tickers for one wait is two chances to get
 * the reserved height wrong, and both were taken.
 *
 * **Three fixed rows, and the heading never moves.** The heading used to be
 * replaced by whatever tool the caddy had reached for, which put "Looking for
 * pubs with a beer garden near Old Street" in an 18px serif and pushed the
 * panel out of shape. The heading is the one stable thing on the screen now
 * and everything that varies sits under it, in its own row, clamped.
 *
 * **The reasoning arrives as headlines, not as a firehose.** The third row
 * used to hold the raw tail of the model's thinking, clamped to two lines and
 * re-rendered on every token — so it slid upward continuously and was cut
 * mid-word at both ends. It is unreadable by construction: the eye cannot
 * finish a line that is moving. `highlight` waits for a sentence to close and
 * hands back one complete thought, which then holds still until the next one
 * finishes; `key` on the line makes each new thought fade in over the last.
 */
export function CaddyTicker({
  headline,
  doing,
  thinking,
  fallback,
  className,
}: {
  headline: string;
  /** The tool the caddy has reached for, named. Outranks the reasoning. */
  doing: string;
  /** The caddy's own reasoning, where the stream sends any. Narration only —
   * a run where it never arrives looks exactly like the old one. */
  thinking: string;
  /** What the third row says when there is neither. */
  fallback: string;
  className?: string;
}) {
  const thought = highlight(thinking);
  return (
    <div
      className={cn("flex flex-col items-center gap-3", className)}
      aria-live="polite"
    >
      <Putt />
      <div className="text-center font-serif text-lg leading-tight text-balance">
        {headline}
      </div>
      {/* `min-h-9` reserves the two clamped rows below, so nothing under this
          moves as the lines arrive. */}
      <div className="flex min-h-9 w-full flex-col items-center justify-start gap-1 overflow-hidden">
        {doing ? (
          <p className="animate-in fade-in line-clamp-1 max-w-full text-center text-[11px] font-semibold text-fairway">
            {doing}
          </p>
        ) : null}
        {thought ? (
          <p
            // Keyed on the thought itself: React swaps the element when the
            // caddy finishes a new one, so the fade plays per thought rather
            // than once per mount — and never per token.
            key={thought}
            aria-live="off"
            className="animate-in fade-in duration-500 line-clamp-2 max-w-full text-center text-[11px] text-muted-foreground/80 italic motion-reduce:animate-none"
          >
            {thought}
          </p>
        ) : doing ? null : (
          <p className="text-[11px] text-muted-foreground">{fallback}</p>
        )}
      </div>
    </div>
  );
}
