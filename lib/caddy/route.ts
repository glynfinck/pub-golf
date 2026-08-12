import {
  haversineKm,
  kmForWalkMinutes,
  WALK_MINUTES_PER_KM,
} from "@/lib/geo";

/**
 * The walking order, decided by arithmetic rather than by the model.
 *
 * The caddy chooses *which* pubs — that is judgment, and it is what the vibe,
 * the particulars, the reviews and the editorial line are all for. Choosing the
 * **order** is not judgment, it is geometry, and a language model is poor at it
 * in a specific and visible way: it produces a plausible-looking sequence that
 * doubles back, crosses itself, and reads on a map as scatter rather than a
 * walk. The first real card this app generated did exactly that.
 *
 * This is the house rule about layers, applied one level down. `CLAUDE.md` says
 * a rule belongs in the lowest layer that can hold it — if a browser is proving
 * something a function call could prove, it is in the wrong place. The same is
 * true a rung lower: if a model is computing something a function can compute,
 * it is in the wrong place. So the model keeps the taste and gives up the
 * trigonometry, and the ordering becomes deterministic, testable, instant and
 * free of tokens.
 *
 * The problem is an open travelling-salesman *path* — no return to the start —
 * with optionally fixed endpoints, over at most eighteen stops. That is small
 * enough that the classic pairing is more than good enough:
 *
 *   1. **Nearest neighbour** from every allowed starting point, keeping the
 *      best tour found. Cheap (n³ at this size, microseconds) and it beats
 *      running the greedy walk once from an arbitrary start, which is where
 *      nearest neighbour usually embarrasses itself.
 *   2. **2-opt** until nothing improves. This is the part that answers the
 *      actual complaint: reversing a segment whenever it shortens the path
 *      provably removes every crossing, and a route with no crossings is what
 *      "a continuous shape" means when you look at it on a map.
 *
 * Exact Held-Karp would fit eighteen stops in principle and is not worth it:
 * 2-opt lands within a couple of per cent on instances this small, and nobody
 * walking between pubs can tell two per cent from optimal.
 */

export interface WalkStop {
  lat: number | null;
  lng: number | null;
}

/**
 * What shape the night should be.
 *
 * These are genuinely different optimisation problems, not presets over one
 * answer, which is why they live here rather than in the prompt:
 *
 *   `path` — an open walk. Start somewhere, finish somewhere else, shortest
 *     total distance. The default, and what most crawls are: you end up where
 *     the night takes you.
 *
 *   `loop` — a closed tour that finishes back where it started. A different
 *     objective entirely: the last leg counts, so the solver optimises a cycle
 *     rather than a path. Worth having because a real group often needs to end
 *     where they parked, where the taxis are, or where somebody lives.
 *
 * A loop is always at least as long as the best path over the same pubs — you
 * are paying for the walk home — so this is a real trade the host is making,
 * not a free preference.
 */
export type WalkShape = "path" | "loop";

/**
 * The minimum a leg should be, and what happens when it is not.
 *
 * Shortest-total-distance is the classic objective and it is subtly the wrong
 * one for a pub crawl. Given three pubs on the same corner, the shortest route
 * visits all three back to back — which is optimal arithmetic and a poor night.
 * A crawl wants to *go somewhere*; the walk between rounds is the part that
 * sobers you up, and three doors in a row is one long session in disguise.
 *
 * So the objective gains two penalties, both measured in kilometres so they
 * trade honestly against the distance they are competing with:
 *
 *   `SHORT_LEG_WEIGHT` — a mild, proportional cost for any leg under the
 *     minimum. Mild because a short hop now and then is fine and sometimes
 *     unavoidable; the patch is what it is.
 *
 *   `SHORT_RUN_WEIGHT` — a heavy cost for a *second* consecutive short leg,
 *     which is precisely the "three pubs next to each other" shape. This is
 *     the one doing the work, and it is deliberately several times the other:
 *     one short hop is a quirk, two in a row is a bad card.
 *
 * Both scale with the minimum, so a host who asks for a longer stretch gets
 * proportionally stronger spacing rather than a differently-tuned algorithm.
 */
export const SHORT_LEG_WEIGHT = 1;
export const SHORT_RUN_WEIGHT = 4;

/** Which stops must stay where they are, as indices into the input. */
export interface WalkPins {
  /** The host's pinned first tee. */
  first?: number | null;
  /** The host's pinned last hole. Ignored for a loop, where the last hole is
   * by definition the one nearest home rather than one you choose. */
  last?: number | null;
  /** Default `path`. */
  shape?: WalkShape;
  /**
   * How long the shortest comfortable walk between two pubs should be, in
   * minutes. Zero turns spacing off and restores plain shortest-distance.
   */
  minLegMinutes?: number;
}

