import "server-only";

import { headers } from "next/headers";

import { readBrief, candidateFloor, type CaddyBrief } from "@/lib/caddy/brief";
import { caddyBudgetMicroPence } from "@/lib/caddy/budget";
import {
  askCaddy,
  askCaddyLooped,
  askCaddyStreamed,
  type CaddyTurnRecord,
} from "@/lib/caddy/client";
import { caddyEnabled } from "@/lib/caddy/credentials";
import { CADDY_CREDITS_SPENT } from "@/lib/caddy/credits";
import { patchIsOpen, resumableSince } from "@/lib/caddy/window";
import { showCaddyDiagnostics } from "@/lib/caddy/readiness";
import {
  buildCandidates,
  EMPTY_FACTS,
  type CandidateDossier,
  type PubSource,
} from "@/lib/caddy/dossier";
import { gatherPubs, type GatheredPub } from "@/lib/caddy/places";
import { planFailureNote, type PlannedCourse } from "@/lib/caddy/plan";
import { ipBiasFrom } from "@/lib/pub-search";
import { primaryLanguage } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

/**
 * The caddy's pipeline — everything between a brief and a filed card.
 *
 * This was `lib/actions/caddy.ts` and is still reached that way: the actions
 * file is now a `"use server"` shim over it. The move exists because the plan
 * has a second caller — the streaming route at `app/api/caddy/plan/route.ts` —
 * and a `"use server"` module may only export async actions, so a route
 * handler cannot reach into one for the pieces it needs.
 *
 * That constraint is worth stating as a rule rather than a workaround: **there
 * is one path from a brief to a charge, and both callers walk it.** The
 * budget check, the ledger row and the failure copy all live in `runTurn`. A
 * second implementation of any of them is a second place for the caddy to
 * spend money nobody counted.
 */

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
  /**
   * This refusal is "you already have what you paid for", not "something went
   * wrong". The drafting table shows these as a door to the course the host
   * has rather than as an error toast — a dead end with no way on is the worst
   * possible way to learn what a fee bought.
   */
  spent?: boolean;
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
/**
 * Held a fee, already has the course it bought.
 *
 * A different situation from having no fee and it says so, because being told
 * "the caddy comes with the green fee" when you have just paid one reads as
 * the app losing your money. No guilt and no upsell in the line either — it
 * names the two ways on, both of which are free, and leaves buying another to
 * the host's own idea.
 */
/** The pass ran out while a conversation was still open on the table. Warm,
 * because they did nothing wrong — the day simply ended — and it names the two
 * things that are still theirs. */
const PASS_RAN_OUT =
  "Your green fee's day is over. Every course it planned is still yours to change, and plotting one by hand is free as always.";
/**
 * There used to be two of these — this one, and `CADDY_CREDITS_SPENT` beside
 * the number it talks about. Only this one was ever rendered, so when a fee
 * went from planning one course to planning four, this text went on saying
 * "the caddy plans one to a fee" and nobody noticed: the copy that had been
 * kept correct was the copy nothing displayed.
 *
 * So the refusal now comes from the module that owns the allowance. A sentence
 * that quotes a number belongs next to the number.
 */
const SPENT_FEE = CADDY_CREDITS_SPENT;
const THIN_PATCH =
  "Not enough pubs in that patch for the round you asked for. Widen the patch, or drop a few holes.";
/**
 * Fair use, which is a different thing from a budget and the only ceiling left
 * that is about volume rather than about what was bought.
 *
 * Raised by the Postgres guard, never decided here — the same arrangement
 * every other guarded write uses, because RLS is the only real enforcement.
 */
const FULL_SHIFT =
  "The caddy's done a full shift on this fee. The drafting table is all yours from here — every edit free, as always.";

