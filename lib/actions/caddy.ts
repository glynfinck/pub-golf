"use server";

import { headers } from "next/headers";

import { readBrief, candidateFloor, type CaddyBrief } from "@/lib/caddy/brief";
import {
  CADDY_BUDGET_NOTE,
  caddyBudgetMicroPence,
  withinBudget,
} from "@/lib/caddy/budget";
import { askCaddy, type CaddyTurnRecord } from "@/lib/caddy/client";
import { caddyEnabled } from "@/lib/caddy/credentials";
import { showCaddyDiagnostics } from "@/lib/caddy/readiness";
import {
  buildCandidates,
  type CandidateDossier,
  type PubSource,
} from "@/lib/caddy/dossier";
import { gatherPubs, type GatheredPub } from "@/lib/caddy/places";
import { planFailureNote, type PlannedCourse } from "@/lib/caddy/plan";
import { ipBiasFrom } from "@/lib/pub-search";
import { primaryLanguage } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

/**
 * The caddy's server side: gather once, then hold a conversation.
 *
 * Every call answers the same shape — a card, or a plain line and no card. A
 * failure is never charged and never counted: a turn row is written only where
 * a card actually arrived, which is the whole of the "nothing counts unless a
 * card arrives" promise, held in one place.
 *
 * Fair use is enforced in Postgres (`guard_caddy_fair_use`), not here. This
 * action simply lets the insert fail and reads the `42501` — the same
 * arrangement every other guarded write in this app uses, because every action
 * reaches the database on the caller's own session and RLS is the only real
 * enforcement.
 */

export interface CaddyResult {
  sessionId?: string;
  course?: PlannedCourse;
  /** Which holes moved on a tweak, so the screen can hold the rest still. */
  changed?: number[];
  error?: string;
  /** The vendor's own complaint, redacted. Set only off production, and read
   * only by the staging note — never rendered to a player. */
  detail?: string;
}

const NO_CADDY = "The caddy isn't on duty here.";
const NEEDS_FEE = "The caddy comes with the green fee.";
const THIN_PATCH =
  "Not enough pubs in that patch for the round you asked for. Widen the patch, or drop a few holes.";
// One line for both ceilings. A host who meets the turn cap and a host who
// meets the budget are in the same position and are told the same thing —
// which is also why neither message names the number it hit.
const FULL_SHIFT = CADDY_BUDGET_NOTE;

/** The signed-in host, or null. Guests never cross this boundary: hosting a
 * round takes a Google sign-in and so does planning one. */
async function host() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return null;
  return { supabase, user };
}

/** The buyer's live green fee, if there is one. Read on the host's own
 * session — the entitlements policy shows a round-less row to its owner
 * alone, which is exactly the audience. */
