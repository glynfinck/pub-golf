import type { CandidateDossier, PubFacts } from "@/lib/caddy/dossier";
import {
  DWELL_MINUTES,
  LAST_ORDERS_MARGIN,
  openAt,
  openFor,
  type OpenWindow,
  type TeeOff,
} from "@/lib/caddy/hours";
import { walkCrossings, type Barrier } from "@/lib/caddy/barriers";
import {
  alongStrokeKm,
  distanceToStrokeKm,
  strokeFit,
  strokeLengthKm,
  type StrokePoint,
} from "@/lib/caddy/stroke";
import { haversineKm, WALK_MINUTES_PER_KM } from "@/lib/geo";

/**
 * The map, worked out before the caddy is asked.
 *
 * A plan used to cost a dozen turns because the model was *searching* — call a
 * tool, get a slice of the map, call again — and every call dragged the whole
 * dossier back through the context. One such plan burned 160k cache reads and
 * 29.20p and timed out with no card, which is more than a successful plan
 * costs — measured against real patches while this was built.
 *
 * The search was never necessary. By the time the model runs, the candidate set
 * is fixed — Places has already returned its forty pubs — so the problem is
 * "choose n of N and order them, endpoints pinned". That is an orienteering
 * problem with heuristics that run in milliseconds at this size, and there is
 * no reason to make a language model rediscover them one tool call at a time.
 *
 * So this module answers it up front and hands over the answers: a handful of
 * genuinely different routes, and the nearest alternatives to every stop on
 * them. The model's job becomes choosing and adjusting, which is one turn.
 *
 * **Pure, and deliberately so.** Candidates in, routes out. No clock, no
 * network, no database — which is what lets the whole of it be proved in the
 * unit tier, where CLAUDE.md says rules belong.
 *
 * **It cannot invent a pub.** Every route is a permutation of candidate ids.
 * Nothing here constructs a name, and nothing here can: the only strings it
 * reads are ids and names it was given.
 */

/** A candidate that actually has a position. One without coordinates cannot be
 * routed and is dropped here rather than defaulting to zero, which would put a
 * pub in the Gulf of Guinea and make it look like the nearest thing to
 * everything. */
export interface RouteNode {
  id: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  facts: PubFacts;
  /** Opening windows, or null/undefined for unknown — which never punishes. */
  hours?: OpenWindow[] | null;
  /** Chains repeat their name, so the normalised name is a good enough
   * "kind of place" for variety scoring without needing a taxonomy. */
  kind: string;
}

export interface Neighbour {
  id: string;
  km: number;
}

export interface RouteLeg {
  from: string;
  to: string;
  km: number;
}

export interface PlannedRoute {
  /** Candidate ids, in walking order. */
  stops: string[];
  legs: RouteLeg[];
  totalKm: number;
  /** The longest single leg — the one that decides whether a route is a walk
   * or a trek, which an average hides completely. */
  worstLegKm: number;
  /** Distinct `kind`s across the stops. Nine identical chain bars can be the
   * shortest route on the map and the worst night on it. */
  variety: number;
  /** How far the walk actually gets you: the straight line from the first stop
   * to the last. A crawl that ends where it started has none. */
  progressKm: number;
  /** Walk divided by progress. One is a straight line; three is a night spent
   * doubling back through the same two streets, which is what "tight and back
   * and forthy" means as a number. */
  detour: number;
  /** Why this one is in the set, for the model to read: "shortest",
   * "kindest legs", "most variety". */
  character: string;
}

export interface RouteGraph {
  /** Every routable stop, by id. */
  nodes: RouteNode[];
  /** The k nearest other candidates to each node, nearest first. This is what
   * removes the *second* wave of turns: when the model wants to swap a hole,
   * the alternatives and their costs are already in front of it. */
  neighbours: Record<string, Neighbour[]>;
  /** A few genuinely different complete routes, best first. */
  routes: PlannedRoute[];
}

export interface RouteRequest {
  /** How many stops the round wants. */
  holes: number;
  /** Pinned first and last stops, where the brief named them. */
  startId?: string | null;
  finishId?: string | null;
  /** The walk the host asked for. Routes are scored on *nearness to* this, not
   * on being as short as possible — a crawl is not better for being shorter,
   * and the shortest tour of nine pubs is usually nine pubs on one street. */
  targetKm?: number | null;
  /** How many alternatives to offer per stop. */
  neighbours?: number;
  /** How many routes to hand over. */
  routes?: number;
  /**
   * The middles of the two areas the host named.
   *
   * With no pinned venues the walk's axis is a *line* and nothing says which
   * way along it to travel — a real round asked to finish in Covent Garden
   * walked the right corridor westwards into Marylebone, because "the two
   * furthest-apart candidates" has no direction in it. These give it one: the
   * walk starts at the pub nearest the first middle and finishes at the pub
   * nearest the second, which is what a host means by going from one place to
   * another.
   */
  aimFrom?: { lat: number; lng: number } | null;
  aimTo?: { lat: number; lng: number } | null;
  /**
   * When the round tees off, or null for "no day named". A route is a
   * schedule: with a tee-off on the brief the exact DP refuses to build a
   * state that arrives after a pub shuts, every constructed walk is checked
   * whole (`walkFeasible`), and the menu prefers walks that stay open —
   * falling back to the unchecked set only when nothing passes, because a
   * late-night patch with thin hours data must still get a card.
   */
  teeOff?: TeeOff | null;
  /**
   * The walk, drawn. `principalAxis` guesses the direction of travel from
   * the candidate cloud; a stroke states it. When present, "how far along"
   * becomes arc-length along this line — the forward walks stay monotone
   * along a *curve*, and "forward" means the way the stroke was drawn.
   */
  stroke?: StrokePoint[] | null;
  /** Geography a straight line cannot see: rivers and rail with their
   * bridges (`lib/caddy/barriers.ts`). Walks that cross one anywhere but a
   * gate are offered only when nothing better exists. */
  barriers?: Barrier[] | null;
}

const DEFAULT_NEIGHBOURS = 5;
/** Ten objectives, so up to ten routes — but only where they genuinely differ.
 * The block sits above the cache breakpoint, so it is written once a session
 * and read free thereafter; the cost of a longer menu is one prompt, not one
 * per turn. */
const DEFAULT_ROUTES = 10;

/**
 * Two routes sharing all but one stop are one route wearing two hats. Handing
 * both over spends context to offer no choice, so a candidate must differ by
 * more than this share of its stops to earn a place.
 */
const DIVERSITY_FLOOR = 0.3;

