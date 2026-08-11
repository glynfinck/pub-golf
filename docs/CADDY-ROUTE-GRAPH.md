# Give the caddy the map, not a torch

A design for cutting the plan from a dozen turns to one or two, by handing the
model precomputed routes instead of making it search for them.

Nothing here is built.

## The evidence

A failed plan on preview, 11 August 2026, 19:20:

```
output 6,681   input 54,053   cache write 14,555   cache read 160,105
cost 29.20p    failed: true   no card
```

160k of cache reads is the dossier being re-read a dozen times. The model was
not thinking for a dozen turns; it was *searching* — call a tool, get a slice of
the map, call again — and every call drags the whole dossier back through the
context. It ran out of loop budget before it converged and produced nothing,
having cost more than the 27.34p successful plan the entire tariff is priced
against.

That is the case for this change, and it is an economic one before it is a
quality one: **a timeout costs full freight and delivers nothing.**

## The idea

The candidate set is already fixed by the time the model is called —
`buildCandidates` has gathered ~40 real pubs from Places. So the hard part of
the problem is not open-ended at all. It is:

> Given N candidate pubs, a fixed start and finish, and a hole count n,
> choose n of them and order them.

Fixed endpoints, a subset of a fixed size, a distance objective. That is an
**orienteering problem** — a well-worn shape with heuristics that run in
milliseconds at this size. There is no reason to make a language model
rediscover it one tool call at a time.

So compute the routes first, and give the model the answers to sift.

## What to hand over

**Three to five complete routes**, each with total walk, per-leg distances, and
a one-line character ("shortest", "kindest legs", "most variety"). Diverse on
purpose — two routes sharing eight of nine pubs are one route.

**Four or five nearest neighbours per node**, with distance and the dossier
facts already attached. This is the part that removes the *second* wave of
turns: once the model wants to swap hole 4, the alternatives and their walk
costs are already in front of it. No tool call, no dossier re-read.

Together these mean the model can walk the path, judge each stop against the
brief, and substitute locally — all inside one turn — instead of querying its
way toward a route it cannot see.

## How to build the routes

Cheap and good beats exact. At N≈40 and n≈9, exact is out (choosing and
ordering is far past Held–Karp), and unnecessary:

1. **Seed** several tours — nearest-neighbour from a few different second
   stops, plus one seeded by rating rather than distance so the set is not all
   the same shape.
2. **Improve** each with 2-opt and Or-opt until no move helps. Endpoints pinned
   throughout, since the brief may name a start and a finish.
3. **Diversify** — keep a route only if it differs from those already kept by
   more than a threshold on the pub set (Jaccard is fine). Character comes from
   genuinely different pubs, not a reordering.
4. **Score** for the things the house actually cares about, which is where this
   stops being a textbook TSP: total walk near the brief's target rather than
   merely minimal, no brutal leg, and variety across venue types. A crawl of
   nine identical chain bars can be the shortest route on the map and the worst
   night on it.

Every step is a pure function over the dossier. That is deliberate: it makes
the whole thing unit-testable, which is where `CLAUDE.md` says rules belong —
*"if a browser is proving something a function call could prove, it is in the
wrong place."* `haversineKm` already exists in `lib/route-preview.ts`.

## Where it lives

`lib/caddy/route-graph.ts`, called from `openPlan` right after
`buildCandidates`, with the result folded into the cached prefix alongside the
dossier. It is part of the brief, not a tool — the point is for the model never
to have to ask.

`try_route` in `lib/caddy/tools.ts` stays. A model that wants to score a
combination nobody precomputed should still be able to, and keeping it means
this change reduces turns without removing headroom.

## Why it cannot invent a pub

Worth stating explicitly, because it is the rule this app cannot break. Every
route is a permutation of candidate **ids**. The graph adds no names, no
venues, and no ability to name one — it only reorders things Places returned.
The existing allowlist test over tool schemas continues to hold, because no new
tool input accepts a name.

## How we will know it worked

The same ledger that produced the evidence above. Watch `caddy_turns` for
`cache_read_tokens` on successful plans: today's looped run is 160k on a
failure and 58.8k on the one that landed. If the model stops searching, that
number should fall toward a single dossier read, cost should fall with it, and
the twelve-turn loop should stop being the case that times out.

If it works, `MAX_TOOL_TURNS` can come down as a consequence rather than as a
guess — which is the honest version of the cost cut, since cutting it today
would just make plans fail sooner.

## Refinement: a menu, not a shortlist

