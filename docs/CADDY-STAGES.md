# Stages, not a loop

A redesign of how a plan is produced. **Built**, and this is the record of
why — the per-turn timeout (`TURN_TIMEOUT_MS`), the rewritten system prompt,
and the routes-first drafting table all shipped. Read it for the reasoning; the
code is `lib/caddy/client.ts` and `lib/caddy/plan.ts`.

## What is actually wrong

Three failures this evening, one cause.

**The plan times out.** `outOfLoopTime` is checked *between* turns, but a single
turn is unbounded — `max_tokens` is 16k, so one can run for minutes. The loop
checks the clock at 250s, decides it has room, starts a turn, and the platform
kills the function at 300s. Mid-call. Before the loop exits, before the
fallback board, before `runTurn` writes anything. The money is spent and no row
records that it happened.

**The caddy ignores the route graph.** The graph is in the prompt, above the
cache breakpoint, exactly as designed. But `CADDY_SYSTEM_TOOLS` still describes
a search-and-refine workflow, and the model does what it is told. Handing a
model better data does not change its instructions — it just gives it something
else to read while it does the thing it was told to do.

**The map stays empty.** The pins light and the line draws off `picked` events,
which are emitted from tool calls. A model that spends its turns searching
emits none, so there is nothing to draw. Same cause as above, seen from the
front.

The loop is the common factor. It is open-ended by construction, so it cannot
be bounded honestly, cannot be made to converge, and cannot promise the host
anything about when it will finish.

## The shape instead

Two calls, each bounded, each answering one question. No loop in the common
case.

### Stage one — choose the walk

**In:** the dossier, the precomputed routes, the brief.
**Out:** a route id, plus any swaps, as structured JSON.
**Bounded:** a few hundred output tokens. There is nothing to write but ids.

The model is not asked to *find* a route — the graph already did, and it did it
in milliseconds. It is asked to judge which of four fits the brief, and to swap
individual stops using the neighbour lists that are already in front of it.
That is a judgement task, which is what a model is for; the search was never
one.

The chosen stops go straight out as a `picked` event, so the map draws the
whole walk the moment stage one lands — seconds in, rather than never.

### Stage two — dress the holes

**In:** the chosen stops, their dossier entries, the house rules.
**Out:** the card — drink, par, hazard, local rules, course name.
**Bounded:** one hole's worth of writing per hole.

This is the part that genuinely needs a model, and it needs no tools at all:
every fact it draws on is already in the dossier. It is also the part a host
notices, because it is the part they read.

### Stage three — only when asked

Tweaks stay exactly as they are: one call, the patch already cached, the host
saying what to change. Nothing about this design touches them.

## What it fixes, and why

**Timeouts stop being a risk rather than being tuned.** Two bounded calls of a
few hundred and a few thousand tokens finish in a fraction of the window. There
is no clock to check between turns because there are no turns.

**Cost falls by roughly an order of magnitude.** Today's runs spent 6.7k–15.3k
output tokens and read the dossier back a dozen times — 160k of cache reads on
the failure. Two calls read the prefix twice.

**The graph gets used, because using it is the whole instruction.** Stage one's
system prompt has one job. There is no competing workflow to fall back into.

**The map fills in immediately**, because the chosen stops exist as data at the
end of stage one instead of accumulating through tool calls.

**A partial answer is still a card.** If stage two fails, stage one's route is a
real walk over real pubs and can be dressed with defaults — the fallback that
exists today, but reached by a path that actually runs.

## What is given up

The tool loop can do things two stages cannot: search for more pubs mid-plan
when the patch is thin, and check a route it invented. Worth being honest that
this is a real loss, and worth keeping `try_route` and the search tool
available to stage one as *optional* calls rather than the expected workflow.

The bet is that they are rarely needed now the graph exists, because what the
loop mostly used them for was rediscovering geometry that is now precomputed.
If stage one starts reaching for search often, that is a signal the patch
gather is too thin — a different fix, in a cheaper place.

## Ordering

1. **Bound the call before anything else.** Per-call `AbortSignal.timeout`, and
   write the turn row *before* streaming the card rather than after. Today a
   killed function leaves no evidence and no recoverable card; that is the bug
   that hid every other one, and it is worth fixing on its own.
2. Stage one, behind the existing plan entry point.
3. Stage two.
4. Delete the loop once both have run for a week, not before.

Step one stands on its own and should ship first regardless of whether the rest
of this is agreed.