/**
 * How hard the snake insists on getting somewhere, in kilometres of detour it
 * will accept per kilometre of progress.
 *
 * Three of them, so the menu carries a tight cluster *and* a walk across the
 * neighbourhood and the model can pick which the brief wants. Near zero is
 * ordinary nearest-neighbour and will bunch; the top of the range strings the
 * night out along the high street. This is the dial to turn when routes come
 * back too tight or too strung out.
 */
const SNAKE_DRIFTS = [0.2, 0.7, 1.4];

/**
 * The drifts to try for a given brief.
 *
 * The fixed ladder above covers ordinary rounds and cannot cover a long one.
 * `drift` is kilometres of detour accepted per kilometre of progress, so a
 * round that has to reach four kilometres needs a far greater appetite for
 * ground than one crossing a neighbourhood — and with only the fixed values on
 * offer, a host who asked for Covent Garden got the tightest route the patch
 * allowed and no way to say otherwise.
 *
 * So the ladder gains a rung sized to the leg the brief actually demands. It
 * is added rather than substituted: a long target should not stop the router
 * also offering something tighter, since the model still chooses.
 */
export function driftsFor(targetKm: number | null, holes: number): number[] {
  if (!targetKm || targetKm <= 0) return SNAKE_DRIFTS;
  const perLeg = targetKm / Math.max(holes - 1, 1);
  // Above 1.0 a forward step costs less than nothing, which is what makes the
  // program reach for distant pubs rather than merely accept them — so a round
  // that has to cover ground needs to start there rather than end there.
  const demanded = Math.round(Math.max(0.2, 0.6 + perLeg * 2) * 100) / 100;
  return SNAKE_DRIFTS.includes(demanded)
    ? SNAKE_DRIFTS
    : [...SNAKE_DRIFTS, demanded];
}

/** Chains give themselves away by repeating their name, which is all the
 * "kind of place" this needs. Punctuation and the branch suffix go, so
 * "BrewDog Shoreditch" and "Brewdog — Camden" read as one kind. */
export function kindOf(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    // A leading "the" is on half the pubs in the country and distinguishes
    // none of them, so it goes before the brand word is taken.
    .filter((word, index) => !(index === 0 && word === "the"));
  // One word, because the brand is the first and the branch is the rest:
  // keeping two made "BrewDog Shoreditch" and "BrewDog Camden" two kinds,
  // which is the exact case this is meant to catch.
  return words[0] ?? name.toLowerCase();
}

/** The candidates that can actually be walked between. */
export function routableNodes(candidates: CandidateDossier[]): RouteNode[] {
  const nodes: RouteNode[] = [];
  for (const candidate of candidates) {
    if (
      typeof candidate.lat !== "number" ||
      typeof candidate.lng !== "number"
    ) {
      continue;
    }
    nodes.push({
      id: candidate.id,
      lat: candidate.lat,
      lng: candidate.lng,
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      priceLevel: candidate.priceLevel,
      facts: candidate.facts,
      hours: candidate.hours ?? null,
      kind: kindOf(candidate.name),
    });
  }
  return nodes;
}

/** Every pairwise distance, once. At N≈40 this is 1,600 haversines — free, and
 * far cheaper than recomputing inside the improvement loops. */
function distances(nodes: RouteNode[]): Map<string, Map<string, number>> {
  const table = new Map<string, Map<string, number>>();
  for (const from of nodes) table.set(from.id, new Map());
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const km = haversineKm(
        nodes[i].lat,
        nodes[i].lng,
        nodes[j].lat,
        nodes[j].lng,
      );
      table.get(nodes[i].id)!.set(nodes[j].id, km);
      table.get(nodes[j].id)!.set(nodes[i].id, km);
    }
  }
  return table;
}

const gap = (
  table: Map<string, Map<string, number>>,
  from: string,
  to: string,
): number =>
  from === to ? 0 : (table.get(from)?.get(to) ?? Number.POSITIVE_INFINITY);