/**
 * Which quota a follow-up turn draws on, decided **here** rather than taken
 * from the caller.
 *
 * It used to be `input.roll ? "roll" : "tweak"`, and `roll` arrived from the
 * browser. `guard_caddy_spend` branches purely on `caddy_turns.kind`, and a
 * tweak's `result` is a whole `PlannedCourse` exactly as a roll's is — so
 * asking for a completely different card with `roll:false` drew on the
 * sixty-deep tweak allowance instead of the four-deep revision one. The insert
 * policy checks the host and the session, and has no opinion about which of a
 * host's own quotas they spend.
 *
 * A roll is "give me another card"; a tweak is "change this one, thus". The
 * presence of an ask is exactly that distinction, and unlike a boolean flag it
 * cannot be set to the cheap value while asking for the dear thing: a request
 * with no ask *is* a roll, whatever it calls itself.
 */
function kindOf(input: { ask?: string }): "roll" | "tweak" {
  return input.ask?.trim() ? "tweak" : "roll";
}

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

/**
 * The buyer's live green fee that still has its course to give.
 *
 * Two conditions, and the second is the one that makes the tariff hold. A fee
 * buys **one** caddy course, kept — otherwise a patient host plans Shoreditch,
 * then Soho, then Camden inside the same day and keeps all three, which is
 * unbounded output for a fixed price. The fair-use ceiling and the budget
 * bound the tokens, which is the right guard against a script; neither bounds
 * what somebody unhurried walks away with.
 *
 * "Spent" is a count of credits, not a state of the book. Tearing a course out
 * gives nothing back: the caddy did the work and we paid for it. What a host
 * keeps for free is every edit to what they already have.
 *
 * Asking Postgres rather than assembling it here, because the same question is
 * answered by `guard_caddy_credit` on the way in and the two must agree: this
 * decides which fee to work under, and the trigger decides whether the credit
 * may be spent. A definer function for the reason `holds_day_pass` is one —
 * the caddy acts on a host's behalf and a round-less entitlement is visible to
 * its buyer alone.
 */
async function liveFee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  // The same ladder `guard_caddy_spend` walks, and it has to be: that trigger
  // takes the course credit first and a re-design after, so asking only about
  // re-designs would tell a host holding nothing *but* a course credit that
  // they have no fee at all. A course top-up is exactly that shape on its first
  // card, which is why it also grants a revision — but the ladder is the real
  // fix, and the grant is belt and braces.
  const course = await supabase.rpc("caddy_next_grant", {
    who: userId,
    quota: "course",
  });
  const { data, error } = course.data
    ? course
    : await supabase.rpc("caddy_next_grant", { who: userId, quota: "redesign" });
  if (!error) {
    if (!data) return null;
    // `caddy_next_grant` answers with a **grant** id, where its predecessor
    // `caddy_unspent_fee` answered with an entitlement id. The rename hid the
    // type change and this function kept handing the result on as
    // `entitlement_id`, which is a foreign key to `entitlements` — so the
    // session insert died on the constraint and the host read "the caddy
    // isn't on duty here", the same sentence a missing API key gives.
    //
    // It hid for a while because it needs a grant to exist before it can
    // return the wrong kind of id: with an empty ledger the null path ran
    // instead, and everything looked fine right up until somebody held a fee
    // that had actually granted something.
    //
    // The session records which *purchase* it is working under, so resolve the
    // grant back to the entitlement that minted it.
    const { data: grant } = await supabase
      .from("caddy_grants")
      .select("entitlement_id")
      .eq("id", data as string)
      .maybeSingle();
    // A grant with no purchase behind it would be a comped one. There is a
    // live allowance either way, so the session opens; it simply records no
    // purchase, which `caddy_sessions.entitlement_id` is nullable for.
    return { id: grant?.entitlement_id ?? null };
  }

  // The allowance function is not on this database yet.
  //
  // Vercel and Supabase deploy independently and neither waits for the other,
  // so there is always a window where new code is talking to the old schema —
  // DEPLOYMENT.md calls this expand/contract and asks for "code that tolerates
  // both". Without this branch that window is not a degraded caddy, it is a
  // paying host being told their course is already in the book when they have
  // none, which is the single worst thing this feature could say to somebody
  // who has just paid.
  //
  // So fall back to what the question meant before the allowance existed: any
  // live fee. A host mid-deploy gets the old generosity for a minute or two
  // rather than a lie, and the ceiling starts applying the moment the
  // migration lands. Only for a genuinely missing function — any other error
  // is a real refusal and is left alone.
  if (!missingFunction(error)) return null;
  const { data: anyFee } = await supabase
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "green_fee")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return anyFee ?? null;
}

