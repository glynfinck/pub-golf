import { MAX_LOCAL_RULES } from "@/lib/rules";

/**
 * The game itself, stated once — for the people playing it and for the caddy
 * planning it.
 *
 * Until this module existed the two read different rulebooks. The rules sheet
 * told a player "a swig is a stroke, and the lowest card wins"; the caddy's
 * system prompt said the same thing in its own words, and its own words had
 * drifted. Most of the drift was harmless. One piece of it was not:
 *
 *   The prompt taught a **fixed par ladder** — "4 is a pint" — and stated it
 *   twice, in two different wordings, in two files. The house's own printed
 *   card disagrees with both. The Invitational prices a pint at 3 on one hole,
 *   5 on another and 6 on a third, and a bomb shot down in one at par 1. Par
 *   there is what the hole is *for*, not a lookup table on the drink. Told the
 *   ladder, the caddy produced exactly what the ladder describes: nine holes
 *   of par 4 with the life flattened out of them.
 *
 * So the rule lives here, once, and both the sheet a player reads and the
 * brief the caddy reads are built out of it. The test that matters is the one
 * in `tests/unit/house-rules.test.ts` that holds this file against the printed
 * card: if the Invitational stops obeying the doctrine, one of the two is
 * wrong and somebody has to decide which.
 *
 * **Byte-stability.** Everything here is a module constant, because the caddy's
 * system rules and tool descriptions sit inside a cached prompt prefix
 * (`lib/caddy/tools.ts`). Assembled once at module load is fine; assembled per
 * request would rewrite the prefix every call and turn every cache read back
 * into a cache write.
 */

/** The whole game in a sentence. The rules sheet opens with it, and it is the
 * first thing the caddy is told. */
export const HOW_IT_PLAYS =
  "Every hole is a pub and the drink is the ball: a swig is a stroke, and the lowest card wins.";

/**
 * What par is — and, more usefully, what it is not.
 *
 * Not a table of drink → number. Par is the target for *this* drink at *this*
 * pub, which is why the printed card can charge par 3 for a cask ale and par 6
 * for a stout without contradicting itself: one is a hole you get through and
 * the other is a hole you settle into.
 */
export const PAR_MEANING =
  "Par is how many swigs the drink should take on that hole. Scores are swigs, so par is the bar the player is measured against: fewer is a good hole, more goes on the card.";

/**
 * The practical range, which is narrower than the card allows.
 *
 * `courseSchema` accepts 1–20 because a host may do as they like on their own
 * course. Nothing sensible lives above about 6, and the caddy is told the
 * range that produces a card rather than the range that survives validation.
 */
export const PAR_TYPICAL_MIN = 1;
export const PAR_TYPICAL_MAX = 6;

/**
 * The one thing a drink absolutely has to be: real, at that bar, tonight.
 *
 * Sibling of the rule about pubs. The caddy cannot invent a pub because there
 * is nowhere in the schema to put a name — but the drink *is* free text, so
 * this one has to be argued rather than made impossible. It matters for the
 * same reason: a group standing at a bar being told they do not serve that is
 * the same failure as a door that is not there, one pub further in.
 *
 * The facts do most of the work. Google answers `beer`, `wine` and `cocktails`
 * per place, and a `no` there is a hard no. A `—` is not permission — it is
 * silence, and silence is where judgment goes.
 */
export const DRINK_MUST_EXIST =
  "Name something that pub would actually pour. The dossier states beer, wine and cocktails per place: a `no` is a hard no, and `—` means Google did not say, not that anything goes — judge it from what the place plainly is, from its summary and its reviews, and from the area it is in. A brand is good when it is one that pub would credibly stock; when you are not sure, name the category instead, because a stout nobody has to explain beats a specific beer they have never carried.";

/**
 * What a good course looks like, which is the part no rulebook states because
 * a player reading one is already standing in the first pub.
 *
 * This is the caddy's actual goal. Everything else it is told is a constraint;
 * without this it optimises for not breaking anything, and a card that breaks
 * no rules and has no shape is the flat par-34 nine-pinter that prompted the
 * whole module.
 */
export const GOOD_COURSE = [
  "Variety in the glass is the first thing. Nine pints is not a course, it is nine pints — move between beer, cider, wine, a spirit and mixer, a short. The drink is also the only part of the card that decides how much anybody actually drinks, so a card that mixes in halves and shorts is both the better course and the kinder one.",
  "Par carries that variety onto the scorecard. A card of nothing but 4s is flat however good the pubs are. Give it a spread: at least one quick hole that is over in a swig or two, at least one long one that the group settles into.",
  "It should have a shape across the night. The first hole is where people arrive, find each other and order — start gently, and never put a hazard on it. The middle is where a course can be difficult. The last hole is where everyone stops walking and stays, so finish somewhere worth staying.",
  "Hazards are punctuation, not wallpaper. A third of the holes at most, and better spaced out than bunched.",
  "Local rules are seasoning. Most holes have none at all; one good one on a hole that deserves it beats five everywhere.",
  "The pubs have to suit what was asked for, and the whole card has to work as one night out rather than as nine good pubs in a list.",
] as const;

/**
 * What each part of a hole actually *does* once the round is being played.
 *
 * The caddy was previously told the shape of the fields and the rules about
 * them, but never their consequences — what a par of 2 does to a player at
 * 11pm, or where a local rule turns up on somebody's phone. A model dressing
 * holes without that is decorating, not designing.
 *
 * Keyed by the field name as the plan schema spells it, so the tool
 * descriptions and the system rules cannot drift apart again.
 */
export const HOLE_PARTS = {
  drink: `The drink is what the group orders at the bar. It is the only part of the card that decides how much anybody drinks, and it sets how the hole feels before par does anything. ${DRINK_MUST_EXIST}`,
  par: `${PAR_MEANING} A low par on a big drink is punishing; a high par on a small one is a gift. Most holes land between ${PAR_TYPICAL_MIN} and ${PAR_TYPICAL_MAX}.`,
  hazard:
    "A hazard changes how the drink has to be taken, and puts a named offence on that hole's penalty sheet for the marker to tap when somebody commits it.",
  hazardNote:
    "The hazard in this pub's own words. The player sees this on the hole instead of the house definition, so it should say the same thing about this particular place — the roof terrace, the cellar bar, the one toilet.",
  localRules: `Extra offences that cost strokes at this pub and nowhere else. They join the house penalty table on this hole's sheet, so each one needs a price as well as a name. At most ${MAX_LOCAL_RULES}, and most holes want none.`,
  fitNote:
    "For the host reading the draft, not for the players: it explains the pick while they decide, and does not survive the course being saved.",
  courseName: "What the group calls the night.",
} as const;

/**
 * What the caddy does *not* decide, which is worth saying out loud.
 *
 * Every one of these was, at some point, something the model tried to do
 * anyway — most expensively the walking order, which it used to choose and now
 * cannot (`lib/caddy/route.ts`). Naming them stops it spending judgment on
 * decisions that are already made.
 */
export const NOT_THE_CADDYS = [
  "The walking order. The club routes the card itself once the pubs are chosen, so choose pubs that sit well together and leave the sequence alone.",
  "The house penalty table, the shot clock, mulligans and handicaps. Those are the round's own settings, chosen by the host when they start the round.",
] as const;