/** The k nearest others to each node. */
export function nearestNeighbours(
  nodes: RouteNode[],
  k: number,
  table = distances(nodes),
): Record<string, Neighbour[]> {
  const out: Record<string, Neighbour[]> = {};
  for (const node of nodes) {
    out[node.id] = nodes
      .filter((other) => other.id !== node.id)
      .map((other) => ({ id: other.id, km: gap(table, node.id, other.id) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, k);
  }
  return out;
}

function walk(
  table: Map<string, Map<string, number>>,
  stops: string[],
): number {
  let km = 0;
  for (let i = 1; i < stops.length; i += 1)
    km += gap(table, stops[i - 1], stops[i]);
  return km;
}

/**
 * The direction the night travels.
 *
 * Pinned tees give it outright. Otherwise it is the patch's own long axis —
 * the direction its pubs are most spread out along, which for a real
 * neighbourhood is the high street rather than a compass point.
 *
 * Computed on a local flat projection: a degree of longitude is only about
 * six-tenths of a degree of latitude at London's latitude, and an axis found
 * in raw degrees would lean wrongly east-west.
 */
export function principalAxis(
  nodes: RouteNode[],
  from?: RouteNode | null,
  to?: RouteNode | null,
): { x: number; y: number } {
  const scale = Math.cos((nodes[0]?.lat ?? 51.5) * (Math.PI / 180));
  const norm = (x: number, y: number) => {
    const len = Math.hypot(x, y);
    return len < 1e-9 ? { x: 1, y: 0 } : { x: x / len, y: y / len };
  };
  if (from && to) return norm((to.lng - from.lng) * scale, to.lat - from.lat);

  const meanLat = nodes.reduce((a, n) => a + n.lat, 0) / nodes.length;
  const meanLng = nodes.reduce((a, n) => a + n.lng, 0) / nodes.length;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const node of nodes) {
    const dx = (node.lng - meanLng) * scale;
    const dy = node.lat - meanLat;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  // The principal eigenvector of a 2x2 symmetric matrix, in closed form.
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  return norm(Math.cos(theta), Math.sin(theta));
}

/** How far along the direction of travel a pub sits, in kilometres. */
function along(
  node: RouteNode,
  axis: { x: number; y: number },
  origin: RouteNode,
): number {
  const scale = Math.cos(origin.lat * (Math.PI / 180));
  const dx = (node.lng - origin.lng) * scale * 111.32;
  const dy = (node.lat - origin.lat) * 111.32;
  return dx * axis.x + dy * axis.y;
}

/**
 * Does this walk stay ahead of closing time?
 *
 * The schedule is arithmetic: arrival at stop *i* is tee-off, plus the walk
 * so far, plus a dwell for every hole already drunk. Every stop must be open
 * at its arrival, and the finish — the hole nobody leaves — must have at
 * least the last-orders margin left in it. Unknown hours pass everything:
 * thin data is not a shut door.
 */
export function walkFeasible(
  table: Map<string, Map<string, number>>,
  byId: Map<string, RouteNode>,
  stops: string[],
  teeOff: TeeOff | null | undefined,
): boolean {
  if (!teeOff) return true;
  let walked = 0;
  for (let i = 0; i < stops.length; i += 1) {
    if (i > 0)
      walked += gap(table, stops[i - 1], stops[i]) * WALK_MINUTES_PER_KM;
    const node = byId.get(stops[i]);
    if (!node) return false;
    const arrival = teeOff.minutes + Math.round(walked) + i * DWELL_MINUTES;
    if (!openAt(node.hours, teeOff.day, arrival)) return false;
    if (i === stops.length - 1) {
      const left = openFor(node.hours, teeOff.day, arrival);
      if (left !== null && left < LAST_ORDERS_MARGIN) return false;
    }
  }
  return true;
}

/**
 * The best forward walk there is, chosen whole.
 *
 * `snakeWalk` below cannot reverse along the axis, and that was not enough: it
 * still picked each step greedily, so it took the locally cheapest pub in
 * front of it and wandered sideways doing it. Monotone along the axis and
 * zigzagging across it looks, on a map, exactly like looping back.
 *
 * The ordering is what makes the whole route cheap to optimise properly.
 * Sorted by position along the direction of travel, a no-backtracking walk is
 * an *increasing subsequence*, and the cheapest one of a given length is a
 * dynamic program rather than a search:
 *
 *   best[k][j] = min over i before j of best[k-1][i] + step(i, j)
 *
 * At forty candidates and nine holes that is about fourteen thousand
 * additions — nothing — and unlike every heuristic here it is **exact**. There
 * is no better forward route; this is it. The sideways wandering goes away
 * because the program pays for lateral distance across the whole walk instead
 * of one step at a time.
 *
 * `drift` still tunes it, now as a discount on progress inside the step cost:
 * at 0 this is the shortest forward walk, and turning it up buys ground.
 */
function bestForwardWalk(
  table: Map<string, Map<string, number>>,
  nodes: RouteNode[],
  byId: Map<string, RouteNode>,
  holes: number,
  startId: string | null,
  finishId: string | null,
  drift: number,
  teeOff: TeeOff | null = null,
  alongFn: ((node: RouteNode) => number) | null = null,
): string[] | null {
  const origin = (startId ? byId.get(startId) : null) ?? nodes[0];
  if (!origin) return null;
  const axis = principalAxis(
    nodes,
    origin,
    finishId ? byId.get(finishId) : null,
  );
  const position = alongFn ?? ((node: RouteNode) => along(node, axis, origin));

  const order = nodes
    .map((node) => ({ node, t: position(node) }))
    .sort((a, b) => a.t - b.t);
  const n = order.length;
  if (n < holes) return null;

  const startAt = startId ? order.findIndex((e) => e.node.id === startId) : -1;
  const finishAt = finishId
    ? order.findIndex((e) => e.node.id === finishId)
    : -1;
  // A pinned tee that is not at the end of the line it was asked to travel
  // cannot be honoured by a forward-only walk. Rather than quietly bending the
  // rule, this hands back nothing and another seed answers.
  if (startId && startAt === -1) return null;
  if (finishId && (finishAt === -1 || finishAt <= startAt)) return null;

  const step = (i: number, j: number) =>
    gap(table, order[i].node.id, order[j].node.id) -
    drift * (order[j].t - order[i].t);

  // best[k][j] — the cheapest k-stop walk ending at j. `from` remembers the
  // step that got there so the route can be read back out. `mins` rides
  // alongside: the walking minutes of the best-cost path into each state,
  // which is what makes closing time a *pruning* rule rather than a filter —
  // a state the group would reach after the towels go up is never built.
  // (The cheapest path is treated as the earliest; with drift in the cost
  // that is an approximation, and `walkFeasible` still checks the whole.)
  const INF = Number.POSITIVE_INFINITY;
  const best: number[][] = Array.from({ length: holes + 1 }, () =>
    new Array(n).fill(INF),
  );
  const from: number[][] = Array.from({ length: holes + 1 }, () =>
    new Array(n).fill(-1),
  );
  const mins: number[][] = Array.from({ length: holes + 1 }, () =>
    new Array(n).fill(0),
  );

  const shutAt = (j: number, k: number, walked: number) =>
    teeOff
      ? !openAt(
          order[j].node.hours,
          teeOff.day,
          teeOff.minutes + Math.round(walked) + (k - 1) * DWELL_MINUTES,
        )
      : false;

  for (let j = 0; j < n; j += 1) {
    // Where a walk may begin: the pinned tee, or anywhere if none was named
    // — and never somewhere that is shut at tee-off.
    if ((startAt === -1 || j === startAt) && !shutAt(j, 1, 0)) best[1][j] = 0;
  }
  for (let k = 2; k <= holes; k += 1) {
    for (let j = 0; j < n; j += 1) {
      if (finishAt !== -1 && j > finishAt) continue;
      for (let i = 0; i < j; i += 1) {
        if (best[k - 1][i] === INF) continue;
        const cost = best[k - 1][i] + step(i, j);
        if (cost < best[k][j]) {
          const walked =
            mins[k - 1][i] +
            gap(table, order[i].node.id, order[j].node.id) *
              WALK_MINUTES_PER_KM;
          if (shutAt(j, k, walked)) continue;
          best[k][j] = cost;
          from[k][j] = i;
          mins[k][j] = walked;
        }
      }
    }
  }

  let end = finishAt;
  if (end === -1) {
    end = 0;
    for (let j = 1; j < n; j += 1)
      if (best[holes][j] < best[holes][end]) end = j;
  }
  if (best[holes][end] === INF) return null;

  const stops: string[] = [];
  for (let k = holes, j = end; k >= 1 && j >= 0; k -= 1) {
    stops.unshift(order[j].node.id);
    j = from[k][j];
  }
  return stops.length === holes ? stops : null;
}

/**
 * A walk that cannot double back.
 *
 * The scoring terms could reject a back-and-forth route but never build a
 * better one, so the pool they chose from was full of routes that wandered —
 * greedy takes the nearest pub, paints itself into a corner, and crosses its
 * own path getting out. Filtering that pool gives the least-bad backtrack.
 *
 * This constructs the property instead of hoping for it. Every pub is
 * projected onto the direction of travel, and a step may only ever go
 * *forward* along it. Doubling back is not penalised; it is unrepresentable.
 *
 * `drift` is the tuning dial, in kilometres of detour the walk will accept per
 * kilometre of progress. At 0 this is ordinary nearest-neighbour and will
 * cluster tightly. Turn it up and the night insists on getting somewhere,
 * stringing out along the high street rather than circling one corner.
 */
function snakeWalk(
  table: Map<string, Map<string, number>>,
  nodes: RouteNode[],
  byId: Map<string, RouteNode>,
  holes: number,
  startId: string,
  finishId: string | null,
  drift: number,
  alongFn: ((node: RouteNode) => number) | null = null,
): string[] | null {
  const origin = byId.get(startId);
  if (!origin) return null;
  const axis = principalAxis(
    nodes,
    origin,
    finishId ? byId.get(finishId) : null,
  );
  const position = alongFn ?? ((node: RouteNode) => along(node, axis, origin));
  const at = new Map(nodes.map((node) => [node.id, position(node)]));

  const used = new Set<string>([startId]);
  if (finishId) used.add(finishId);
  const stops = [startId];
  const wanted = finishId ? holes - 1 : holes;
  // A pinned finish caps how far forward the walk may reach, so the last leg
  // does not have to come all the way back.
  const ceiling = finishId ? (at.get(finishId) ?? Infinity) : Infinity;

  while (stops.length < wanted) {
    const here = stops[stops.length - 1];
    const hereAt = at.get(here) ?? 0;
    let best: string | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      if (used.has(node.id)) continue;
      const there = at.get(node.id) ?? 0;
      // Forward only. This is the whole mechanism: a pub behind the walk is
      // not expensive, it is not a candidate.
      if (there <= hereAt) continue;
      if (there > ceiling) continue;
      const cost = gap(table, here, node.id) - drift * (there - hereAt);
      if (cost < bestCost) {
        bestCost = cost;
        best = node.id;
      }
    }
    // Nothing ahead. Rather than turning round, the walk stops short and the
    // caller drops this seed — a shorter honest jaunt is another seed's job.
    if (!best) break;
    used.add(best);
    stops.push(best);
  }

  if (finishId) stops.push(finishId);
  return stops.length === holes ? stops : null;
}

/**
 * How much of a drawn line a walk has to span before it counts as following
 * it, and how much doubling back it may do while it does.
 *
 * Read as shares of the stroke's own arc length, so they mean the same thing
 * on a two-kilometre line and a ten-kilometre one. Seven tenths is deliberately
 * short of the whole: the ends of a stroke are where a finger starts and stops
 * rather than where the pubs are, and demanding the last two hundred metres
 * would refuse good walks over the host's own overshoot.
 */
export const STROKE_COVERAGE_FLOOR = 0.7;
export const STROKE_BACKTRACK_SHARE = 0.35;

/** Whether a walk answers the line it was drawn on. */
export function followsStroke(
  points: StrokePoint[],
  stroke: StrokePoint[],
): boolean {
  const length = strokeLengthKm(stroke);
  if (length <= 0) return true;
  const fit = strokeFit(points, stroke);
  return (
    fit.coverage >= STROKE_COVERAGE_FLOOR &&
    fit.backtrackKm <= length * STROKE_BACKTRACK_SHARE
  );
}

/**
 * Walking a drawn line, stated as the optimisation it actually is.
 *
 * The first attempt built coverage by hand: cut the line into bands, take the
 * best pub in each. That works and it is a heuristic — it is greedy inside a
 * band and blind across bands, so a pub two metres outside band three's edge
 * loses to a worse one just inside it. The real question has a clean form:
 *
 *   **choose `holes` candidates, ordered by arc position along the stroke,
 *   minimising the total cost of the stops, subject to consecutive stops
 *   being at least `minGapKm` further down the line.**
 *
 * That is a shortest path in a DAG. The arc position gives a topological order
 * for free — every edge runs strictly forwards down the line — so the states
 * are (candidate, stops used) and each is settled exactly once. This *is* A\*
 * on that graph with a perfect ordering and no re-expansions; adding a
 * priority queue and an admissible heuristic to it would visit the same states
 * and pay for the heap. At `MAX_CANDIDATES` of 40 and at most 18 holes the
 * whole table is about 29,000 relaxations, which is microseconds. A\* earns
 * its keep when the state space is too big to settle — if the candidate cap
 * ever grows by an order of magnitude, or if a non-separable cost (arrival
 * time, variety across the whole set) has to ride in the state, this is the
 * function to reach for it in.
 *
 * The spacing constraint is what makes coverage fall out rather than be
 * imposed: `holes` stops each at least `minGapKm` apart span at least
 * `(holes − 1) × minGapKm` of the line, so asking for `length / holes` asks
 * for a walk that covers all but a hole's worth of what was drawn.
 *
 * Exact, pure and deterministic — ties break on id, because the router sits
 * behind a cache key and an optimum that wobbles between runs is a card that
 * wobbles between runs.
 */
export function bestStrokeWalk(
  nodes: RouteNode[],
  holes: number,
  stroke: StrokePoint[],
  options: {
    /** The least distance along the line between consecutive stops. */
    minGapKm: number;
    /** What one stop costs. Distance from the drawn line, by default. */
    cost?: (node: RouteNode, offLineKm: number) => number;
    /** What the gap between two consecutive stops costs, on top of the stops
     * themselves — how "evenly spaced down the line" is asked for. */
    gapCost?: (gapKm: number) => number;
    startId?: string | null;
    finishId?: string | null;
  },
): string[] | null {
  if (holes < 2 || nodes.length < holes || stroke.length < 2) return null;
  const cost = options.cost ?? ((_node, offLineKm) => offLineKm);
  const gapCost = options.gapCost;

  const placed = nodes
    .map((node) => {
      const point = { lat: node.lat, lng: node.lng };
      return {
        node,
        along: alongStrokeKm(point, stroke),
        off: distanceToStrokeKm(point, stroke),
      };
    })
    .sort(
      (a, b) =>
        a.along - b.along ||
        (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0),
    );

  const count = placed.length;
  const startAt = options.startId
    ? placed.findIndex((entry) => entry.node.id === options.startId)
    : -1;
  const finishAt = options.finishId
    ? placed.findIndex((entry) => entry.node.id === options.finishId)
    : -1;
  // A pin nobody gathered is not a pin. Refused rather than ignored: the other
  // constructions answer this patch, and quietly dropping a host's own choice
  // is the failure that would never be noticed.
  if (options.startId && startAt < 0) return null;
  if (options.finishId && finishAt < 0) return null;

  const INF = Number.POSITIVE_INFINITY;
  /** `best[j][i]` — the cheapest j-stop walk whose last stop is candidate i. */
  const best: number[][] = Array.from({ length: holes + 1 }, () =>
    new Array<number>(count).fill(INF),
  );
  const cameFrom: number[][] = Array.from({ length: holes + 1 }, () =>
    new Array<number>(count).fill(-1),
  );

  for (let i = 0; i < count; i += 1) {
    // With a pinned tee there is one legal opening; without one, any candidate
    // may open the walk and the DP decides which.
    if (startAt >= 0 && i !== startAt) continue;
    best[1][i] = cost(placed[i].node, placed[i].off);
  }

  for (let stops = 2; stops <= holes; stops += 1) {
    for (let i = 0; i < count; i += 1) {
      const here = cost(placed[i].node, placed[i].off);
      for (let previous = 0; previous < i; previous += 1) {
        if (best[stops - 1][previous] === INF) continue;
        const gap = placed[i].along - placed[previous].along;
        if (gap < options.minGapKm - 1e-9) continue;
        const total =
          best[stops - 1][previous] + here + (gapCost ? gapCost(gap) : 0);
        if (total < best[stops][i] - 1e-12) {
          best[stops][i] = total;
          cameFrom[stops][i] = previous;
        }
      }
    }
  }

  let end = -1;
  let cheapest = INF;
  for (let i = 0; i < count; i += 1) {
    if (finishAt >= 0 && i !== finishAt) continue;
    if (best[holes][i] < cheapest) {
      cheapest = best[holes][i];
      end = i;
    }
  }
  if (end < 0) return null;

  const stops: string[] = [];
  let at = end;
  for (let taken = holes; taken >= 1; taken -= 1) {
    stops.push(placed[at].node.id);
    at = cameFrom[taken][at];
    if (at < 0 && taken > 1) return null;
  }
  return stops.reverse();
}

/**
 * The spacings tried, most insistent first.
 *
 * `length / holes` asks for a walk that spans all but a hole's worth of the
 * drawn line. Where the pubs cannot answer that — a genuine dead stretch, a
 * park, a river — the ask relaxes rather than the router refusing, which is
 * the same honest fallback the hours and barrier filters keep.
 */
function strokeGaps(lengthKm: number, holes: number): number[] {
  const even = lengthKm / Math.max(holes, 1);
  return [even, even * 0.6, even * 0.3, 0];
}

/**
 * The readings of "walk me down this line" worth offering, each an exact
 * optimum of its own objective rather than a perturbation of one answer.
 *
 * Trace it (nothing but distance from the line), pace it (that plus a penalty
 * on uneven gaps), or take the best of what stands beside it (that plus a
 * quarter-kilometre's detour bought per star).
 */
const STROKE_OBJECTIVES: {
  key: string;
  cost?: (node: RouteNode, offLineKm: number) => number;
  gapCost?: (idealKm: number) => (gapKm: number) => number;
}[] = [
  { key: "hug" },
  {
    key: "even",
    gapCost: (idealKm) => (gapKm) =>
      (gapKm - idealKm) ** 2 / Math.max(idealKm, 0.05),
  },
  {
    key: "rated",
    cost: (node, offLineKm) => offLineKm + (5 - (node.rating ?? 3.5)) * 0.25,
  },
];

/**
 * A greedy tour: from the start, always step to the nearest unused stop, and
 * finish on the pinned one if there is one.
 *
 * `skip` lets the caller force a different second stop, which is how the seed
 * set gets its variety — greedy from one origin always gives the same answer,
 * and a set of identical seeds improves into a set of identical routes.
 */
function greedy(
  table: Map<string, Map<string, number>>,
  pool: string[],
  holes: number,
  startId: string,
  finishId: string | null,
  skip: string | null,
): string[] | null {
  const used = new Set<string>([startId]);
  if (finishId) used.add(finishId);
  const stops = [startId];
  const wanted = finishId ? holes - 1 : holes;

  while (stops.length < wanted) {
    const from = stops[stops.length - 1];
    let best: string | null = null;
    let bestKm = Number.POSITIVE_INFINITY;
    for (const id of pool) {
      if (used.has(id)) continue;
      // Only the first choice is forced away; after that `skip` has done its
      // job and holding it out would just shrink the pool.
      if (id === skip && stops.length === 1) continue;
      const km = gap(table, from, id);
      if (km < bestKm) {
        bestKm = km;
        best = id;
      }
    }
    if (!best) break;
    used.add(best);
    stops.push(best);
  }

  if (finishId) stops.push(finishId);
  return stops.length === holes ? stops : null;
}

/**
 * 2-opt, endpoints pinned: reverse an interior run wherever that shortens the
 * walk. Fixes the crossings greedy always leaves behind.
 */
function twoOpt(
  table: Map<string, Map<string, number>>,
  stops: string[],
  pinStart: boolean,
  pinFinish: boolean,
): string[] {
  const route = [...stops];
  const first = pinStart ? 1 : 0;
  const last = pinFinish ? route.length - 2 : route.length - 1;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = first; i < last; i += 1) {
      for (let j = i + 1; j <= last; j += 1) {
        const before =
          gap(table, route[i - 1] ?? route[i], route[i]) +
          gap(table, route[j], route[j + 1] ?? route[j]);
        const after =
          gap(table, route[i - 1] ?? route[j], route[j]) +
          gap(table, route[i], route[j + 1] ?? route[i]);
        if (after < before - 1e-9) {
          const slice = route.slice(i, j + 1).reverse();
          route.splice(i, slice.length, ...slice);
          improved = true;
        }
      }
    }
  }
  return route;
}

