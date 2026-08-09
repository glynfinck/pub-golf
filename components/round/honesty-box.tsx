import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { honestyBoxHref } from "@/lib/billing";
import { cn } from "@/lib/utils";

/**
 * Phase one of the tariff: a tip jar at the 19th hole, riding a Stripe
 * Payment Link. It buys nothing and gates nothing — the covenant's whole
 * point — so there is no webhook and no entitlement behind it, and with the
 * link absent from the environment the box simply isn't on the screen.
 */
export function HonestyBox({ code }: { code: string }) {
  const href = honestyBoxHref(process.env.NEXT_PUBLIC_HONESTY_BOX_URL, code);
  if (!href) return null;

  return (
    <Card className="gap-0 px-4" data-testid="honesty-box">
      <div className="eyebrow text-fairway">The honesty box</div>
      <p className="mt-1.5 text-sm">Good round? Stand the house one.</p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: "outline" }), "mt-3 w-full")}
      >
        Stand the house a round
      </a>
      <p className="mt-2 text-xs text-muted-foreground">
        Pay what you feel, from £3 — handled by Stripe. It buys nothing and
        changes nothing; the game stays free.
      </p>
    </Card>
  );
}
