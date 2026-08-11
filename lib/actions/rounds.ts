"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { reverseCourse, templateForHoleCount } from "@/lib/course-templates";
import {
  MULLIGAN_STROKES,
  MAX_MULLIGANS,
  MAX_HANDICAP,
} from "@/lib/rules";
import { rematchName } from "@/lib/rematch";
import { legInto, legsAfterSwap, type HoleLeg } from "@/lib/round-holes";
import { readRuleset, stampMembers } from "@/lib/ruleset";
import { createClient } from "@/lib/supabase/server";
import { deadlineFrom } from "@/lib/time";
import type { Json } from "@/types/database";

export type ActionResult = { error?: string; finished?: boolean };

const createRoundSchema = z.object({
  name: z.string().trim().min(1).max(80),
  holes: z.coerce.number().int().min(1).max(18),
  /** A saved course to copy; null plays the Invitational template. */
  courseId: z.string().uuid().nullable().optional(),
  /** Play the course back down — last pub first, walks intact. */
  reversed: z.boolean().default(false),
  format: z.enum(["stroke", "stableford", "match", "scramble"]),
  hazards: z.boolean(),
  timer: z.boolean(),
  softSub: z.boolean(),
  /** Planned minutes at each pub — the 19th-hole estimate, and the shot
   * clock's length when `timer` is on. */
  minutesPerPub: z.coerce.number().int().min(5).max(60).default(20),
  /** The advertised first tee (ISO). Advisory — printed on the lobby and
   * the invite; the host still tees off whenever the group is stood there. */
  scheduledTeeOff: z.string().nullable().optional(),
  /** Whether the host is handicapping this round at all. */
  handicaps: z.boolean().default(false),
  /** Mulligans per player for the whole round; 0 turns them off. */
  mulligans: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_MULLIGANS)
    .default(0),
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
        // The shot clock runs at the planned pub pace — one number, two jobs.
        holeTimerMinutes: parsed.timer ? parsed.minutesPerPub : null,
        minutesPerPub: parsed.minutesPerPub,
        scheduledTeeOff: parsed.scheduledTeeOff ?? null,
        softSubstituteScoresPar: parsed.softSub,
        penalties: parsed.penalties,
        handicaps: parsed.handicaps,
        mulligans: parsed.mulligans,
        // Snapshotted, not read from the constant at scoring time: changing
        // the house price later must never rescore a round already played.
        mulliganStrokes: MULLIGAN_STROKES,
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
    penalties: Json;
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
      penalties: hole.penalties,
      walk_minutes_to_next: hole.walk_minutes_to_next,
    }));
  } else {
    template = templateForHoleCount(parsed.holes);
  }
  if (parsed.reversed) template = reverseCourse(template);
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

/** A seatless phone knocks on a card it says is its own. Only marks the
 * seat — the hand change waits for an official's approveSeatRescue, so
 * picking a mate's name off the list buys nothing but a caddy's frown. */
