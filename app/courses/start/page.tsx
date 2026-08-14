import { Screen, ScreenHeader } from "@/components/shell/screen";
import { RuleDouble } from "@/components/ui/rule";
import { StartCards, StartHint } from "@/components/course/start-cards";
import { caddyStand } from "@/lib/data/caddy-gate";

export const metadata = { title: "A new course" };

/**
 * Which room: the caddy's map, or the drafting table.
 *
 * One tap on the course book leads here rather than to either room, because
 * the two are genuinely different ways to spend an evening's planning and
 * the choice is the host's to make knowingly. Before this, the caddy hung
 * above the table's own form — so "plot it by hand" handed you the paid
 * thing anyway, which is precisely the confusion this screen removes.
 *
 * Off duty there is one card, and it is the free one: a deploy without a
 * caddy shows the drafting table exactly as it always has.
 */
export default async function StartCoursePage() {
  const stand = await caddyStand();

  return (
    <Screen>
      <RuleDouble head />
      <ScreenHeader
        eyebrow="A new course"
        title={stand.ready ? "How shall we plan it?" : "Plot a new course"}
      />
      <StartCards caddy={stand.ready} />
      <StartHint />
    </Screen>
  );
}
