import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { RoundsList } from "@/components/round/rounds-list";
import { Card } from "@/components/ui/card";
import { signInPath } from "@/lib/auth-paths";
import { getMyRounds, getProfile } from "@/lib/data/rounds";

export const metadata = { title: "Rounds" };

export default async function RoundsPage() {
  // One wait, not two — the pause on a tab switch is these round trips.
  const [profile, rounds] = await Promise.all([getProfile(), getMyRounds()]);
  // Carry the destination: signing in from a deep link should land back
  // on it, not dump the visitor at the clubhouse.
  if (!profile) redirect(signInPath("/rounds"));

  return (
    <Screen withTabBar>
      <ScreenHeader eyebrow="History" title="Rounds" />
      {rounds.length === 0 ? (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          Every attested card ends up here — filed by date, with the winner and
          your score to par. Nothing on file yet.
        </Card>
      ) : (
        <RoundsList rounds={rounds} />
      )}
    </Screen>
  );
}