/**
 * Is this error "that function does not exist here yet"?
 *
 * Two codes for one condition, from two layers, exactly as the caddy tables'
 * own presence check already has to handle: `42883` is Postgres saying the
 * function is undefined, `PGRST202` is PostgREST saying it is not in its
 * schema cache. Checking only the Postgres one would miss it on every modern
 * stack — which is the deploy this exists to survive.
 */
function missingFunction(error: { code?: string } | null): boolean {
  return error?.code === "42883" || error?.code === "PGRST202";
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
        facts: { ...EMPTY_FACTS },
        editorial: null,
        reviews: [],
      } satisfies PubSource,
    ]),
  );
}

/**
 * The patch, from Google: everywhere worth drinking between the brief's ends.
 *
 * Lifted out of `openPlan` when re-opening a swept session needed the same
 * thing. Both callers want exactly this — the candidates and the two ends the
 * areas resolved to — and neither wants a model, a session row or a credit,
 * which is what makes it a sensible seam.
 *
 * A thin patch is an honest refusal, never a padded card, and it costs nothing
 * either way: no turn row is written here.
 */
async function gatherFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brief: CaddyBrief,
  placesKey: string,
): Promise<
  | { candidates: CandidateDossier[]; from: unknown; to: unknown }
  | { error: string }
> {
  const pins = await pinCoords(supabase, [
    brief.startVenueId,
    brief.finishVenueId,
  ]);
  const start = pins.get(brief.startVenueId ?? "");
  const finish = pins.get(brief.finishVenueId ?? "");

  const requestHeaders = await headers();
  const gather = await gatherPubs({
    key: placesKey,
    where: brief.where,
    whereTo: brief.whereTo,
    start: start?.lat != null && start.lng != null
      ? { lat: start.lat, lng: start.lng }
      : null,
    finish: finish?.lat != null && finish.lng != null
      ? { lat: finish.lat, lng: finish.lng }
      : null,
    ipBias: ipBiasFrom(requestHeaders),
    language: primaryLanguage(requestHeaders.get("accept-language")),
  });

  const cached = await cachePubs(supabase, gather.pubs);
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

  if (candidates.length < candidateFloor(brief.holes)) {
    return { error: THIN_PATCH };
  }
  return { candidates, from: gather.from, to: gather.to };
}

/**
 * Pick a conversation back up after its patch has been swept.
 *
 * The retention rule costs something, and this is what it costs: twelve hours
 * after a session opens its dossier goes, and with it the caddy's ability to
 * swap a pub — because there is nothing left to swap *for*. Until now that was
 * terminal, so a host with tweaks still on their fee and a course in the book
 * had no way to spend them except to plan the whole thing again, which spends
 * a re-design on work already done.
 *
 * So: re-gather. Google is asked the same brief a second time and the answer
 * goes back on the session. No model call, no card, no turn row and **no
 * credit** — the patch expiring is our policy rather than the host's action,
 * and charging for it would be charging them for our own housekeeping.
 *
 * Three things bound it. The session must be theirs (RLS decides, not this
 * function). Their fee must still be running, exactly as `askTheCaddy`
 * requires — a conversation on an expired pass is over regardless. And the
 * patch must actually be gone, so this cannot be used to refresh a live one.
 *
 * Note the window still means what it says: `resumeCaddy` will not offer a
 * session older than it, so this re-opens a conversation from tonight rather
 * than resurrecting one from last week. And it *fetches* rather than
 * un-deletes, so nothing about Google's data is held longer than the rule
 * allows.
 */
