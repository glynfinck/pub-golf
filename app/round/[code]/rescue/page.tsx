import { redirect } from "next/navigation";
import { getRoundCard } from "@/lib/data/round-card";
import { getRoundByCode, getSessionUser } from "@/lib/data/rounds";
import { RescueView } from "@/components/round/rescue-view";

/**
 * The door for a phone that lost its card: every round route sends a
 * seatless visitor here instead of the blind join form, because the link
 * they're holding already says which round they came for.
 *
 * The round's name comes through the public card path (SECURITY DEFINER,
 * nameless) — the visitor by definition has no membership to read with.
 * The guest list itself waits for at least an anonymous session, behind
 * one tap in the client view, so a crawler unfurling a shared link still
 * reads no names.
 */
export const metadata = { title: "Back on the card" };

export default async function RescuePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.toUpperCase();

  const round = await getRoundCard(normalized);
  if (!round) redirect(`/join?code=${normalized}`);

  const user = await getSessionUser();
  if (user) {
    const bundle = await getRoundByCode(normalized);
    // Already seated: the round page routes to the right screen itself.
    if (bundle?.me) redirect(`/round/${normalized}`);
  }

  return (
    <RescueView
      code={normalized}
      roundName={round.name}
      hasSession={user !== null}
    />
  );
}
