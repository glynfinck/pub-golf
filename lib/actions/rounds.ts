"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { templateForHoleCount } from "@/lib/course-templates";
import { createClient } from "@/lib/supabase/server";
import { deadlineFrom } from "@/lib/time";

const HOLE_TIMER_MINUTES = 20;

export type ActionResult = { error?: string; finished?: boolean };

const createRoundSchema = z.object({
  name: z.string().trim().min(1).max(80),
  holes: z.coerce.number().int().min(1).max(18),
  /** A saved course to copy; null plays the Invitational template. */
  courseId: z.string().uuid().nullable().optional(),
  format: z.enum(["stroke", "stableford", "match", "scramble"]),
  hazards: z.boolean(),
  timer: z.boolean(),
  softSub: z.boolean(),
  penalties: z.array(z.object({ strokes: z.number(), reason: z.string() })),
});

export type CreateRoundInput = z.infer<typeof createRoundSchema>;

export async function createRound(input: CreateRoundInput) {
  const parsed = createRoundSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const { data: round, error } = await supabase
    .from("rounds")
    .insert({
      name: parsed.name,
      host: user.id,
      ruleset: {
        format: parsed.format,
        hazards: parsed.hazards,
        holeTimerMinutes: parsed.timer ? HOLE_TIMER_MINUTES : null,
        softSubstituteScoresPar: parsed.softSub,
        penalties: parsed.penalties,
      },
    })
    .select()
    .single();
  if (error) throw new Error(`Could not create the round: ${error.message}`);

  // Seat the host before building the course — the holes RLS policy
  // checks is_round_official, which reads round_players.
  const { error: playerError } = await supabase.from("round_players").insert({
    round_id: round.id,
    profile_id: user.id,
    display_name: profile?.display_name ?? "Host",
    role: "host",
  });
  if (playerError)
    throw new Error(`Could not seat the host: ${playerError.message}`);

  // The round's holes are a snapshot — copied from a saved course or the
  // Invitational template. Editing a course later never rewrites a card.
  let template: {
    number: number;
    venue_id?: string | null;
    venue_name: string;
    drink: string;
    par: number;
    hazard: string | null;
    hazard_note: string | null;
    walk_minutes_to_next: number | null;
  }[];
  if (parsed.courseId) {
    const { data: courseHoles } = await supabase
      .from("course_holes")
      .select("*")
      .eq("course_id", parsed.courseId)
      .order("number");
    if (!courseHoles || courseHoles.length === 0)
      throw new Error("That course has no holes on it");
    template = courseHoles.map((hole) => ({
      number: hole.number,
      venue_id: hole.venue_id,
      venue_name: hole.venue_name,
      drink: hole.drink,
      par: hole.par,
      hazard: hole.hazard,
      hazard_note: hole.hazard_note,
      walk_minutes_to_next: hole.walk_minutes_to_next,
    }));
  } else {
    template = templateForHoleCount(parsed.holes);
  }
  if (!parsed.hazards)
    template = template.map((hole) => ({
      ...hole,
      hazard: null,
      hazard_note: null,
    }));

  const { error: holesError } = await supabase
    .from("holes")
    .insert(template.map((hole) => ({ ...hole, round_id: round.id })));
  if (holesError)
    throw new Error(`Could not build the course: ${holesError.message}`);

  redirect(`/round/${round.code}`);
}

export async function joinRound(code: string, playerName: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_round", {
    join_code: code,
    player_name: playerName.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath(`/round/${data}`);
  return { code: data as string };
}

