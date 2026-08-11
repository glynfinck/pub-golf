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
  total?: number;
  className?: string;
}) {
  const spent = Math.max(0, total - left);
  return (
    <span
      className={cn("flex items-center gap-1.5", className)}
      data-testid="caddy-usage"
    >
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
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