/**
 * Swap a chosen stop for one nobody chose, where that shortens the walk.
 *
 * This is the half of the problem 2-opt cannot touch. 2-opt reorders what is
 * already in the route; this decides *which* pubs are in it, which is the
 * "choose n of N" the ordering heuristics take as given.
 */
function swapIn(
  table: Map<string, Map<string, number>>,
  stops: string[],
  pool: string[],
  pinStart: boolean,
  pinFinish: boolean,
): string[] {
  const route = [...stops];
  const first = pinStart ? 1 : 0;
  const last = pinFinish ? route.length - 2 : route.length - 1;
  let improved = true;
  while (improved) {
    improved = false;
    const inRoute = new Set(route);
    for (let i = first; i <= last; i += 1) {
      const before =
        gap(table, route[i - 1] ?? route[i], route[i]) +
        gap(table, route[i], route[i + 1] ?? route[i]);
      for (const id of pool) {
        if (inRoute.has(id)) continue;
        const after =
          gap(table, route[i - 1] ?? id, id) +
          gap(table, id, route[i + 1] ?? id);
        if (after < before - 1e-9) {
          inRoute.delete(route[i]);
          inRoute.add(id);
          route[i] = id;
          improved = true;
          break;
        }
      }
    }
  }
  return route;
}