The first cut generates three to five routes by seeding greedy from different
origins and filtering on overlap. That gives *variation* — different pubs — but
not *character*: every one of them is trying to be short, so the agent is
choosing between four answers to the same question. Cycling through them means
nothing.

Ten routes is the right number, but only if each one **won a different
objective**. Diversity should come from optimising different things, not from
perturbing one thing.

The objectives, all from data already gathered:

| Route | Optimises | From |
|---|---|---|
| The short one | total walk nearest the target | coordinates |
| The good one | mean rating, weighted by review count | `rating`, `reviewCount` |
| The wide one | breadth of drinks across the card | `servesBeer`/`servesWine`/`servesCocktails` |
| The kind one | no brutal leg | coordinates |
| The mixed one | distinct kinds of place | name brand word |
| The cheap one | `priceLevel` | `priceLevel` |
| The outdoor one | beer gardens | `outdoorSeating` |
| The group one | room for a table of eight | `goodForGroups` |

Plus two or three balanced compromises, which are what the current scorer
already produces. A pub-golf round is a *night*, and these are the axes a host
actually argues about when planning one by hand.

### Drinks belong in the router, not only in the dressing

The house rule is that the caddy must never put a drink on a hole the pub
cannot pour. Today that is enforced when the card is dressed, which is too
late: by then the stops are chosen, and a route where nothing serves spirits
can only be dressed as nine pints.

So drink breadth is a routing objective. A route is scored on whether the card
it could carry is varied — at least one stop that pours a short, at least one
that pours wine — and a route that cannot support a varied card scores worse
before the model ever sees it. That turns a constraint the dressing had to work
around into one the geometry already satisfies.

This is also the cheapest possible place to enforce it. The facts are in the
dossier, the scoring is arithmetic, and a rule proved by a pure function is a
rule that cannot be argued out of by a model having a bad turn.

### What it costs

Nothing meaningful. Ten routes at N≈40 is still milliseconds — the work is in
the distance matrix, which is computed once and shared across every objective.
The block grows, but it sits above the cache breakpoint, so it is paid for once
per session and read free thereafter.

## Decided: what the algorithm does, and what the model does

The question that settled this was "greedy or graph algorithm?", and it is a
false choice worth writing down as one, because the framing hides the lever.

**Greedy nearest-neighbour *is* a graph algorithm — a weak one used alone.**
The real distinction is construction versus improvement. Greedy builds a valid
route fast and lands 15–25% off optimal; it also paints itself into corners and
has to backtrack, **which is exactly the "tight and back and forthy" route a
real host got.** That is greedy's signature failure, not bad luck. Exact
methods are out at forty candidates choose nine.

So: greedy is the seed, 2-opt and swap-in are the fix, and neither replaces the
other. That is what `route-graph.ts` already does. What it was missing was any
term that could *see* backtracking, which is why `detour` — walk divided by
straight-line progress — now scores it.

### The division of labour

**The model shines at tuning, not at planning.** This is the whole diagnosis of
the evening: every failure was a language model doing search work that
arithmetic does in microseconds. Judging whether a pub suits a brief is
judgement; finding a short walk is not.

So the algorithm hands over a finished menu, and the model picks and adjusts.

### Rejected: the serial shortlist

The tempting version is a cycle — take a route, tweak it, keep or reject,
fetch the next, and on through the shortlist. It models how a person would do
it, and it is the wrong shape here for one reason: **it is turns, and turns are
what has been failing.** Nine stops decided one per turn is nine turns; a
shortlist worked serially is worse.

It is also unnecessary. Ten routes in the prompt at once can be reasoned about
in a single turn, which is strictly better than cycling — nothing needs to be
remembered across turns if everything is in front of the model at once. One
pass, not a loop.

### Accepted: corridor queries

Per-node neighbours answer "what is near hole 4". The better question is "what
is near *this walk*" — distance to the polyline rather than to a node — which
is what answers "a cocktail bar within 300m of the route" when a brief asks for
something the chosen stops cannot give. Cheap: a filter over the candidates
against the path, no new data.

This supersedes the k-nearest lists for adjustment, though those stay for the
cheap common case of swapping one stop.

### Accepted: keep and revert

The one tool-loop feature genuinely worth having. Tweaking is destructive
today, so a model has to be conservative with a card that is already decent.
Snapshotting the board, trying a variation, and reverting if it scores worse
is bounded, cheap, and exactly what a loop is for — unlike search, which is
what it was being used for.