export async function reopenCaddyPatch(
  sessionId: string,
): Promise<{ error?: string }> {
  if (!caddyEnabled(process.env)) return { error: NO_CADDY };
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) return { error: NO_CADDY };

  const session = await host();
  if (!session) return { error: "Planning a course takes a sign-in." };
  const { supabase, user } = session;

  const { data: row } = await supabase
    .from("caddy_sessions")
    .select("id, brief, dossier")
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) return { error: "That patch isn't on your table." };

  const brief = readBrief(row.brief);
  if (!brief) return { error: "That patch isn't on your table." };
  // Already open. Answering plainly rather than re-gathering keeps this from
  // becoming a way to spend Places quota on a session that needs nothing.
  if (patchIsOpen(row.dossier)) return {};

  const { data: covered } = await supabase.rpc("holds_day_pass", {
    who: user.id,
  });
  if (covered !== true) return { error: PASS_RAN_OUT };

  const gathered = await gatherFor(supabase, brief, placesKey);
  if ("error" in gathered) return gathered;

  const { error } = await supabase
    .from("caddy_sessions")
    .update({
      // The ends resolve again with the patch, so a re-opened conversation
      // aims the same way a fresh one would rather than carrying whatever the
      // first gather happened to find.
      brief: {
        ...brief,
        aimFrom: gathered.from,
        aimTo: gathered.to,
      } as unknown as never,
      dossier: gathered.candidates as unknown as never,
    })
    .eq("id", sessionId);
  if (error) return { error: "That patch isn't on your table." };
  return {};
}

/**
 * Plan a course: gather the patch, brief the caddy, keep the card.
 *
 * The gather happens once. Its dossier is written onto the session and every
 * later turn — every roll, every ask — re-reads it rather than calling Google
 * again, which is why a re-roll costs one model call and no Places quota.
 */
export async function planCourse(rawBrief: unknown): Promise<CaddyResult> {
  const opened = await openPlan(rawBrief);
  if ("error" in opened) return { error: opened.error };
  return runTurn({ ...opened, history: [], kind: "plan" });
}

/**
 * Everything before the model: who is asking, whether they have paid, where
 * the patch is, and which pubs are in it.
 *
 * Split out because the streamed plan needs to *say* some of this while the
 * model is still working — the patch is what the map frames before a single
 * hole exists, and it is known a good few seconds before the card is. A
 * caller that does not care simply runs it and hands the result to `runTurn`,
 * which is what `planCourse` above does.
 *
 * No money moves here and no turn is written, which is why a thin patch is
 * free: the refusal happens before anything has been asked of the model.
 */
export async function openPlan(rawBrief: unknown): Promise<
  // `detail` rides along for the same reason CaddyResult carries one: off
  // production the staging note may say which gate refused, while the player
  // always reads the same plain sentence.
  | { error: string; spent?: boolean; detail?: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      sessionId: string;
      brief: CaddyBrief;
      candidates: CandidateDossier[];
    }
