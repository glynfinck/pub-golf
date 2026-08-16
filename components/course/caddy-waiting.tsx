"use client";

import { Putt } from "@/components/ui/putt";
import { useThinking } from "@/hooks/use-thinking";
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
 * finish a line that is moving. `useThinking` waits for a sentence to close,
 * then holds that thought long enough to read before letting the next one
 * take the screen; `key` on the line makes each new thought fade in over the
 * last. Both rows are one line and neither reflows, so the heading above and
 * everything below stay put for the whole wait.
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
  const thought = useThinking(thinking);
  return (
    <div
      className={cn("flex flex-col items-center gap-3", className)}
      aria-live="polite"
    >
      <Putt />
      <div className="text-center font-serif text-lg leading-tight text-balance">
        {headline}
      </div>
      {/* `h-9` reserves both rows exactly, so nothing under this moves as the
          lines arrive. It was `min-h-9`, which is a floor rather than a cap —
          a two-line thought pushed straight through it and the whole panel
          hopped. Each row inside is one line and truncates. */}
      <div className="flex h-9 w-full flex-col items-center justify-start gap-1 overflow-hidden">
        {doing ? (
          <p className="animate-in fade-in h-4 w-full truncate text-center text-[11px] leading-4 font-semibold text-fairway">
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
            className="animate-in fade-in h-4 w-full truncate text-center text-[11px] leading-4 text-muted-foreground/80 italic duration-500 motion-reduce:animate-none"
          >
            {thought}
          </p>
        ) : doing ? null : (
          <p className="h-4 truncate text-[11px] leading-4 text-muted-foreground">
            {fallback}
          </p>
        )}
      </div>
    </div>
  );
}