/** A stop we can actually measure. Anything without coordinates cannot be
 * routed and is left exactly where it was — see `orderWalk`. */
function placed(stop: WalkStop): boolean {
  return stop.lat != null && stop.lng != null;
}

function legKm(a: WalkStop, b: WalkStop): number {
  if (!placed(a) || !placed(b)) return 0;
  return haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number);
}

/** The whole walk, end to end. The number 2-opt is minimising, and the one a
 * test compares before and after. */
export function walkKm(stops: WalkStop[]): number {
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) total += legKm(stops[i], stops[i + 1]);
  return total;
}

/** Distances, computed once. n is at most eighteen, so this is a rounding error
 * in both time and memory, and it keeps the inner loops free of trigonometry. */
function matrix(stops: WalkStop[]): number[][] {
  return stops.map((from) => stops.map((to) => legKm(from, to)));
}

/** Every leg of a route, in order, including the walk home on a loop. */
function legsOf(order: number[], dist: number[][], loop: boolean): number[] {
  const legs: number[] = [];
  for (let i = 0; i < order.length - 1; i++) legs.push(dist[order[i]][order[i + 1]]);
  if (loop && order.length > 1) legs.push(dist[order[order.length - 1]][order[0]]);
  return legs;
}

/**
 * What the solver actually minimises: distance, plus what the spacing rule
 * thinks of it.
 *
 * Evaluated over the whole route rather than as an edge delta, because "was
 * the previous leg also short" is not a property of one edge. At eighteen
 * stops that costs nothing and it keeps the rule readable, which matters more
 * than the microseconds.
 */
function routeCost(
  order: number[],
  dist: number[][],
  loop: boolean,
  minKm: number,
): number {
  const legs = legsOf(order, dist, loop);
  let cost = legs.reduce((total, leg) => total + leg, 0);
  if (minKm <= 0) return cost;

  let previousShort = false;
  for (const leg of legs) {
    const short = leg < minKm;
    if (short) {
      // Proportional to how far under it fell, so a 30-second hop is worse
      // than a four-minute one rather than equally bad.
      const shortfall = (minKm - leg) / minKm;
      cost += SHORT_LEG_WEIGHT * minKm * shortfall;
      if (previousShort) cost += SHORT_RUN_WEIGHT * minKm;
    }
    previousShort = short;
  }
  return cost;
}

/**
 * Greedy nearest neighbour from a given start, holding the last stop back so a
 * pinned finish stays the finish.
 */
function nearestNeighbour(
  start: number,
  dist: number[][],
  count: number,
  last: number | null,
): number[] {
  const order = [start];
  const used = new Set([start]);
  if (last !== null) used.add(last);

  while (order.length + (last !== null ? 1 : 0) < count) {
    const from = order[order.length - 1];
    let best = -1;
    let bestKm = Infinity;
    for (let to = 0; to < count; to++) {
      if (used.has(to)) continue;
      if (dist[from][to] < bestKm) {
        bestKm = dist[from][to];
        best = to;
      }
    }
    if (best === -1) break;
    used.add(best);
    order.push(best);
  }
  if (last !== null) order.push(last);
  return order;
}

/**
 * 2-opt: reverse any segment that shortens the walk, repeatedly.
 *
 * The endpoints are held fixed — `from` starts at 1 when the first stop is
 * pinned and `to` stops short of the end when the last is — so an improvement
 * pass can never quietly move a tee the host chose.
 */