/** A leg midpoint further than this from every candidate is crossing dead
 * ground. Half a kilometre: the glow of one pub, roughly. */
export const DEAD_GROUND_KM = 0.5;

/**
 * The worst dead ground on a walk: the largest distance from any leg's
 * midpoint to its nearest candidate. The candidate cloud is the density
 * field — where there are doors there is light, and a walk should keep to
 * it where it can.
 */
export function worstDeadGroundKm(
  stops: string[],
  nodes: RouteNode[],
  byId: Map<string, RouteNode>,
): number {
  let worst = 0;
  for (let i = 1; i < stops.length; i += 1) {
    const a = byId.get(stops[i - 1]);
    const b = byId.get(stops[i]);
    if (!a || !b) continue;
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    let nearest = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      nearest = Math.min(
        nearest,
        haversineKm(mid.lat, mid.lng, node.lat, node.lng),
      );
    }
    if (nearest !== Number.POSITIVE_INFINITY) worst = Math.max(worst, nearest);
  }
  return worst;
}

/**
 * The non-dominated set: every route no other route beats on *all* the
 * arguments at once. Sequential objective-winners had accidental coverage —
 * an objective whose best was taken contributed nothing — where a Pareto
 * front makes "these walks are genuinely different arguments" a theorem
 * about the output rather than a hope about the process. The named
 * objectives still pick and label the menu; they just pick from here.
 */
