import { CourseBuilder } from "@/components/course/course-builder";
import { billingEnabled } from "@/lib/billing";
import { caddyEnabled } from "@/lib/caddy/client";
import { getDayPass } from "@/lib/data/billing";
import { getSessionUser } from "@/lib/data/rounds";

/** The drafting table with a blank sheet on it (components/course/course-builder). */
export default async function NewCoursePage() {
  const [pass, user] = await Promise.all([getDayPass(), getSessionUser()]);

  return (
    <CourseBuilder
      // Three gates, all of them the covenant's. No model key, no till, or an
      // anonymous seat, and the caddy's group is not on the page at all —
      // absence rather than apology, the same pattern the maps key already
      // uses. Guests never cross the payment boundary, so no price is ever
      // rendered on their screen even though they can reach this table.
      caddy={
        caddyEnabled(process.env.ANTHROPIC_API_KEY) &&
        billingEnabled(process.env.STRIPE_SECRET_KEY) &&
        user != null &&
        !user.is_anonymous
      }
      hasPass={pass != null}
    />
  );
}