export async function requestSeatRescue(
  code: string,
  seatId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_seat_rescue", {
    join_code: code,
    seat: seatId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** An official waves the knocker in: the seat — scores, penalties, name —
 * moves onto the requester's fresh session. The function re-checks
 * everything at approval time; this wrapper is the usual UX guard. */
export async function approveSeatRescue(
  code: string,
  seatId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  await getOfficiatedRound(supabase, code);

  const { error } = await supabase.rpc("approve_seat_rescue", {
    seat: seatId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** "Not them" — an official turns a knock away and the seat stays put. */
export async function dismissSeatRescue(
  code: string,
  seatId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  await getOfficiatedRound(supabase, code);

  const { error } = await supabase.rpc("dismiss_seat_rescue", {
    seat: seatId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** An official strikes a seat from the round — the duplicate a broken
 * cookie made, or a gatecrasher. The seat's own scores and penalties go
 * with it on the cascades; penalties it called on other cards stay. RLS
 * ("officials strike seats") is the enforcement and it never matches the
 * host seat; a filtered delete returns no rows, which is why the returned
 * rows are checked rather than the error. */
export async function strikeSeat(
  code: string,
  playerId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const { data: struck, error } = await supabase
    .from("round_players")
    .delete()
    .eq("id", playerId)
    .eq("round_id", round.id)
    .neq("role", "host")
    .select("id");
  if (error) return { error: error.message };
  if (!struck || struck.length === 0)
    return { error: "That seat is not yours to strike" };

  revalidatePath(`/round/${code}`);
  return {};
}

/**
 * Host or caddy flips the lobby live and opens hole 1's timer — and, for a
 * host inside a green fee's window, stamps the round covered.
 *
 * Tee-off is the one moment the members' flag is decided, and it is decided
 * once. A pass that runs out, or is refunded, at hole 4 cannot take the
 * league off a table that is already playing; a pass bought at hole 4 cannot
 * add it either. That is the whole point of putting the grant in the ruleset
 * snapshot rather than reading entitlements at render time.
 *
 * The check is a definer function rather than a read of `entitlements`
 * because the caddy tees rounds off too, and a day pass is visible to its
 * buyer alone.
 */
export async function startRound(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const ruleset = readRuleset(round.ruleset);
  const teeOff = {
    status: "live",
    current_hole: 1,
    hole_phase: "live",
    tee_off_at: new Date().toISOString(),
    hole_deadline_at: holeDeadline(ruleset),
    walk_deadline_at: null,
  };

  const { data: covered } = await supabase.rpc("holds_day_pass", {
    who: round.host,
  });
  const stamping = covered === true && !ruleset.members;

  let { error } = await supabase
    .from("rounds")
    .update(
      stamping ? { ...teeOff, ruleset: stampMembers(round.ruleset) } : teeOff,
    )
    .eq("id", round.id);

  // The pass ran out in the moment between asking and writing, and the guard
  // refused the stamp. Tee the round off anyway: a green fee is allowed to
  // buy nothing, and is never allowed to stop a group getting started.
  if (error && stamping) {
    ({ error } = await supabase
      .from("rounds")
      .update(teeOff)
      .eq("id", round.id));
  }
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

  const ruleset = readRuleset(round.ruleset);
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

/**
 * Take a mulligan: wipe this hole and start the drink again, for the
 * price of a half pint on the card.
 *
 * The allowance is for the whole round, so the count is read across every
 * hole. This check is the friendly message — the real enforcement is the
 * scores trigger, which is the only thing an attacker with the anon key
 * cannot route around.
 */
export async function takeMulligan(
  code: string,
  holeNumber: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const context = await getMemberContext(supabase, code);
  if ("error" in context) return context;

  const { data: round } = await supabase
    .from("rounds")
    .select("ruleset")
    .eq("id", context.roundId)
    .maybeSingle();
  const ruleset = readRuleset(round?.ruleset);
  if (ruleset.mulligans < 1)
    return { error: "This round isn't playing mulligans" };

  const { data: myScores } = await supabase
    .from("scores")
    .select("hole_number, mulligans")
    .eq("round_id", context.roundId)
    .eq("player_id", context.playerId);

  const used = (myScores ?? []).reduce(
    (sum, score) => sum + score.mulligans,
    0,
  );
  if (used >= ruleset.mulligans)
    return { error: "No mulligans left on your card" };

  const onThisHole =
    (myScores ?? []).find((score) => score.hole_number === holeNumber)
      ?.mulligans ?? 0;

  const { error } = await supabase.from("scores").upsert(
    {
      round_id: context.roundId,
      player_id: context.playerId,
      hole_number: holeNumber,
      swigs: 0,
      mulligans: onThisHole + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id,hole_number" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  return {};
}

/** Marker's card: an official corrects the mulligans on a player-hole.
 * Officials only — a player raising their own allowance is exactly what the
 * scores trigger exists to stop. */
export async function setPlayerMulligans(
  code: string,
  playerId: string,
  holeNumber: number,
  count: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const ruleset = readRuleset(round.ruleset);
  const next = Math.max(0, Math.round(count));
  if (next > MAX_MULLIGANS)
    return { error: "That is more mulligans than any round allows" };

  const { data: existing } = await supabase
    .from("scores")
    .select("hole_number, mulligans")
    .eq("round_id", round.id)
    .eq("player_id", playerId);

  const elsewhere = (existing ?? [])
    .filter((score) => score.hole_number !== holeNumber)
    .reduce((sum, score) => sum + score.mulligans, 0);
  if (elsewhere + next > ruleset.mulligans)
    return { error: "That is over this round's allowance" };

  const { error } = await supabase.from("scores").upsert(
    {
      round_id: round.id,
      player_id: playerId,
      hole_number: holeNumber,
      mulligans: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id,hole_number" },
  );
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

  const ruleset = readRuleset(round.ruleset);
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

  // Server-side, because a client push cannot win this race. Reopening
  // fires two refreshes at the tapping phone — the realtime echo, and the
  // one Next runs when this action's revalidate comes back — and a refresh
  // landing inside a router.push cancels it, dropping the caddy back on the
  // marker's card as if the button had done nothing. A redirect is part of
  // the action's own response, so there is nothing left to interrupt.
  // Both callers want it: the marker's card and the results page alike are
  // reopening the round to play it.
  redirect(`/round/${code}/play`);
}

const swapPubSchema = z.object({
  /** The Places cache row, when the pub came out of a search. Null is a pub
   * named by hand, which is how a locked door gets answered at 9pm. */
  venue_id: z.string().uuid().nullable(),
  venue_name: z.string().trim().min(1).max(120),
});

export type SwapPubInput = z.infer<typeof swapPubSchema>;

/**
 * The pub on a hole changes hands mid-round — the shutters are down, the
 * kitchen has stopped serving, the place turns out to be a members' club.
 *
 * Only the venue moves. Par, the drink, the hazard and the hole's local
 * rules belong to the hole, not to the pub, and every score and penalty
 * already written keys on the hole *number*, so the card is untouched: the
 * round carries on with the same standings at a different address.
 *
 * Coordinates are read from the venues cache here rather than taken from
 * the caller — the walk is the round's own measurement, not something a
 * phone gets to assert.
 */
export async function swapHolePub(
  code: string,
  holeNumber: number,
  pub: SwapPubInput,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const parsed = swapPubSchema.safeParse(pub);
  if (!parsed.success) return { error: "That pub needs a name" };

  const { data: holes } = await supabase
    .from("holes")
    .select("id, number, walk_minutes_to_next, venue:venues(lat, lng)")
    .eq("round_id", round.id)
    .order("number");
  const target = holes?.find((hole) => hole.number === holeNumber);
  if (!holes || !target) return { error: "That hole is not on this course" };

  let coords: { lat: number; lng: number } | null = null;
  if (parsed.data.venue_id) {
    const { data: venue } = await supabase
      .from("venues")
      .select("lat, lng")
      .eq("id", parsed.data.venue_id)
      .maybeSingle();
    if (!venue) return { error: "That pub is not in the book" };
    coords =
      venue.lat != null && venue.lng != null
        ? { lat: venue.lat, lng: venue.lng }
        : null;
  }

  const { error } = await supabase
    .from("holes")
    .update({
      venue_id: parsed.data.venue_id,
      venue_name: parsed.data.venue_name,
    })
    .eq("id", target.id);
  if (error) return { error: error.message };

  // The walk in and the walk out were both measured to a pub that is no
  // longer there. Re-measure what can be measured; null the rest.
  const legs = legsAfterSwap(
    holes.map(
      (hole): HoleLeg => ({
        number: hole.number,
        coords:
          hole.venue?.lat != null && hole.venue.lng != null
            ? { lat: hole.venue.lat, lng: hole.venue.lng }
            : null,
        walk_minutes_to_next: hole.walk_minutes_to_next,
      }),
    ),
    holeNumber,
    coords,
  );
  for (const leg of legs) {
    if (
      leg.walk_minutes_to_next ===
      holes.find((hole) => hole.number === leg.number)?.walk_minutes_to_next
    )
      continue;
    await supabase
      .from("holes")
      .update({ walk_minutes_to_next: leg.walk_minutes_to_next })
      .eq("round_id", round.id)
      .eq("number", leg.number);
  }

  // A group already walking to this hole is walking somewhere else now, and
  // the countdown on every phone is measured to the old door. Re-arm it from
  // the new leg — or drop it to "when you get there", which is what a walk
  // with nothing to measure has always said.
  if (
    round.status === "live" &&
    round.hole_phase === "walking" &&
    round.current_hole === holeNumber
  ) {
    await supabase
      .from("rounds")
      .update({
        walk_deadline_at: deadlineFrom(Date.now(), legInto(legs, holeNumber)),
      })
      .eq("id", round.id);
  }

  revalidatePath(`/round/${code}`);
  revalidatePath(`/round/${code}/play`);
  revalidatePath(`/round/${code}/card`);
  return {};
}

/** Re-arm the current hole's shared countdown (caddy's discretion —
 * "Guinness takes as long as it takes"). */
export async function resetHoleTimer(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const ruleset = readRuleset(round.ruleset);
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

/**
 * Officials set a player's handicap — the strokes that come off their gross
 * to give the net the round is won on.
 *
 * Not gated on the lobby: players can join a round that has already teed off,
 * and the marker's card is already where officials put the record straight
 * after the fact. The round_players trigger is what actually stops a player
 * flattering their own card.
 */
export async function setPlayerHandicap(
  code: string,
  playerId: string,
  handicap: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  const next = Math.round(handicap);
  if (!Number.isFinite(next) || next < 0 || next > MAX_HANDICAP)
    return { error: `A handicap runs from 0 to ${MAX_HANDICAP}` };

  const { error } = await supabase
    .from("round_players")
    .update({ handicap: next })
    .eq("id", playerId)
    .eq("round_id", round.id);
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

/**
 * The recap left the app for a group chat — phase one's fourth number.
 *
 * The other three moments in the funnel are already facts in the schema
 * (a round's created_at, a seat's joined_at, a card's finished_at); a share
 * is a tap on a phone and reaches Postgres only if something sends it. The
 * whole table shares the card, guests included, so the count goes through
 * `record_recap_share` — a definer function that admits members — rather
 * than an update a guest could never make.
 *
 * Deliberately returns nothing and swallows its errors: the card has already
 * gone by the time this runs, and a counter that failed is not something to
 * put on screen.
 */
export async function recordRecapShare(code: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("record_recap_share", { join_code: code.toUpperCase() });
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

/** The host renames the round — the name column only; the ruleset snapshot
 * and the code stay exactly as dealt. */
export async function renameRound(
  code: string,
  name: string,
): Promise<ActionResult> {
  const parsed = z.string().trim().min(1).max(80).safeParse(name);
  if (!parsed.success)
    return { error: "A round needs a name — 80 letters at most" };

  const supabase = await createClient();
  const { round } = await getHostedRound(supabase, code);

  const { error } = await supabase
    .from("rounds")
    .update({ name: parsed.data })
    .eq("id", round.id);
  if (error) return { error: error.message };
  revalidatePath(`/round/${code}`);
  revalidatePath("/rounds");
  revalidatePath("/");
  return {};
}

/** The host tears up the card: the round and everything on it — holes,
 * seats, scores, penalties — goes with it, on the FK cascades. Host only,
 * never the caddy: officiating runs a round, it does not own one. RLS is
 * the real enforcement ("hosts delete rounds"); a filtered delete removes
 * nothing and returns nothing, which is why the returned rows are checked
 * rather than the error. */
export async function deleteRound(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getHostedRound(supabase, code);

  const { data: deleted, error } = await supabase
    .from("rounds")
    .delete()
    .eq("id", round.id)
    .select("id");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0)
    return { error: "Only the host can tear up this card" };

  revalidatePath("/rounds");
  revalidatePath("/");
  return {};
}

/** Same again: a brand-new round off this one's own snapshot — its ruleset
 * and its holes, never the saved course, which may have changed since the
 * night was built. Fresh code, fresh lobby, tee time cleared, host seated;
 * everyone else arrives through join_round with the new code, the same
 * door as any round. */
export async function rehostRound(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round, userId } = await getHostedRound(supabase, code);

  const { data: holes } = await supabase
    .from("holes")
    .select(
      "number, venue_id, venue_name, drink, par, hazard, hazard_note, penalties, walk_minutes_to_next",
    )
    .eq("round_id", round.id)
    .order("number");
  if (!holes || holes.length === 0)
    return { error: "This round has no holes to replay" };

  // Through readRuleset, never a re-cast: the copy is the old snapshot
  // normalised, with the one advisory field a new night cannot inherit.
  // `members` is deliberately not in the list either — a rematch is a new
  // round and is covered only if a live pass is standing when it tees off.
  // The INSERT half of the members guard would refuse it here regardless.
  const old = readRuleset(round.ruleset);
  const { data: next, error } = await supabase
    .from("rounds")
    .insert({
      name: rematchName(round.name).slice(0, 80),
      host: userId,
      ruleset: {
        format: old.format,
        hazards: old.hazards,
        holeTimerMinutes: old.holeTimerMinutes,
        minutesPerPub: old.minutesPerPub,
        scheduledTeeOff: null,
        softSubstituteScoresPar: old.softSubstituteScoresPar,
        penalties: old.penalties,
        handicaps: old.handicaps,
        mulligans: old.mulligans,
        mulliganStrokes: old.mulliganStrokes,
      },
    })
    .select("id, code")
    .single();
  if (error) return { error: `Could not set the table: ${error.message}` };

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  // Seat the host before the holes — the holes policy reads round_players.
  const { error: playerError } = await supabase.from("round_players").insert({
    round_id: next.id,
    profile_id: userId,
    display_name: profile?.display_name ?? "Host",
    role: "host",
  });
  if (playerError) {
    // Don't leave a half-set table behind — the delete policy lets us tidy.
    await supabase.from("rounds").delete().eq("id", next.id);
    return { error: `Could not seat the host: ${playerError.message}` };
  }

  const { error: holesError } = await supabase
    .from("holes")
    .insert(holes.map((hole) => ({ ...hole, round_id: next.id })));
  if (holesError) {
    await supabase.from("rounds").delete().eq("id", next.id);
    return { error: `Could not build the course: ${holesError.message}` };
  }

  redirect(`/round/${next.code}`);
}

/** An official files the card early: the round ends now, for everyone, and
 * the standings stand as played. Honest maths — unplayed holes take the
 * substitute for every card alike, so stopping short buys nobody a
 * stroke. */
export async function fileCardEarly(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round } = await getOfficiatedRound(supabase, code);

  if (round.status !== "live")
    return { error: "Only a live round can be filed early" };

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
  revalidatePath("/rounds");
  revalidatePath("/");
  return { finished: true };
}

/** The round's course, back into the book: copies this round's holes —
 * walks, hazards and local rules as they were actually played — into a
 * saved course owned by the host, so the night can be built on again. */
export async function saveRoundAsCourse(code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { round, userId } = await getHostedRound(supabase, code);

  const { data: holes } = await supabase
    .from("holes")
    .select(
      "number, venue_id, venue_name, drink, par, hazard, hazard_note, penalties, walk_minutes_to_next",
    )
    .eq("round_id", round.id)
    .order("number");
  if (!holes || holes.length === 0)
    return { error: "This round has no holes to save" };

  const { data: course, error } = await supabase
    .from("courses")
    .insert({ owner: userId, name: round.name })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: holesError } = await supabase
    .from("course_holes")
    .insert(holes.map((hole) => ({ ...hole, course_id: course.id })));
  if (holesError) {
    // Don't leave a hole-less course behind.
    await supabase.from("courses").delete().eq("id", course.id);
    return { error: holesError.message };
  }

  revalidatePath("/courses");
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

/** Fetch the round and assert the caller is its host — the manage sheet's
 * lifecycle actions (tear up, rematch, rename, save the course) are the
 * host's alone, and the caddy is deliberately not enough. UX guard like
 * getOfficiatedRound; the delete policy is the enforcement that holds. */
async function getHostedRound(supabase: ServerSupabase, code: string) {
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
  if (round.host !== user.id) throw new Error("Only the host can do that");

  return { round, userId: user.id };
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
