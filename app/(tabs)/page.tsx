import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleDouble } from "@/components/ui/rule";
import { getMyRounds, getProfile } from "@/lib/data/rounds";
import { cn } from "@/lib/utils";

export default async function ClubhousePage() {
  const profile = await getProfile();
  if (!profile) redirect("/signin");

  const rounds = await getMyRounds();
  const active = rounds.find((round) => round.status !== "finished");
  const past = rounds.filter((round) => round.status === "finished");

  return (
    <Screen withTabBar>
      <RuleDouble />
      <ScreenHeader
        eyebrow="The Clubhouse"
        title={`Evening, ${profile.display_name.split(" ")[0]}`}
        action={<Avatar name={profile.display_name} />}
      />

      {active ? (
        <Card className="gap-0 px-4 border-l-4 border-l-marker">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-hazard">
              {active.status === "live" ? "● Live now" : "● In the lobby"}
            </span>
            <span className="tabular text-xs text-muted-foreground">
              {active.status === "live"
                ? `Hole ${active.current_hole} of ${active.hole_count}`
                : `${active.hole_count} holes`}
            </span>
          </div>
          <h2 className="mt-1.5 font-serif text-lg">{active.name}</h2>
          <p className="text-xs text-muted-foreground">
            Entry code {active.code}
            {active.role !== "player" ? ` · you are the ${active.role}` : ""}
          </p>
          <Link
            href={`/round/${active.code}`}
            className={cn(buttonVariants(), "mt-3 w-full")}
          >
            {active.status === "live" ? "Open scorecard" : "Back to the lobby"}
          </Link>
        </Card>
      ) : (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          No round on the card tonight. Start one, or join with a code.
        </Card>
      )}

      <div className="flex gap-3">
        <Link href="/new" className={cn(buttonVariants(), "flex-1")}>
          New round
        </Link>
        <Link
          href="/join"
          className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
        >
          Join with code
        </Link>
      </div>

      {past.length > 0 ? (
        <section>
          <h3 className="eyebrow mb-2">Past rounds</h3>
          <Card className="gap-0 px-4 py-1">
            {past.map((round, index) => (
              <Link
                key={round.code}
                href={`/round/${round.code}/results`}
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
                    })}{" "}
                    · {round.hole_count} holes
                  </span>
                </span>
                <span className="text-xs font-bold text-fairway">
                  View card
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </Screen>
  );
}