export function paretoFront(
  routes: PlannedRoute[],
  nodes: Map<string, RouteNode>,
  targetKm: number | null,
): PlannedRoute[] {
  // Every objective is an axis, and it has to be: an objective missing from
  // the axes can have its own best route dominated away before it ever gets
  // to pick, which quietly deletes a character from the menu. With the full
  // set, each objective's winner is on the front or tied with something that
  // beats it elsewhere — either way the menu keeps the argument.
  const axes = ROUTE_OBJECTIVES;
  const scored = routes.map((route) =>
    axes.map((axis) => axis.score(route, nodes, targetKm)),
  );
  return routes.filter((_, i) => {
    for (let j = 0; j < routes.length; j += 1) {
      if (i === j) continue;
      let allLeq = true;
      let oneLess = false;
      for (let k = 0; k < scored[i].length; k += 1) {
        if (scored[j][k] > scored[i][k] + 1e-9) allLeq = false;
        if (scored[j][k] < scored[i][k] - 1e-9) oneLess = true;
      }
      if (allLeq && oneLess) return false;
    }
    return true;
  });
}

/** How much two routes overlap, 0 (nothing shared) to 1 (identical set). */
export function overlap(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const id of left) if (right.has(id)) shared += 1;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : shared / union;
}

function describe(
  table: Map<string, Map<string, number>>,
  nodes: Map<string, RouteNode>,
  stops: string[],
  character: string,
): PlannedRoute {
  const legs: RouteLeg[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    legs.push({
      from: stops[i - 1],
      to: stops[i],
      km: gap(table, stops[i - 1], stops[i]),
    });
  }
  const kinds = new Set(stops.map((id) => nodes.get(id)?.kind ?? id));
  const totalKm = walk(table, stops);
  const progressKm = gap(table, stops[0], stops[stops.length - 1]);
  return {
    stops,
    legs,
    progressKm,
    // Guarded, because a route that finishes where it began has no progress to
    // divide by — and that is the most doubled-back route there is, so it
    // scores as the worst rather than as infinity.
    detour: progressKm > 0.05 ? totalKm / progressKm : 99,
    totalKm,
    worstLegKm: legs.reduce((worst, leg) => Math.max(worst, leg.km), 0),
    variety: kinds.size,
    character,
  };
}

/**
 * What makes a route good, which is where this stops being a textbook TSP.
 *
 * Lower is better. Three terms, and the first is the one a distance-minimising
 * solver gets wrong: a crawl is not better for being shorter. A host who asked
 * for four kilometres wants four, so the penalty is on the *distance from* the
 * target rather than on the distance itself — otherwise every answer is nine
 * pubs on one street.
 */
export function scoreRoute(
  route: PlannedRoute,
  targetKm: number | null,
): number {
  const spread = targetKm
    ? Math.abs(route.totalKm - targetKm) / Math.max(targetKm, 0.1)
    : route.totalKm / 10;
  // A single brutal leg ruins a night the average never shows. Only the excess
  // over a comfortable ten minutes' walk counts.
  const trek = Math.max(0, route.worstLegKm - 0.8);
  // Variety pulls the other way, so it subtracts. Capped: past a handful of
  // distinct kinds nobody notices another.
  const sameness =
    (route.stops.length - Math.min(route.variety, 6)) / route.stops.length;
  // A night should go somewhere. Two pubs on one street and back again can hit
  // the target distance exactly and still be the same corner all evening —
  // this is what separates a jaunt from a lap of the block, and nothing in the
  // distance terms above can see the difference.
  //
  // Free up to a modest amount of wandering, because a crawl is not a commute
  // and the odd step back for a good pub is fine. Past that it bites.
  const backAndForth = Math.max(0, route.detour - 1.6) * 0.6;
  return spread + trek + sameness * 0.5 + backAndForth;
}

/**
 * How many of a fact a route carries. `null` is not `false` — Google simply
 * did not say — so an unknown counts as neither, which keeps a patch with thin
 * data from scoring as a patch with bad pubs.
 */
function carrying(
  stops: string[],
  nodes: Map<string, RouteNode>,
  fact: keyof PubFacts,
): number {
  return stops.filter((id) => nodes.get(id)?.facts[fact] === true).length;
}

/**
 * The menu, and the reason there is one.
 *
 * The first cut produced its alternatives by perturbing a single objective, so
 * every route was a slightly different attempt at being short. That is
 * variation, not choice: a host cycling through them is reading four answers to
 * one question. Each entry here **wins a different argument** — the ones a
 * host actually has when planning a night by hand — and all of them are scored
 * off data the dossier already carries.
 *
 * Lower is better throughout, so every scorer is written as a penalty.
 */
export interface RouteObjective {
  key: string;
  /** What the model reads, so it can choose between them. */
  character: string;
  score: (
    route: PlannedRoute,
    nodes: Map<string, RouteNode>,
    targetKm: number | null,
  ) => number;
}

