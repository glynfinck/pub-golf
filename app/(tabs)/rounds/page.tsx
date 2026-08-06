import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Card } from "@/components/ui/card";
import { getMyRounds, getProfile } from "@/lib/data/rounds";
import { cn } from "@/lib/utils";

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
        <Card className="gap-0 px-4 py-1">
          {rounds.map((round, index) => (
            <Link
              key={round.code}
              href={`/round/${round.code}${round.status === "finished" ? "/results" : ""}`}
              className={cn(
                "flex items-center justify-between py-3",
                index > 0 && "border-t border-border",
              )}
            >
              <span>
                <span className="block text-sm font-semibold">
                  {round.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(round.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  · {round.hole_count} holes · code {round.code}
                </span>
              </span>
              <span
                className={cn(
                  "text-[11px] font-bold uppercase tracking-wide",
                  round.status === "live"
                    ? "text-hazard"
                    : round.status === "lobby"
                      ? "text-marker"
                      : "text-muted-foreground",
                )}
              >
                {round.status}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </Screen>
  );
}
