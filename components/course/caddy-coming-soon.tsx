import { cn } from "@/lib/utils";

/**
 * The caddy's slot on the drafting table, while the caddy is still being
 * finished.
 *
 * This is the one place the house breaks its own "absence rather than
 * apology" rule, and the break is narrow enough to state exactly. Absence is
 * right when a thing is missing *for you* — no key on this deploy, no fee on
 * your account — because a disabled version of something you cannot have is
 * an accusation dressed as a feature. It is wrong when the thing is missing
 * for *everyone*, temporarily, because then it is news about the club rather
 * than a verdict on the member: nobody feels excluded by a note saying the
 * kitchen opens next month.
 *
 * So it renders on `CADDY_OPEN` being unset and on nothing else
 * (`lib/caddy/open.ts`). The four equipment gates in `readiness.ts` still
 * produce silence, exactly as before.
 *
 * Three things it deliberately is not:
 *
 *   **Not a button.** Nothing here is pressable, there is no waiting list and
 *   there is no email box. A control that does nothing is worse than no
 *   control, and collecting an address for a feature with no date on it is a
 *   promise the house has not decided to make.
 *
 *   **Not a price.** `tests/unit/covenant-money.test.ts` holds the rule and
 *   this module is not on its list: money answers a refusal, and there is
 *   nothing here to be refused. The green fee is off sale while this note is
 *   up (`greenFeeOnSale`), so quoting it would be advertising a shut till.
 *
 *   **Not "AI".** Copy never mentions the machinery — the same rule the
 *   caddy's own group keeps. What is coming is a caddy who plans your night,
 *   which is what a host actually wants to hear about.
 *
 * The builder underneath is untouched and says so. That sentence is the
 * covenant expressed as layout: the manual builder was never the paid thing
 * and does not become a lesser thing because the caddy is late.
 */
export function CaddyComingSoon({ className }: { className?: string }) {
  return (
    <div
      data-testid="caddy-coming-soon"
      className={cn(
        "engraved flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">The caddy</span>
        <span className="rounded-md border border-marker px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-marker uppercase">
          Coming soon
        </span>
      </div>
      <p className="font-serif text-base text-foreground">
        A caddy to plan the night for you.
      </p>
      <p className="text-xs text-muted-foreground">
        Tell it where you&apos;re drinking and how far you&apos;ll walk, and
        get a course back — pubs, drinks, pars and local rules, ready to
        change. It isn&apos;t ready yet, so it isn&apos;t here yet.
      </p>
      <p className="text-xs text-muted-foreground">
        Plot your own below, exactly as always. That part is free and stays
        free.
      </p>
    </div>
  );
}