> {
  // Three different failures used to answer with the same sentence, which
  // made "the caddy isn't on duty" a shrug rather than a diagnosis — a
  // missing model credential, a missing Places key and a refused session
  // insert are three separate problems with three separate fixes, and off
  // production the staging note is allowed to say which. The player-facing
  // sentence never changes; only `detail` does, and only where it is read.
  if (!caddyEnabled(process.env))
    return {
      error: NO_CADDY,
      detail:
        "No model credential on this deploy — set AI_GATEWAY_API_KEY (or ANTHROPIC_API_KEY). Check it is enabled for this environment, not only for the preview branch.",
    };
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey)
    return {
      error: NO_CADDY,
      detail:
        "No GOOGLE_PLACES_API_KEY on this deploy. This is the server's Places key and is separate from the browser maps key — a deploy can have the model credential and still be missing this one.",
    };

  const brief = readBrief(rawBrief);
  if (!brief) return { error: "Tell the caddy where you're drinking." };

  const session = await host();
  if (!session) return { error: "Planning a course takes a sign-in." };
  const { supabase, user } = session;

  const fee = await liveFee(supabase, user.id);
  if (!fee) {
    // Distinguish "no fee" from "fee already spent" — the same refusal for
    // both would tell a host who paid twenty minutes ago that they had not.
    const { data: covered } = await supabase.rpc("holds_day_pass", {
      who: user.id,
    });
    return {
      error: covered === true ? SPENT_FEE : NEEDS_FEE,
      spent: covered === true,
    };
  }

  const gathered = await gatherFor(supabase, brief, placesKey);
  if ("error" in gathered) return gathered;
  const { candidates, from, to } = gathered;

  const { data: created, error: sessionError } = await supabase
    .from("caddy_sessions")
    .insert({
      host: user.id,
      entitlement_id: fee.id,
      // The areas as they actually resolved, so the router faces the way the
      // host asked rather than guessing a direction from the candidate cloud.
      brief: {
        ...brief,
        aimFrom: from,
        aimTo: to,
      } as unknown as never,
      dossier: candidates as unknown as never,
    })
    .select("id")
    .single();
  if (sessionError || !created)
    return {
      error: NO_CADDY,
      // The one that is not a missing secret: the row was refused. Almost
      // always RLS or a constraint, so the code is worth more than the prose.
      detail: `The caddy session would not open: ${
        sessionError?.code ?? "no row returned"
      } ${sessionError?.message ?? ""}`.trim(),
    };

  return { supabase, userId: user.id, sessionId: created.id, brief, candidates };
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
  if (!brief || !patchIsOpen(candidates)) {
    return { error: "That patch has been put away. Plan a fresh one." };
  }

  // The fee has to still be running. This was missing, and it was the credit
  // outliving its own day: a session opened at eleven at night is resumable
  // for twelve hours, so a host could keep rolling *entirely new cards* long
  // after the pass had run out. Rolls are free within a paid session — they
  // are not free within an expired one, because then the day boundary buys
  // nothing.
  const { data: covered } = await supabase.rpc("holds_day_pass", { who: user.id });
  if (covered !== true) return { error: PASS_RAN_OUT, spent: true };

  /**
   * And there has to be something left to spend, **before** the model is
   * called rather than after.
   *
   * `guard_caddy_spend` is an AFTER INSERT trigger, so its refusal aborts the
   * turn row — which means an exhausted host's turn cost real vendor money,
   * recorded nothing, and did not even increment fair use, because fair use
   * counts rows. A live pass with an empty balance was an unbounded, invisible
   * way to spend.
   *
   * The trigger stays the enforcement — this is a courtesy check that saves
   * the call, exactly as `liveFee` already does for a plan. A host who slips
   * between this read and the insert still meets the guard.
   */
  const wanted = kindOf(input) === "tweak" ? "tweak" : "redesign";
  const { data: left, error: balanceError } = await supabase.rpc("caddy_balance", {
    who: user.id,
    quota: wanted,
  });
  // A database that has not caught up answers with an error rather than a
  // number, and the honest reading of that is "carry on" — the guard is still
  // there, and refusing a paid host because a function is missing is the
  // failure this whole branch keeps re-learning.
  if (!balanceError && Number(left ?? 0) <= 0) {
    // The course ladder can still pay for a whole card even with no revisions
    // left, so a roll asks the second rung before giving up.
    const { data: courseLeft } = await supabase.rpc("caddy_balance", {
      who: user.id,
      quota: "course",
    });
    if (wanted === "tweak" || Number(courseLeft ?? 0) <= 0) {
      return { error: SPENT_FEE, spent: true };
    }
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

  return runTurn({
    supabase,
    userId: user.id,
    sessionId: input.sessionId,
    brief,
    candidates,
    history,
    /**
     * Which quota this turn draws on, decided **here** rather than taken from
     * the caller.
     *
     * It used to be `input.roll ? "roll" : "tweak"`, and `roll` arrived from
     * the browser. `guard_caddy_spend` branches purely on `caddy_turns.kind`,
     * and a tweak's `result` is a whole `PlannedCourse` exactly as a roll's is
     * — so asking for a completely different card with `roll:false` drew on
     * the sixty-deep tweak allowance instead of the four-deep revision one.
     * The insert policy checks the host and the session and has no opinion
     * about which of a host's own quotas they spend.
     *
     * A roll is "give me another card"; a tweak is "change this one, thus".
     * The presence of an ask is exactly that distinction, and unlike a boolean
     * flag it cannot be set to the cheap value while asking for the dear
     * thing: a request with no ask *is* a roll, whatever it calls itself.
     */
    kind: kindOf(input),
    ask: input.ask,
    holeNumber: input.holeNumber ?? null,
  });
}


