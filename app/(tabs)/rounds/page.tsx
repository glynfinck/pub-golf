import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { RoundsList } from "@/components/round/rounds-list";
import { Card } from "@/components/ui/card";
import { getMyRounds, getProfile } from "@/lib/data/rounds";

export default async function RoundsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/signin");

  const rounds = await getMyRounds();

  return (
    <Screen withTabBar>
      <ScreenHeader eyebrow="History" title="Rounds" />
      {rounds.length === 0 ? (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          Every attested card ends up here — filed by date, with the winner
          and your score to par. Nothing on file yet.
        </Card>
      ) : (
        <RoundsList rounds={rounds} />
      )}
    </Screen>
  );
}
