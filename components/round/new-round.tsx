"use client";

import { useSyncExternalStore } from "react";
import { NewRoundForm } from "@/components/round/new-round-form";
import type { DayPass } from "@/lib/data/billing";
import type { MyCourse } from "@/lib/data/courses";
import { parkedDraft, subscribeToDraft } from "@/lib/new-round-draft";

/**
 * The new-round screen's door, and the one thing standing between the form
 * and a hydration mismatch.
 *
 * A host who steps out to buy the green fee parks their half-set table in
 * sessionStorage, which the server cannot see. `useSyncExternalStore` is the
 * house's hydration guard for exactly this: the server snapshot is null, so
 * the server's HTML and the first client paint agree, and the parked draft
 * arrives on the tick after. Remounting on the key is what lets the form
 * keep initialising its dozen `useState` calls from props — no setState in
 * an effect body, which the react-hooks rules would refuse anyway.
 */
export function NewRound({
  courses,
  pass,
  billingOn,
}: {
  courses: MyCourse[];
  pass: DayPass | null;
  billingOn: boolean;
}) {
  const draft = useSyncExternalStore(subscribeToDraft, parkedDraft, () => null);

  return (
    <NewRoundForm
      key={draft ? "parked" : "fresh"}
      courses={courses}
      pass={pass}
      billingOn={billingOn}
      draft={draft}
    />
  );
}
