import { CADDY_COURSES_PER_FEE, coursesLeftNote } from "@/lib/caddy/credits";
import { cn } from "@/lib/utils";

/**
 * What is left on the fee, at a glance and in one line.
 *
 * "Covered" was the whole of what a host could see, and it went on saying
 * Covered after the last course had been planned — the app telling somebody
 * they had something they did not, right up until it refused them. A pass has
 * two dimensions and the badge only ever showed one: the clock is time and
 * this is the thing the time is *for*.
 *
 * Pips rather than a number, and the count in words beside them. A bare "2"
 * beside a button is a badge nobody can parse; three marks with one greyed is
 * a quantity you read without counting, which is the whole job at this size.
 * It is not a meter that turns red either — the covenant's line about no
 * countdown clocks is about manufactured urgency, and this is a fact about
 * something already owned, shown only to the person who owns it.
 */
export function CaddyUsage({
  left,
  total = CADDY_COURSES_PER_FEE,
  className,
}: {
  left: number;
  /** How many the row is drawn out of. Defaults to a fee's own five, and is
   * raised below when the host holds more than that — see `shown`. */
  total?: number;
  className?: string;
}) {
  /**
   * How many pips to draw.
   *
   * A fee gives five, and this defaulted to five and stopped. Top-ups are
   * durable and stack, so `left` can be eight or twelve — at which point
   * `spent` clamped to zero, five filled pips rendered, and the words beside
   * them said a larger number. The row disagreed with itself.
   *
   * So the row grows to hold what the host actually has. It never shrinks
   * below the fee's five, because a half-spent fee should read as a fee with
   * some gone rather than as a smaller fee.
   */
  const shown = Math.max(total, left);
  const spent = Math.max(0, shown - left);
  return (
    <span
      className={cn("flex items-center gap-1.5", className)}
      data-testid="caddy-usage"
    >
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: shown }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-1.5 rounded-full",
              index < spent ? "bg-muted-foreground/30" : "bg-fairway",
            )}
          />
        ))}
      </span>
      {/* The words are what a screen reader gets, and what anybody gets who
          cannot tell a filled pip from an empty one at 6px. */}
      <span className="text-[10px] text-muted-foreground">
        {coursesLeftNote(left)}
      </span>
    </span>
  );
}
