import { redirect } from "next/navigation";
import { getRoundByCode, getSessionUser } from "@/lib/data/rounds";
import { MarkersCardView } from "@/components/round/markers-card-view";

export const metadata = { title: "The marker's card" };

export default async function MarkersCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ hole?: string }>;
}) {
  const [{ code }, { hole }] = await Promise.all([params, searchParams]);
  const normalized = code.toUpperCase();

  const user = await getSessionUser();
  if (!user) redirect(`/round/${normalized}/rescue`);

  const bundle = await getRoundByCode(normalized);
  if (!bundle || !bundle.me) redirect(`/round/${normalized}/rescue`);

  // The marker's card is the officials' table — players get their own card.
  if (!["host", "caddy"].includes(bundle.me.role))
    redirect(`/round/${normalized}/play`);

  // ?hole=N roams the record without moving the round. Default: the live
  // hole (or the last hole once the card is filed).
  const lastHole = bundle.holes.length;
  const requested = Number.parseInt(hole ?? "", 10);
  const viewedHole = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), Math.max(lastHole, 1))
    : Math.min(bundle.round.current_hole, Math.max(lastHole, 1));

  return <MarkersCardView bundle={bundle} viewedHole={viewedHole} />;
}