/**
 * What the loop needs from the outside world, assembled where the keys are.
 *
 * `dispatchTool` deliberately has no key and no client, so going back to
 * Google arrives as a function. This is that function, plus the brief's own
 * walking constraints so a trial routes exactly the way the finished card
 * will — a trial that disagreed with the real router would be worse than none,
 * because the caddy would be optimising against a walk nobody takes.
 *
 * A failed search answers empty rather than throwing. Google being slow is not
 * a reason to lose a plan the host has already paid for; the caddy reads
 * "nothing came back" and carries on with the patch it has.
 */
function midConversation(brief: CaddyBrief) {
  return {
    // A runaway ceiling, not a share of the day. A plan is bounded by its
    // turns and the host gets the whole of what they paid for; this catches a
    // loop that has gone wrong, and the whole day's allowance is comfortably
    // above anything an honest one has ever cost.
    breaker: caddyBudgetMicroPence(),
    pins: { minLegMinutes: brief.stretch },
    search: async (query: string): Promise<CandidateDossier[]> => {
      const key = process.env.GOOGLE_PLACES_API_KEY;
      if (!key) return [];
      try {
        const supabase = await createClient();
        const gatheredSearch = await gatherPubs({
          key,
          where: query,
          // A mid-plan search is one place the caddy went looking for, not a
          // walk between two — the corridor is the brief's business.
          whereTo: "",
          start: null,
          finish: null,
          ipBias: null,
          language: null,
        });
        // Through the same cache the first gather used, so a pub the caddy
        // finds mid-conversation has a real `venues` row and real coordinates
        // before it can ever be put on a hole.
        return buildCandidates(await cachePubs(supabase, gatheredSearch.pubs));
      } catch {
        return [];
      }
    },
  };
}

/**
 * One turn: ask, and keep what it cost whether or not a card arrived.
 *
 * The only place a model is called for money. `narrate` is what makes it a
 * streamed turn — given one, the same request goes out with the thinking
 * summary on and the answer arriving in pieces; given none, it is the single
 * call it always was. Everything either side of the call is identical, which
 * is the point: the ceiling is checked once, the ledger is written once, and
 * a failure reads the same either way.
 */
