import { redirect } from "next/navigation";
import { getRoundByCode, getSessionUser } from "@/lib/data/rounds";
import { LobbyView } from "@/components/round/lobby-view";

export default async function LobbyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.toUpperCase();

  const user = await getSessionUser();
  if (!user) redirect(`/join?code=${normalized}`);

  const bundle = await getRoundByCode(normalized);
  // Signed in but not a member (or bad code): the join screen sorts it out.
  if (!bundle || !bundle.me) redirect(`/join?code=${normalized}`);

  if (bundle.round.status === "live") redirect(`/round/${normalized}/play`);
  if (bundle.round.status === "finished")
    redirect(`/round/${normalized}/results`);

  return <LobbyView bundle={bundle} />;
}