function twoOpt(
  order: number[],
  dist: number[][],
  fixFirst: boolean,
  fixLast: boolean,
  loop: boolean,
  minKm: number,
): number[] {
  let route = [...order];
  let cost = routeCost(route, dist, loop, minKm);
  const lo = fixFirst ? 1 : 0;
  // On a loop the final stop is not an endpoint — it has an edge back to the
  // start — so it is fair game for reversal like any interior stop.
  const hi = fixLast && !loop ? route.length - 2 : route.length - 1;
  // Bounded so a pathological instance cannot spin: at this size it converges
  // in a handful of passes, and the cap is far above that.
  for (let pass = 0; pass < 64; pass++) {
    let improved = false;
    for (let i = lo; i < hi; i++) {
      for (let j = i + 1; j <= hi; j++) {
        const candidate = [...route];
        let a = i;
        let b = j;
        while (a < b) {
          [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
          a++;
          b--;
        }
        const next = routeCost(candidate, dist, loop, minKm);
        // A strict epsilon, so floating-point noise cannot make this loop
        // forever swapping two equivalent routes back and forth.
        if (next < cost - 1e-9) {
          route = candidate;
          cost = next;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return route;
}

/**
 * Put the stops in walking order.
 *
 * Returns a new array; the input is untouched. Stops without coordinates keep
 * their original positions — they cannot be measured, so moving them would be
 * guessing, and the caddy's own placement is a better guess than ours. Only the
 * measurable stops are permuted, among the slots they already occupied.
 *
 * Pins are honoured absolutely. A pinned first or last stop ends where the host
 * put it, both in construction and after every improvement pass.
 */
export function orderWalk<T extends WalkStop>(
  stops: T[],
  pins: WalkPins = {},
): T[] {
  // Which slots hold a stop we can measure. Everything else stays put.
  const slots: number[] = [];
  stops.forEach((stop, index) => {
    if (placed(stop)) slots.push(index);
  });
  if (slots.length < 3) return [...stops];

  const routable = slots.map((index) => stops[index]);
  const dist = matrix(routable);
  const loop = pins.shape === "loop";
  const minKm = kmForWalkMinutes(Math.max(0, pins.minLegMinutes ?? 0));

  // Pins arrive as indices into the caller's array; translate them into the
  // routable subsequence, and ignore a pin on a stop we cannot measure.
  const pinFirst = pins.first == null ? -1 : slots.indexOf(pins.first);
  const pinLast = pins.last == null ? -1 : slots.indexOf(pins.last);
  const fixFirst = pinFirst >= 0;
  // A loop comes back to the first tee, so "which pub is last" is not the
  // host's to choose — it is whichever one sits nearest the way home.
  const fixLast = !loop && pinLast >= 0 && pinLast !== pinFirst;

  const starts = fixFirst
    ? [pinFirst]
    : Array.from({ length: routable.length }, (_, i) => i).filter(
        (i) => i !== (fixLast ? pinLast : -1),
      );

  let best: number[] | null = null;
  let bestKm = Infinity;
  for (const start of starts) {
    const greedy = nearestNeighbour(
      start,
      dist,
      routable.length,
      fixLast ? pinLast : null,
    );
    const tuned = twoOpt(greedy, dist, fixFirst, fixLast, loop, minKm);
    const km = routeCost(tuned, dist, loop, minKm);
    if (km < bestKm) {
      bestKm = km;
      best = tuned;
    }
  }
  if (!best) return [...stops];

  // Never hand back a worse walk than we were given. 2-opt cannot lengthen a
  // route, but the greedy construction is free to, so this is the guarantee
  // that turning routing on can only ever help.
  const asGiven = routeCost(
    slots.map((_, i) => i),
    dist,
    loop,
    minKm,
  );
  if (asGiven <= bestKm) return [...stops];

  const out = [...stops];
  best.forEach((from, i) => {
    out[slots[i]] = routable[from];
  });
  return out;
}

// ————————————————— what the caddy gets to see —————————————————

/** One leg of a trial route, in the terms the brief is actually written in. */
export interface TrialLeg {
  from: string;
  to: string;
  minutes: number;
  /** Under the host's minimum comfortable walk. */
  short: boolean;
}

/** A proposed set of pubs, routed and measured. */
export interface RouteTrial {
  /** The ids in walking order — which is *not* the order they were offered
   * in, and is the first thing worth reading. */
  order: string[];
  legs: TrialLeg[];
  totalMinutes: number;
  /** How many legs came in under the minimum. */
  shortLegs: number;
  /** The longest run of consecutive short legs — three pubs on one corner
   * shows up here as 2 and nowhere else, which is exactly the complaint that
   * put the spacing rules in. */
  worstRun: number;
  /** Ids that could not be routed because nothing knows where they are. They
   * keep their slot and are excluded from every measurement above. */
  unplaced: string[];
}

/**
 * Route a proposed card and hand back what it actually walks like.
 *
 * This exists because of an asymmetry that was quietly costing every card:
 * `orderWalk` runs *after* the caddy has answered, so every spacing rule in
 * the brief — minimum leg, no three on one corner, the shape of the night —
 * was enforced downstream of the decision that determines it. The caddy was
 * told "spread out" in prose and never got to check whether it had. The
 * penalty weights in `routeCost` exist to repair picks the model could not
 * evaluate.
 *
 * Given to the caddy as a tool, this closes that loop: propose, measure,
 * revise. And it measures rather than judges — legs in minutes, a count of
 * short ones, the worst run — because a number is something a model can tell
 * it has improved, and "is this a good walk" is not.
 *
 * The routing is the same `orderWalk` the finished card goes through, so a
 * trial is a promise rather than an estimate: what it reports is what the
 * host will get.
 */
export function tryRoute<T extends WalkStop & { id: string }>(
  stops: T[],
  pins: WalkPins = {},
): RouteTrial {
  const ordered = orderWalk(stops, pins);
  const minKm = kmForWalkMinutes(Math.max(0, pins.minLegMinutes ?? 0));
  const legs: TrialLeg[] = [];
  let worstRun = 0;
  let run = 0;

  const closing = pins.shape === "loop" && ordered.length > 2;
  const pairs = ordered.slice(1).map((stop, index) => [ordered[index], stop] as const);
  if (closing) pairs.push([ordered[ordered.length - 1], ordered[0]] as const);

  pairs.forEach(([from, to]) => {
    const km = legKm(from, to);
    const short = minKm > 0 && km < minKm;
    legs.push({
      from: from.id,
      to: to.id,
      minutes: Math.max(1, Math.round(km * WALK_MINUTES_PER_KM)),
      short,
    });
    run = short ? run + 1 : 0;
    if (run > worstRun) worstRun = run;
  });

  return {
    order: ordered.map((stop) => stop.id),
    legs,
    totalMinutes: legs.reduce((total, leg) => total + leg.minutes, 0),
    shortLegs: legs.filter((leg) => leg.short).length,
    worstRun,
    unplaced: ordered.filter((stop) => !placed(stop)).map((stop) => stop.id),
  };
}

/**
 * Walk the middle in the order it is passed.
 *
 * `orderWalk` above answers "what is the shortest way round these pubs", which
 * is the wrong question for a crawl: the shortest tour of a dense patch is a
 * lap of one block. A real card came back covering 2.47km of walking to make
 * 0.97km of ground, running forward and back along its own line three times.
 *
 * This fixes the ends and sorts everything between them by how far along the
 * line from first to last each pub sits. With the endpoints held, a walk
 * ordered by that projection **cannot** double back — it is monotone by
 * construction rather than by penalty, which is the difference between this
 * and every scoring term that tried to discourage the same thing.
 *
 * Distance is given up to buy it, on purpose. A hundred metres more walking is
 * a fair price for a night that goes somewhere.
 *
 * Fewer than four stops has no interior worth sorting, and a first and last in
 * the same spot has no line to sort along — both are returned untouched.
 */
export function forwardOrder<T extends WalkStop>(
  stops: T[],
  pins: { first?: boolean; last?: boolean } = {},
): T[] {
  if (stops.length < 4) return [...stops];
  const placedStops = stops.filter(placed);
  if (placedStops.length < 3) return [...stops];

  // The line the night travels: between the two pubs furthest apart. Using
  // first-to-last instead was the near miss — with nothing pinned there is no
  // reason the pub that happens to be first is the one furthest back, and a
  // real card opened by walking 200m the wrong way before settling down.
  // Ties are broken on the coordinates themselves rather than on array order,
  // and that is not tidiness. A shape with several equally-widest pairs — a
  // ring is the plain example — otherwise picks a different axis depending on
  // what order the stops arrive in, so ordering an ordered walk changes it
  // again. Property tests caught it; the cost would have been cache misses on
  // every turn of a plan, since the routes ride in the cached prefix.
  const key = (stop: T) => `${stop.lat},${stop.lng}`;
  let a = placedStops[0];
  let b = placedStops[1];
  let widest = -1;
  let widestKey = "";
  for (let i = 0; i < placedStops.length; i += 1) {
    for (let j = i + 1; j < placedStops.length; j += 1) {
      const scale = Math.cos((placedStops[i].lat as number) * (Math.PI / 180));
      const dx = ((placedStops[j].lng as number) - (placedStops[i].lng as number)) * scale;
      const dy = (placedStops[j].lat as number) - (placedStops[i].lat as number);
      const span = dx * dx + dy * dy;
      const pair = [key(placedStops[i]), key(placedStops[j])].sort().join("|");
      const better =
        span > widest + 1e-12 || (span > widest - 1e-12 && pair < widestKey);
      if (better) {
        widest = Math.max(span, widest);
        widestKey = pair;
        a = placedStops[i];
        b = placedStops[j];
      }
    }
  }
  if (widest <= 0) return [...stops];

  const scale = Math.cos((a.lat as number) * (Math.PI / 180));
  const ax = ((b.lng as number) - (a.lng as number)) * scale;
  const ay = (b.lat as number) - (a.lat as number);
  const len = Math.hypot(ax, ay);
  const along = (stop: T) => {
    if (!placed(stop)) return Number.POSITIVE_INFINITY;
    const dx = ((stop.lng as number) - (a.lng as number)) * scale;
    const dy = (stop.lat as number) - (a.lat as number);
    return (dx * ax + dy * ay) / len;
  };

  // Pinned tees stay at their ends and everything else is walked in the order
  // the line passes it. With nothing pinned every stop is free to move, which
  // is what makes the whole walk monotone rather than merely its middle.
  const head = pins.first ? [stops[0]] : [];
  const tail = pins.last ? [stops[stops.length - 1]] : [];
  const middle = stops.slice(head.length, stops.length - tail.length);
  const sorted = [...middle].sort((x, y) => along(x) - along(y));
  return [...head, ...sorted, ...tail];
}