export async function runTurn(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  sessionId: string;
  brief: CaddyBrief;
  candidates: CandidateDossier[];
  history: CaddyTurnRecord[];
  kind: "plan" | "roll" | "tweak";
  ask?: string;
  holeNumber?: number | null;
  /** Present on a streamed turn: the caddy's reasoning and the answer as it
   * is written. Narration only — nothing here reaches the card. */
  narrate?: (update: {
    thinking?: string;
    answer?: string;
    /** A tool call, named for the host. */
    doing?: string;
  }) => void;
}): Promise<CaddyResult> {
  // There used to be a budget check here — 12% of the fee, refused before the
  // model was called. It is gone, and the reasoning is worth keeping because
  // it is the same reasoning that removed the token cap before it.
  //
  // A host who has paid for four re-designs has bought four re-designs. What
  // they cost us varies; absorbing that variance is what a fixed price is for.
  // Metering the same purchase a second time in money means the fourth plan
  // can be refused for no reason the host can see or predict — which is what
  // happened: a fee bought four courses and the budget stopped it after two,
  // with a sentence about a full shift that explains nothing.
  //
  // What bounds the work now is what a host was actually told: the re-design
  // quota, which is a count they can see, and the runaway breaker inside the
  // loop, which is not a ceiling anyone meets. Cost is still recorded on every
  // turn — that is what prices the tariff (docs/CADDY-TOPUPS.md) — but it is
  // evidence, not a gate.

  const ask = {
    brief: input.brief,
    candidates: input.candidates,
    history: input.history,
    ask: input.ask,
    holeNumber: input.holeNumber,
    roll: input.kind === "roll",
  };
  /**
   * Which caddy answers.
   *
   * A first plan gets the tool loop: it is the turn where getting it right
   * first time is worth several passes, because every revision it saves is a
   * revision the host never has to ask for — and cheaper than the conversation
   * it replaces. A roll or a tweak does not: the patch is already read, the
   * host has said exactly what they want changed, and a loop there would spend
   * a plan's worth of tokens re-deciding things nobody questioned.
   */
  const outcome = input.narrate
    ? input.kind === "plan"
      ? await askCaddyLooped(ask, midConversation(input.brief), input.narrate)
      : await askCaddyStreamed(ask, input.narrate)
    : await askCaddy(ask);

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
      // What the caddy actually did, where there were tools to trace. Null on
      // a roll or a tweak rather than an empty object, so "this path has no
      // tools" and "the tools did nothing" stay different facts — see
      // lib/caddy/trace.ts for why it holds inputs and never replies.
      trace: (outcome.trace ?? null) as never,
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
    if (error.code === "42501") return { error: FULL_SHIFT, spent: true };
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

/**
 * Remember which course this session filed.
 *
 * Called by the drafting table the moment a caddy card writes itself into the
 * book, and it is the whole of the fix for the duplicate-course bug: a
 * refreshed table asks the server which course it already has rather than
 * minting another. One-way — the guard trigger in 20260827 refuses a second
 * value, because the only job this link has is preventing a duplicate and a
 * movable version of it would be a way to make one.
 *
 * Best-effort and silent. Failing to record the link costs a host a duplicate
 * course at worst; an error toast about bookkeeping they never asked for costs
 * them the card they are looking at.
 */
export async function rememberCaddyCourse(
  sessionId: string,
  courseId: string,
): Promise<void> {
  const session = await host();
  if (!session) return;
  await session.supabase
    .from("caddy_sessions")
    .update({ course_id: courseId })
    .eq("id", sessionId)
    .is("course_id", null);
}

/**
 * The card is filed. Stamp the session — and leave the patch on the table.
 *
 * This used to empty the dossier here, and doing so quietly destroyed the
 * thing the host had just paid for. `askTheCaddy` refuses a session with no
 * candidates ("That patch has been put away"), so saving a course ended the
 * conversation about it: sixty tweaks, bought and advertised, unreachable the
 * moment the card went into the book. The one action a happy host takes was
 * the one that took the rest of their allowance away.
 *
 * The retention rule it was enforcing is real — Google's atmosphere facts and
 * review snippets are read for the length of one conversation and are not ours
 * to keep — but **the conversation ends with the window, not with the save**,
 * which is what `RESUMABLE_HOURS` has always said and what the resume path has
 * always assumed. So the stamp means what it says it means ("this produced a
 * card"), and the sweep below is what actually enforces the retention.
 *
 * Host-scoped by RLS and bounded to sessions already past the window, so it
 * cannot touch a live patch — including this one.
 */
export async function closeCaddySession(sessionId: string): Promise<void> {
  const session = await host();
  if (!session) return;
  await session.supabase
    .from("caddy_sessions")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", sessionId);
  await sweepCaddyDossiers(session.supabase);
}

/**
 * Drop the patch from this host's sessions that have fallen out of the window.
 *
 * Lazy rather than scheduled, deliberately: it rides on an action the host is
 * already taking, needs no cron and no service role, and RLS makes "this
 * host's" the only rows it can reach. A host who never comes back leaves rows
 * behind, which is what a scheduled sweep would be for — but every host who
 * does come back tidies their own, and the window is what the resume path
 * enforces regardless.
 *
 * Best-effort and silent, like the stamp it follows: failing to tidy is not
 * something to interrupt a saved course with.
 */
async function sweepCaddyDossiers(
  supabase: NonNullable<Awaited<ReturnType<typeof host>>>["supabase"],
): Promise<void> {
  await supabase
    .from("caddy_sessions")
    .update({ dossier: [] as never })
    .lt("created_at", resumableSince(Date.now()));
}
