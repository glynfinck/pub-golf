import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRoundByCode, getSessionUser } from "@/lib/data/rounds";
import { getRoundCard } from "@/lib/data/round-card";
import { LobbyView } from "@/components/round/lobby-view";

/**
 * The title on the invite link. Read through the public card path, not the
 * member bundle — whoever unfurls this is by definition not signed in yet.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const normalized = code.toUpperCase();
  const round = await getRoundCard(normalized);
  if (!round) return { title: "Join a round" };

  return {
    title: round.name,
    description: `${round.holeCount} holes, par ${round.par}. Entry code ${normalized} — lowest swigs wins.`,
  };
}

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
