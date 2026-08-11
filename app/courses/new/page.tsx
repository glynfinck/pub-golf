import { CourseBuilder } from "@/components/course/course-builder";
import { billingEnabled } from "@/lib/billing";
import { caddyEnabled } from "@/lib/caddy/credentials";
import { getDayPass } from "@/lib/data/billing";
import { getSessionUser } from "@/lib/data/rounds";

/** The drafting table with a blank sheet on it (components/course/course-builder). */
export default async function NewCoursePage() {
  const [pass, user] = await Promise.all([getDayPass(), getSessionUser()]);

  return (
    <CourseBuilder
      // The gates, all of them the covenant's. No model key, or an anonymous
      // seat, and the caddy's group is not on the page at all — absence rather
      // than apology, the same pattern the maps key already uses. Guests never
      // cross the payment boundary, so no price is ever rendered on their
      // screen even though they can reach this table.
      //
      // The till is the one gate a held pass overrides, and that is the point
      // rather than a leniency: a closed till means nothing can be *sold*, and
      // a host who already bought a day pass is not being sold anything. Anding
      // it in unconditionally meant switching Stripe off retracted a thing
      // somebody had paid for, which is the clawback the covenant forbids —
      // this app's rule is that what you have stays yours. It also makes a
      // deploy testable without a payment provider: grant an entitlement row
      // and the caddy is on the table.
      caddy={
        caddyEnabled(process.env) &&
        user != null &&
        !user.is_anonymous &&
        (billingEnabled(process.env.STRIPE_SECRET_KEY) || pass != null)
      }
      hasPass={pass != null}
    />
  );
}
