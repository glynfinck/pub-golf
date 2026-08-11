import { NewRound } from "@/components/round/new-round";
import { billingEnabled } from "@/lib/billing";
import { getDayPass } from "@/lib/data/billing";
import { getMyCourses } from "@/lib/data/courses";
import { getSessionUser } from "@/lib/data/rounds";

export const metadata = { title: "New round" };

export default async function NewRoundPage() {
  // One wait, not three: the courses, the host's own pass and the session
  // are independent.
  const [courses, pass, user] = await Promise.all([
    getMyCourses(),
    getDayPass(),
    getSessionUser(),
  ]);

  return (
    <NewRound
      courses={courses}
      pass={pass}
      // Two gates, both the covenant's. No Stripe key, no till and no
      // mention of money — the maps-key pattern. And an anonymous seat is a
      // guest: guests never cross the payment boundary, so no price is
      // rendered on their screen even though they can reach this form.
      billingOn={
        billingEnabled(process.env.STRIPE_SECRET_KEY) &&
        user != null &&
        !user.is_anonymous
      }
    />
  );
}