/** Host or caddy flips the lobby live and opens hole 1's timer. */
export async function startRound(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const ruleset = round.ruleset as { holeTimerMinutes?: number | null };
  const { error } = await supabase
    .from("rounds")
    .update({
      status: "live",
      current_hole: 1,
      hole_phase: "live",
      tee_off_at: new Date().toISOString(),
      hole_deadline_at: holeDeadline(ruleset),
      walk_deadline_at: null,
    })
    .eq("id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Host or caddy calls the hole. Between holes the round enters the
 * walking phase — current_hole points at the UPCOMING hole and the drink
 * timer stays down until teeUpHole arms it. Past the last hole the card
 * is filed. */
export async function advanceHole(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  if (round.status === "live" && round.hole_phase === "walking")
    return { error: "The group is already walking — tee up first" };

  const { count } = await supabase
    .from("holes")
    .select("*", { count: "exact", head: true })
    .eq("round_id", round.id);
  const lastHole = count ?? 0;

  const finished = round.current_hole >= lastHole;
  if (finished) {
    const { error } = await supabase
      .from("rounds")
      .update({
        status: "finished",
        hole_deadline_at: null,
        walk_deadline_at: null,
      })
      .eq("id", round.id);
    if (error) return { error: error.message };
    revalidatePath(`/round/${code}`);
    return { finished: true };
  }

  const { data: filedHole } = await supabase
    .from("holes")
    .select("walk_minutes_to_next")
    .eq("round_id", round.id)
    .eq("number", round.current_hole)
    .maybeSingle();
  const walkMinutes = filedHole?.walk_minutes_to_next ?? null;

  const { error } = await supabase
    .from("rounds")
    .update({
      current_hole: round.current_hole + 1,
      hole_phase: "walking",
      hole_deadline_at: null,
      walk_deadline_at: deadlineFrom(Date.now(), walkMinutes),
    })
    .eq("id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return { finished: false };
}

/** The caddy calls everyone onto the tee: walking ends, the drink timer
 * arms on every card at once. */
export async function teeUpHole(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  if (round.status !== "live" || round.hole_phase !== "walking")
    return { error: "The group isn't walking" };

  const ruleset = round.ruleset as { holeTimerMinutes?: number | null };
  const { error } = await supabase
    .from("rounds")
    .update({
      hole_phase: "live",
      walk_deadline_at: null,
      hole_deadline_at: holeDeadline(ruleset),
    })
    .eq("id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

export async function upsertScore(
  code: string,
  holeNumber: number,
  swigs: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const context = await getMemberContext(supabase, code);
  if ("error" in context) return context;

  const { error } = await supabase.from("scores").upsert(
    {
      round_id: context.roundId,
      player_id: context.playerId,
      hole_number: holeNumber,
      swigs: Math.max(0, Math.round(swigs)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id,hole_number" },
  );
  if (error) return { error: error.message };
  return {};
}

export async function addPenalty(
  code: string,
  holeNumber: number,
  strokes: number,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const context = await getMemberContext(supabase, code);
  if ("error" in context) return context;

  if (!Number.isInteger(strokes) || strokes < 1 || strokes > 20)
    return { error: "Penalty strokes must be between 1 and 20" };

  const { error } = await supabase.from("penalties").insert({
    round_id: context.roundId,
    player_id: context.playerId,
    hole_number: holeNumber,
    strokes,
    reason,
    called_by: context.playerId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Marker's card: an official calls a penalty on any player. The entry is
 * attributed to the official, so "who called it" shows on the card. */
export async function callPenaltyOn(
  code: string,
  playerId: string,
  holeNumber: number,
  strokes: number,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round, playerRowId } = await getOfficiatedRound(supabase, code);

  if (!Number.isInteger(strokes) || strokes < 1 || strokes > 20)
    return { error: "Penalty strokes must be between 1 and 20" };

  const { error } = await supabase.from("penalties").insert({
    round_id: round.id,
    player_id: playerId,
    hole_number: holeNumber,
    strokes,
    reason,
    called_by: playerRowId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Marker's roam: put the round back to an earlier (or the final) hole for
 * everyone — the one action that moves the whole group. Also used by the
 * results screen to un-file the card. */
export async function reopenHole(
  code: string,
  holeNumber: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const { count } = await supabase
    .from("holes")
    .select("*", { count: "exact", head: true })
    .eq("round_id", round.id);
  const lastHole = count ?? 0;
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > lastHole)
    return { error: "That hole is not on this course" };

  const ruleset = round.ruleset as { holeTimerMinutes?: number | null };
  const { error } = await supabase
    .from("rounds")
    .update({
      status: "live",
      current_hole: holeNumber,
      hole_phase: "live",
      hole_deadline_at: holeDeadline(ruleset),
      walk_deadline_at: null,
    })
    .eq("id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Re-arm the current hole's shared countdown (caddy's discretion —
 * "Guinness takes as long as it takes"). */
export async function resetHoleTimer(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const ruleset = round.ruleset as { holeTimerMinutes?: number | null };
  if (!ruleset.holeTimerMinutes)
    return { error: "This round has no hole timer" };

  const { error } = await supabase
    .from("rounds")
    .update({ hole_deadline_at: holeDeadline(ruleset) })
    .eq("id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Host promotes a player to caddy (or back). Caddy shares officiating
 * powers: starting the round, calling holes, editing anyone's card. */
export async function setPlayerRole(
  code: string,
  playerId: string,
  role: "caddy" | "player",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const { error } = await supabase
    .from("round_players")
    .update({ role })
    .eq("id", playerId)
    .eq("round_id", round.id)
    .neq("role", "host");
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Undo a mis-tapped penalty: removes the caller's most recent penalty
 * matching this hole + reason. */
export async function removeOwnPenalty(
  code: string,
  holeNumber: number,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const context = await getMemberContext(supabase, code);
  if ("error" in context) return context;

  const { data: latest } = await supabase
    .from("penalties")
    .select("id")
    .eq("round_id", context.roundId)
    .eq("player_id", context.playerId)
    .eq("hole_number", holeNumber)
    .eq("reason", reason)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { error: "Nothing to undo" };

  const { error } = await supabase
    .from("penalties")
    .delete()
    .eq("id", latest.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Marker's card: an official sets any player's swigs on any hole. RLS
 * backs this up — the update policy checks is_round_official. */
export async function setPlayerScore(
  code: string,
  playerId: string,
  holeNumber: number,
  swigs: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const { error } = await supabase.from("scores").upsert(
    {
      round_id: round.id,
      player_id: playerId,
      hole_number: holeNumber,
      swigs: Math.max(0, Math.round(swigs)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id,hole_number" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Officials can retract a wrongly-called penalty. */
export async function removePenalty(code: string, penaltyId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const { error } = await supabase
    .from("penalties")
    .delete()
    .eq("id", penaltyId)
    .eq("round_id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

// ---------- helpers ----------

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

function holeDeadline(ruleset: { holeTimerMinutes?: number | null }) {
  return deadlineFrom(Date.now(), ruleset.holeTimerMinutes);
}

/** Fetch the round and assert the caller is host or caddy (UX guard — RLS
 * update policies are the real enforcement). Also returns the official's
 * own round_players id, for attributing marker entries. */
async function getOfficiatedRound(supabase: ServerSupabase, code: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: round } = await supabase
    .from("rounds")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (!round) throw new Error("Round not found");

  const { data: player } = await supabase
    .from("round_players")
    .select("id, role")
    .eq("round_id", round.id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!player || !["host", "caddy"].includes(player.role))
    throw new Error("Only the host or caddy can do that");

  return { round, playerRowId: player.id };
}

async function getMemberContext(supabase: ServerSupabase, code: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: round } = await supabase
    .from("rounds")
    .select("id")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (!round) return { error: "Round not found" };

  const { data: player } = await supabase
    .from("round_players")
    .select("id")
    .eq("round_id", round.id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!player) return { error: "You are not in this round" };

  return { roundId: round.id, playerId: player.id };
}
