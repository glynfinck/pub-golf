import { redirect } from "next/navigation";
import { getRoundByCode, getSessionUser } from "@/lib/data/rounds";
import { PlayView } from "@/components/round/play-view";
import { WalkingView } from "@/components/round/walking-view";

export const metadata = { title: "On the course" };

export default async function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.toUpperCase();

  const user = await getSessionUser();
  if (!user) redirect(`/round/${normalized}/rescue`);

  const bundle = await getRoundByCode(normalized);
  if (!bundle || !bundle.me) redirect(`/round/${normalized}/rescue`);

  if (bundle.round.status === "lobby") redirect(`/round/${normalized}`);
  if (bundle.round.status === "finished")
    redirect(`/round/${normalized}/results`);

  // Between holes the whole group is on the walk — same URL, no timer.
  if (bundle.round.hole_phase === "walking")
    return <WalkingView bundle={bundle} />;

  return <PlayView bundle={bundle} />;
}