async function liveFee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("entitlements")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("kind", "green_fee")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("expires_at", { ascending: false, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** The `venues` rows for a gather, upserted exactly as the builder's own
 * search does it. This is what gives every generated hole a real venue id and
 * real coordinates — and it is only the venue, never the atmosphere: the
 * facts and the review snippets ride the session and are dropped with it. */
async function cachePubs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gathered: GatheredPub[],
): Promise<PubSource[]> {
  if (!gathered.length) return [];
  const { data: venues, error } = await supabase
    .from("venues")
    .upsert(
      gathered.map((pub) => ({
        google_place_id: pub.googlePlaceId,
        name: pub.name,
        address: pub.address,
        lat: pub.lat,
        lng: pub.lng,
        rating: pub.rating,
        review_count: pub.reviewCount,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: "google_place_id" },
    )
    .select();
  if (error || !venues) return [];

  const idByPlace = new Map(
    venues.map((venue) => [venue.google_place_id, venue.id]),
  );
  // Google's relevance order, preserved — the caddy is told to route and
  // dress, not to re-rank a search result.
  return gathered
    .map((pub) => {
      const venueId = idByPlace.get(pub.googlePlaceId);
      if (!venueId) return null;
      // The Google id has done its job — matching the upsert back to the row.
      // What the caddy is briefed on is the venue id, which is what a hole
      // will actually hang on.
      return {
        venueId,
        name: pub.name,
        address: pub.address,
        rating: pub.rating,
        reviewCount: pub.reviewCount,
        lat: pub.lat,
        lng: pub.lng,
        priceLevel: pub.priceLevel,
        facts: pub.facts,
        editorial: pub.editorial,
        reviews: pub.reviews,
      } satisfies PubSource;
    })
    .filter((pub): pub is PubSource => pub !== null);
}

/** Where a pinned tee actually is, from the cache the pub search filled. */
async function pinCoords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
) {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (!wanted.length) return new Map<string, PubSource>();
  const { data } = await supabase
    .from("venues")
    .select("id, name, address, lat, lng, rating, review_count")
    .in("id", wanted);
  return new Map(
    (data ?? []).map((venue) => [
      venue.id,
      {
        venueId: venue.id,
        name: venue.name,
        address: venue.address,
        rating: venue.rating,
        reviewCount: venue.review_count,
        lat: venue.lat,
        lng: venue.lng,
        priceLevel: null,
        facts: {
          outdoorSeating: null,
          allowsDogs: null,
          servesCocktails: null,
          liveMusic: null,
          goodForWatchingSports: null,
          goodForGroups: null,
        },
        editorial: null,
        reviews: [],
      } satisfies PubSource,
    ]),
  );
}

/**
 * Plan a course: gather the patch, brief the caddy, keep the card.
 *
 * The gather happens once. Its dossier is written onto the session and every
 * later turn — every roll, every ask — re-reads it rather than calling Google
 * again, which is why a re-roll costs one model call and no Places quota.
 */
export async function planCourse(rawBrief: unknown): Promise<CaddyResult> {
  if (!caddyEnabled(process.env)) return { error: NO_CADDY };
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) return { error: NO_CADDY };

  const brief = readBrief(rawBrief);
  if (!brief) return { error: "Tell the caddy where you're drinking." };

  const session = await host();
  if (!session) return { error: "Planning a course takes a sign-in." };
  const { supabase, user } = session;

  const fee = await liveFee(supabase, user.id);
  if (!fee) return { error: NEEDS_FEE };

  const pins = await pinCoords(supabase, [
    brief.startVenueId,
    brief.finishVenueId,
  ]);
  const start = pins.get(brief.startVenueId ?? "");
  const finish = pins.get(brief.finishVenueId ?? "");

  const requestHeaders = await headers();
  const gathered = await gatherPubs({
    key: placesKey,
    where: brief.where,
    start: start?.lat != null && start.lng != null
      ? { lat: start.lat, lng: start.lng }
      : null,
    finish: finish?.lat != null && finish.lng != null
      ? { lat: finish.lat, lng: finish.lng }
      : null,
    ipBias: ipBiasFrom(requestHeaders),
    language: primaryLanguage(requestHeaders.get("accept-language")),
  });

  const cached = await cachePubs(supabase, gathered);
  // Pinned tees always join the table, whatever the gather returned.
  const withPins = [
    ...[start, finish].filter((pin): pin is PubSource => Boolean(pin)),
    ...cached,
  ];
  const candidates = buildCandidates(
    withPins,
    [brief.startVenueId, brief.finishVenueId].filter((id): id is string =>
      Boolean(id),
    ),
  );

  // A thin patch is an honest refusal, never a padded card — and it costs
  // nothing, because no turn row is written.
  if (candidates.length < candidateFloor(brief.holes)) {
    return { error: THIN_PATCH };
  }

  const { data: created, error: sessionError } = await supabase
    .from("caddy_sessions")
    .insert({
      host: user.id,
      entitlement_id: fee.id,
      brief: brief as unknown as never,
      dossier: candidates as unknown as never,
    })
    .select("id")
    .single();
  if (sessionError || !created) return { error: NO_CADDY };

  return turn({
    supabase,
    userId: user.id,
    sessionId: created.id,
    brief,
    candidates,
    history: [],
    kind: "plan",
  });
}

/** Roll a fresh card, or answer something the host said. Both re-read the
 * patch from the session — no Google, warm cache, short answer. */
export async function askTheCaddy(input: {
  sessionId: string;
  ask?: string;
  holeNumber?: number | null;
  roll?: boolean;
}): Promise<CaddyResult> {
  if (!caddyEnabled(process.env)) return { error: NO_CADDY };

  const session = await host();
  if (!session) return { error: "Planning a course takes a sign-in." };
  const { supabase, user } = session;

  // RLS scopes this to the host's own session; a row that reads back is proof
  // it was theirs.
  const { data: row } = await supabase
    .from("caddy_sessions")
    .select("id, brief, dossier")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (!row) return { error: "That patch isn't on your table." };

  const brief = readBrief(row.brief);
  const candidates = (row.dossier ?? []) as unknown as CandidateDossier[];
  if (!brief || !Array.isArray(candidates) || !candidates.length) {
    return { error: "That patch has been put away. Plan a fresh one." };
  }

  // Cards only. A failed turn is a real row — it carries what the attempt cost
  // — but its `result` is empty, and replaying an empty card into the
  // transcript would show the caddy a hole-less course as though it had
  // written one.
  const { data: turns } = await supabase
    .from("caddy_turns")
    .select("kind, ask, result")
    .eq("session_id", input.sessionId)
    .eq("failed", false)
    .order("created_at", { ascending: true });

  const history: CaddyTurnRecord[] = (turns ?? []).map((entry) => ({
    kind: entry.kind as CaddyTurnRecord["kind"],
    ask: entry.ask,
    course: entry.result as unknown as PlannedCourse,
  }));

  return turn({
    supabase,
    userId: user.id,
    sessionId: input.sessionId,
    brief,
    candidates,
    history,
    kind: input.roll ? "roll" : "tweak",
    ask: input.ask,
    holeNumber: input.holeNumber ?? null,
  });
}

/**
 * What this host has spent on the caddy in the last rolling day.
 *
 * Read on their own session, which is all RLS will show them anyway. The
 * authority on this number is `guard_caddy_fair_use` in Postgres — it takes a
 * lock and cannot be raced, and it is what actually refuses. This read is the
 * *polite* version of the same question, asked before the money is spent
 * rather than after: without it, a host at the ceiling would pay for one more
 * call and then be told it could not be filed, which is the one shape of
 * failure that genuinely wastes money.
 */
async function spentToday(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("caddy_turns")
    .select("cost_micropence")
    .eq("host", userId)
    .gt("created_at", since);
  return (data ?? []).reduce(
    (total, row) => total + Number(row.cost_micropence ?? 0),
    0,
  );
}

/** One turn: ask, and keep what it cost whether or not a card arrived. */
async function turn(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  sessionId: string;
  brief: CaddyBrief;
  candidates: CandidateDossier[];
  history: CaddyTurnRecord[];
  kind: "plan" | "roll" | "tweak";
  ask?: string;
  holeNumber?: number | null;
}): Promise<CaddyResult> {
  // Asked before the call, so a host at the ceiling is told plainly instead of
  // being charged for a turn that Postgres is about to refuse.
  if (!withinBudget(await spentToday(input.supabase, input.userId), caddyBudgetMicroPence())) {
    return { error: CADDY_BUDGET_NOTE };
  }

  const outcome = await askCaddy({
    brief: input.brief,
    candidates: input.candidates,
    history: input.history,
    ask: input.ask,
    holeNumber: input.holeNumber,
    roll: input.kind === "roll",
  });

  /** The ledger line. Written for a failure too — the vendor billed us for it
   * either way — but marked `failed`, which is what keeps the host's promise
   * honest: the money counts, the card does not. */
  const record = async (failed: boolean, result: unknown) =>
    input.supabase.from("caddy_turns").insert({
      session_id: input.sessionId,
      host: input.userId,
      kind: input.kind,
      ask: input.ask ?? null,
      result: result as never,
      failed,
      model: outcome.model,
      input_tokens: outcome.usage.input,
      output_tokens: outcome.usage.output,
      cache_write_tokens: outcome.usage.cacheWrite,
      cache_read_tokens: outcome.usage.cacheRead,
    });

  if (!outcome.ok) {
    // Best effort, and deliberately unchecked: if the ledger itself refuses
    // this row the host is already past the ceiling, and the line they need to
    // read is the one below, not a second failure about bookkeeping.
    await record(true, {});
    if (outcome.reason === "unavailable" || outcome.reason === "misconfigured") {
      return {
        // Two different truths. A timeout is worth another tap; a deploy that
        // cannot reach its model is not, and telling a host to ask again would
        // sit them in front of a button that cannot work. Neither costs them
        // anything, and neither mentions the machinery.
        error:
          outcome.reason === "misconfigured"
            ? "The caddy's off duty — that's ours to fix, and it hasn't cost you a thing."
            : "The caddy lost the ball. Ask again — this one's free.",
        // Off production only, and it is the same line the server log gets:
        // whoever is looking at staging can read the vendor's actual complaint
        // rather than asking someone else to go and read logs for them.
        detail: showCaddyDiagnostics(process.env) ? outcome.detail : undefined,
      };
    }
    return { error: planFailureNote(outcome.reason) };
  }

  // The card arrived, so the turn is written — and only now does it count.
  const { error } = await record(false, outcome.course);
  if (error) {
    // The one refusal a host can actually meet, and it names no number.
    if (error.code === "42501") return { error: FULL_SHIFT };
    return { error: "The caddy couldn't file that card. Give it another go." };
  }

  const previous = input.history[input.history.length - 1]?.course.holes ?? [];
  const { changedHoles } = await import("@/lib/caddy/plan");
  return {
    sessionId: input.sessionId,
    course: outcome.course,
    changed: input.kind === "tweak" ? changedHoles(previous, outcome.course.holes) : [],
  };
}

/** The session is finished: stamp it and drop the dossier. Google's atmosphere
 * facts and review snippets are read for the length of one conversation and
 * are not ours to keep — what survives is the course the host saved and the
 * caddy's own one-line notes. */
export async function closeCaddySession(sessionId: string): Promise<void> {
  const session = await host();
  if (!session) return;
  await session.supabase
    .from("caddy_sessions")
    .update({ completed_at: new Date().toISOString(), dossier: [] as never })
    .eq("id", sessionId);
}