export const ROUTE_OBJECTIVES: RouteObjective[] = [
  {
    key: "balanced",
    character: "best fit for the brief",
    score: (route, _nodes, target) => scoreRoute(route, target),
  },
  {
    key: "onward",
    character: "keeps moving — least doubling back",
    score: (route) => route.detour,
  },
  {
    key: "rated",
    character: "the best-reviewed pubs in the patch",
    score: (route, nodes) => {
      // Weighted by review count, so one glowing five-star with three reviews
      // does not beat a well-loved local with four hundred.
      let weighted = 0;
      let weight = 0;
      for (const id of route.stops) {
        const node = nodes.get(id);
        if (!node?.rating) continue;
        const w = Math.log10((node.reviewCount ?? 0) + 10);
        weighted += node.rating * w;
        weight += w;
      }
      return weight === 0 ? 5 : 5 - weighted / weight;
    },
  },
  {
    key: "drinks",
    character: "widest range of drinks",
    score: (route, nodes) => {
      // The house rule enforced by geometry rather than by dressing: a card
      // cannot pour what its pubs do not stock, so a route that cannot carry a
      // short or a glass of wine is a route that can only be nine pints.
      const beer = carrying(route.stops, nodes, "servesBeer");
      const wine = carrying(route.stops, nodes, "servesWine");
      const shorts = carrying(route.stops, nodes, "servesCocktails");
      const covered = [beer, wine, shorts].filter((n) => n > 0).length;
      return 3 - covered;
    },
  },
  {
    key: "kind",
    character: "kindest legs — nothing far between stops",
    score: (route) => route.worstLegKm,
  },
  {
    key: "mixed",
    character: "most variety — fewest repeats of the same place",
    score: (route) => -route.variety,
  },
  {
    key: "cheap",
    character: "easiest on a round of drinks",
    score: (route, nodes) => {
      const priced = route.stops
        .map((id) => nodes.get(id)?.priceLevel)
        .filter((level): level is number => typeof level === "number");
      return priced.length === 0
        ? 4
        : priced.reduce((a, b) => a + b, 0) / priced.length;
    },
  },
  {
    key: "outdoor",
    character: "beer gardens where there are any",
    score: (route, nodes) => -carrying(route.stops, nodes, "outdoorSeating"),
  },
  {
    key: "groups",
    character: "room for a big table",
    score: (route, nodes) => -carrying(route.stops, nodes, "goodForGroups"),
  },
  {
    key: "sport",
    character: "somewhere with the match on",
    score: (route, nodes) =>
      -carrying(route.stops, nodes, "goodForWatchingSports"),
  },
];

/**
 * The map, ready to hand over.
 *
 * Seed several greedy tours from different second stops, improve each by
 * reordering and by swapping pubs in and out, then keep only those that differ
 * enough from the ones already kept to be a real alternative.
 */
export function buildRouteGraph(
  candidates: CandidateDossier[],
  request: RouteRequest,
): RouteGraph {
  const nodes = routableNodes(candidates);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const table = distances(nodes);
  const neighbours = nearestNeighbours(
    nodes,
    request.neighbours ?? DEFAULT_NEIGHBOURS,
    table,
  );

  const target = request.targetKm ?? null;
  const pool = nodes.map((node) => node.id);
  const holes = Math.min(request.holes, pool.length);
  // Nothing to route: one stop is not a crawl, and the caller gets the
  // neighbour map alone rather than a fabricated route.
  if (holes < 2) return { nodes, neighbours, routes: [] };

  /** The candidate nearest a point — how an *area* becomes a stop. */
  const nearestTo = (aim: { lat: number; lng: number } | null | undefined) => {
    if (!aim) return null;
    let best: string | null = null;
    let bestKm = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const km = haversineKm(aim.lat, aim.lng, node.lat, node.lng);
      if (km < bestKm) {
        bestKm = km;
        best = node.id;
      }
    }
    return best;
  };

  // A pinned venue is the host's own choice and beats an area every time. An
  // area only decides an end when nothing was pinned there.
  const startId =
    (request.startId && byId.has(request.startId) ? request.startId : null) ??
    nearestTo(request.aimFrom);
  const aimedFinish = nearestTo(request.aimTo);
  const finishId =
    (request.finishId &&
    byId.has(request.finishId) &&
    request.finishId !== startId
      ? request.finishId
      : null) ?? (aimedFinish && aimedFinish !== startId ? aimedFinish : null);

  // The drawn stroke, where there is one, is the axis every forward walk
  // projects onto — stated by the host, not guessed from the cloud.
  const strokeAxis =
    request.stroke && request.stroke.length >= 2 ? request.stroke : null;
  const alongFn = strokeAxis
    ? (node: RouteNode) =>
        alongStrokeKm({ lat: node.lat, lng: node.lng }, strokeAxis)
    : null;

  // With no pinned tee, try several origins so the seeds genuinely differ.
  const origins = startId ? [startId] : pool.slice(0, 6);
  const seeds: string[][] = [];
  // Kept apart from the greedy seeds, and not improved. `swapIn` and 2-opt
  // optimise for distance alone, so run over a snake they pull it straight
  // back into the cluster it was built to escape — the improvement undoes the
  // construction. A snake is already the route it means to be.
  const snakes: string[][] = [];
  for (const origin of origins) {
    // Greedy: the short, clustered answer. Kept because for a genuinely dense
    // patch it is the right one, and because 2-opt over it is a good baseline.
    for (const skip of [
      null,
      ...neighbours[origin].slice(0, 3).map((n) => n.id),
    ]) {
      const seed = greedy(table, pool, holes, origin, finishId, skip);
      if (seed) seeds.push(seed);
    }
    // Snaking: routes that cannot double back, at three tightnesses. This is
    // what the scoring terms could only ever ask for — a route that gets
    // somewhere has to be *built*, and no amount of penalising a wandering one
    // puts a jaunt in the pool that was never constructed.
    for (const drift of driftsFor(target, holes)) {
      // Exact, so it supersedes the greedy snake wherever it can answer at
      // all. The greedy one is kept behind it: the exact walk needs a pinned
      // tee to sit at the end of the line it travels, and refuses rather than
      // bending that, so a patch with awkward pins still gets a route.
      const exact = bestForwardWalk(
        table,
        nodes,
        byId,
        holes,
        origin,
        finishId,
        drift,
        request.teeOff ?? null,
        alongFn,
      );
      if (exact) snakes.push(exact);
      const seed = snakeWalk(
        table,
        nodes,
        byId,
        holes,
        origin,
        finishId,
        drift,
        alongFn,
      );
      if (seed) snakes.push(seed);
    }
  }

  // And the exact optima for the drawn line: the walk that minimises total
  // distance from the stroke, subject to spanning it. Origin-free — the line
  // decides where these begin — so they stand outside the loop above, and each
  // relaxes its spacing only as far as it has to before it can answer at all.
  if (strokeAxis) {
    const lineKm = strokeLengthKm(strokeAxis);
    for (const objective of STROKE_OBJECTIVES) {
      for (const minGapKm of strokeGaps(lineKm, holes)) {
        const walk = bestStrokeWalk(nodes, holes, strokeAxis, {
          minGapKm,
          cost: objective.cost,
          gapCost: objective.gapCost?.(lineKm / Math.max(holes, 1)),
          startId,
          finishId,
        });
        if (walk) {
          snakes.push(walk);
          break;
        }
      }
    }
  }

  const improved = seeds.map((seed) => {
    let route = twoOpt(table, seed, startId !== null, finishId !== null);
    route = swapIn(table, route, pool, startId !== null, finishId !== null);
    // Reordering can pay off again once the membership has changed.
    return twoOpt(table, route, startId !== null, finishId !== null);
  });

  const described = [...improved, ...snakes].map((stops) =>
    describe(table, byId, stops, ""),
  );

  // Closing time, applied to the whole pool. Walks that stay open outrank
  // walks that do not; only when *nothing* passes does the unchecked pool
  // stand, because a patch with thin hours data must still get a card — the
  // contract will say what could not be proved.
  const teeOff = request.teeOff ?? null;
  const feasible = teeOff
    ? described.filter((route) =>
        walkFeasible(table, byId, route.stops, teeOff),
      )
    : described;
  const timed = feasible.length > 0 ? feasible : described;

  // Geography next: walks that swim stand only when every walk swims.
  const barriers = request.barriers ?? null;
  const dry = barriers?.length
    ? timed.filter(
        (route) =>
          walkCrossings(
            route.stops.flatMap((id) => {
              const node = byId.get(id);
              return node ? [{ lat: node.lat, lng: node.lng }] : [];
            }),
            barriers,
          ) === 0,
      )
    : timed;
  const grounded = dry.length > 0 ? dry : timed;

  // Density is a field the candidates themselves draw: a leg whose midpoint
  // sits far from every pub crosses dead ground — a park, a river, an
  // industrial estate the map cannot otherwise see. Walks that stay in the
  // glow outrank walks that cross the dark, with the usual honest fallback
  // when every walk must cross it.
  const populated = grounded.filter(
    (route) => worstDeadGroundKm(route.stops, nodes, byId) <= DEAD_GROUND_KM,
  );
  const lit = populated.length > 0 ? populated : grounded;

  // **A stroke is a route, not a region**, and this is the filter that says
  // so. The drawn line reached construction (the forward walks are monotone
  // along it) and reached the gather (the circles are sampled down it) but
  // never reached selection — so a tight cluster sitting inside the swath was
  // eligible for the menu and, being short and well-connected, usually won it.
  // The host drew a walk across town and was offered one street of it.
  //
  // Same shape as the hours and barrier filters above, for the same reason:
  // an honest fallback rather than an empty menu. Where no walk can follow the
  // line — the pubs genuinely are all at one end — the unfiltered pool stands
  // and the card says what it is.
  const tracking = strokeAxis
    ? lit.filter((route) =>
        followsStroke(
          route.stops.flatMap((id) => {
            const node = byId.get(id);
            return node ? [{ lat: node.lat, lng: node.lng }] : [];
          }),
          strokeAxis,
        ),
      )
    : lit;
  const onLine = tracking.length > 0 ? tracking : lit;

  // And the menu chooses from the non-dominated set: nothing on it is beaten
  // on every argument at once by something off it.
  const front = paretoFront(onLine, byId, target);
  const pool2 = front.length > 0 ? front : onLine;

  // Each objective picks its own winner from the same pool, which is what
  // makes this a menu rather than a shortlist: the routes differ because they
  // are answers to different questions, not because they were perturbed.
  //
  // A route already taken cannot win twice, and a near-duplicate of one
  // already kept is skipped — two routes sharing all but one stop are one
  // route wearing two hats, and offering both spends context to give no
  // choice. So an objective whose best is already on the menu simply does not
  // contribute, and the menu is shorter than the objective list.
  const kept: PlannedRoute[] = [];
  const wanted = request.routes ?? DEFAULT_ROUTES;
  for (const objective of ROUTE_OBJECTIVES) {
    if (kept.length >= wanted) break;
    const ranked = [...pool2].sort(
      (a, b) =>
        objective.score(a, byId, target) - objective.score(b, byId, target),
    );
    const winner = ranked.find(
      (route) =>
        !kept.includes(route) &&
        !kept.some(
          (other) => overlap(other.stops, route.stops) > 1 - DIVERSITY_FLOOR,
        ),
    );
    if (!winner) continue;
    winner.character = objective.character;
    kept.push(winner);
  }

  return { nodes, neighbours, routes: kept };
}

/** Walking pace, km/h. The house already assumes a stroll rather than a march
 * everywhere else it estimates a walk. */
const STROLL_KMH = 4.5;

/**
 * The walk the brief is asking for, in kilometres.
 *
 * `stretch` is the shortest walk the host wants *between* two pubs, so the
 * round they have in mind is roughly that leg repeated. Treating a stated
 * minimum as the target is the honest reading of it: somebody who asks for ten
 * minutes between pubs wants a walk, and handing them nine doors on one street
 * is answering a different question.
 */
export function targetKmFor(
  stretchMinutes: number,
  holes: number,
  reachKm = 0,
): number {
  // A named destination outranks a chosen pace, and it has to: pace times legs
  // *is* distance, so a host asking for a steady five minutes and for a finish
  // four kilometres away has described two different rounds. The place they
  // named is the concrete one.
  //
  // A little slack over the straight line, because pubs are not on it — a walk
  // that had to be exactly as the crow flies could not visit anything.
  if (reachKm > 0) return reachKm * 1.15;
  return (stretchMinutes / 60) * STROLL_KMH * Math.max(holes - 1, 1);
}

/**
 * The graph, as the caddy reads it.
 *
 * Terse on purpose: this sits inside the cached prefix, so it is written once
 * per session and read on every turn, but it is still context that the dossier
 * has to share. Ids and numbers, no prose — the model has the dossier for what
 * a pub is *like*, and needs this only for where things are.
 */
export function routesBlock(graph: RouteGraph): string {
  if (!graph.routes.length) return "";
  const lines: string[] = [
    "<routes>",
    "Worked out for you: complete walks over the candidates above, best first.",
    "Take one and adjust it. You are not required to — but you should not need",
    "to search, and every stop below is a real candidate id.",
    "",
  ];
  graph.routes.forEach((route, index) => {
    const legs = route.legs.map((leg) => leg.km.toFixed(2)).join("/");
    lines.push(
      `R${index + 1} [${route.character}] ${route.stops.join(" > ")}` +
        ` | total ${route.totalKm.toFixed(2)}km | legs ${legs}` +
        ` | longest ${route.worstLegKm.toFixed(2)}km | ${route.variety} kinds`,
    );
  });
  lines.push(
    "",
    "<swaps>",
    "Nearest alternatives to each stop, with the walk to it.",
  );
  for (const node of graph.nodes) {
    const near = graph.neighbours[node.id];
    if (!near?.length) continue;
    lines.push(
      `${node.id}: ${near.map((n) => `${n.id} ${n.km.toFixed(2)}km`).join(", ")}`,
    );
  }
  lines.push("</swaps>", "</routes>");
  return lines.join("\n");
}
