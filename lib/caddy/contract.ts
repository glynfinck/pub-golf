import type { CandidateDossier } from "@/lib/caddy/dossier";
import type { PlannedHole } from "@/lib/caddy/plan";
import { HAZARDS } from "@/lib/hazards";
import { haversineKm } from "@/lib/geo";

/**
 * The Card Contract: what a card that was worth paying for looks like, as a
 * predicate rather than a hope.
 *
 * "Perfect 99% of the time" is unfalsifiable until *perfect* is something a
 * function can check, so this module is that function. It runs after every
 * plan and every tweak, its findings are logged on the turn, and the clean
 * rate — cards with nothing to report — is the number the whole route-planning
 * effort is steered by.
 *
 * **Pure, and deliberately so.** Card in, findings out. No clock, no network,
 * no database — the same rule the router keeps, for the same reason: the unit
 * tier is where rules live.
 *
 * **A finding is not a refusal.** Most clauses describe repairs the pipeline
 * upstream already makes (`parsePlan` strips an illegal hazard rather than
 * failing the card), so by the time a card reaches the host this list should
 * be empty. When it is not, the card still lands — a hole with a note is
 * better than no card — and the finding is the telemetry that prices the fix.
 *
 * **Unknowns never punish.** Google saying nothing about a pub's cocktails is
 * not the pub having none, so every fact-driven clause checks `=== false`,
 * never falsiness — a thin-data patch must not score as a bad-pub patch.
 */

export type ContractClause =
  | "real-venues"
  | "pins-hold"
  | "goes-somewhere"
  | "full-count"
  | "hazards-legal"
  | "legs-in-bounds"
  | "drinks-pourable"
  | "named";

export interface ContractFinding {
  clause: ContractClause;
  /** 1-based hole the finding sits on, where one hole owns it. */
  hole?: number;
  note: string;
}

export interface ContractReport {
  findings: ContractFinding[];
  clean: boolean;
}

/**
 * A leg longer than this is a trek, not a walk between rounds. Twice the
 * router's own comfort line (`scoreRoute` starts charging at 0.8km), because
 * the router *prefers* and the contract *objects* — a preference that fires
 * on every card is telemetry nobody reads.
 */
export const TREK_LEG_KM = 2;

/**
 * A walk that covers more than this many times its own start-to-finish line
 * is a night spent doubling back — the same figure `scoreRoute` starts
 * penalising at, held here as the line a finished card should not cross.
 */
export const DETOUR_CEILING = 3;

/** The drink names narrow enough to check against a pub's own facts. Anything
 * fuzzier is the caddy's judgement, which is not the contract's business. */
const BEERY = /\b(pints?|ale|lager|stout|bitter|cask|ipa)\b/i;
const WINEY = /\b(wine|prosecco|champagne)\b/i;
const COCKTAILY = /\b(cocktails?|martini|negroni|spritz|margarita|mojito|old fashioned)\b/i;

function span(holes: PlannedHole[]): { total: number; worst: number; progress: number } {
  let total = 0;
  let worst = 0;
  const placed = holes.filter(
    (hole): hole is PlannedHole & { lat: number; lng: number } =>
      typeof hole.lat === "number" && typeof hole.lng === "number",
  );
  for (let i = 1; i < placed.length; i += 1) {
    const km = haversineKm(
      placed[i - 1].lat,
      placed[i - 1].lng,
      placed[i].lat,
      placed[i].lng,
    );
    total += km;
    worst = Math.max(worst, km);
  }
  const progress =
    placed.length > 1
      ? haversineKm(
          placed[0].lat,
          placed[0].lng,
          placed[placed.length - 1].lat,
          placed[placed.length - 1].lng,
        )
      : 0;
  return { total, worst, progress };
}

export interface ContractBrief {
  holes: number;
  startVenueId: string | null;
  finishVenueId: string | null;
}

/**
 * Check a finished card against the contract.
 *
 * `candidates` is the dossier the card was chosen from — the facts behind the
 * drinks clause and the venue ids behind the real-venues clause. A card being
 * checked against a swept dossier passes those clauses vacuously rather than
 * failing them: no evidence is not adverse evidence.
 */
export function checkCard(
  holes: PlannedHole[],
  brief: ContractBrief,
  candidates: CandidateDossier[] = [],
): ContractReport {
  const findings: ContractFinding[] = [];
  const byVenue = new Map(candidates.map((c) => [c.venueId, c]));

  // Real venues, used once. `parsePlan` guarantees this by construction, so a
  // finding here means the pipeline has a bug — which is exactly what the
  // contract is for.
  const seen = new Set<string>();
  holes.forEach((hole, index) => {
    if (!hole.venue_id) {
      findings.push({
        clause: "real-venues",
        hole: index + 1,
        note: "No venue behind this hole.",
      });
      return;
    }
    if (seen.has(hole.venue_id)) {
      findings.push({
        clause: "real-venues",
        hole: index + 1,
        note: "The same pub twice.",
      });
    }
    seen.add(hole.venue_id);
    if (candidates.length > 0 && !byVenue.has(hole.venue_id)) {
      findings.push({
        clause: "real-venues",
        hole: index + 1,
        note: "A venue the dossier never offered.",
      });
    }
  });

  // Pinned tees at the ends.
  if (brief.startVenueId && holes[0]?.venue_id !== brief.startVenueId) {
    findings.push({ clause: "pins-hold", hole: 1, note: "The pinned tee is not first." });
  }
  if (
    brief.finishVenueId &&
    holes[holes.length - 1]?.venue_id !== brief.finishVenueId
  ) {
    findings.push({
      clause: "pins-hold",
      hole: holes.length,
      note: "The pinned finish is not last.",
    });
  }

  // Full count: the host asked for this many and the fee is judged on it.
  if (holes.length < brief.holes) {
    findings.push({
      clause: "full-count",
      note: `${holes.length} holes on a card that asked for ${brief.holes}.`,
    });
  }

  // Hazards where the rules allow them: never on the first hole, and never a
  // hazard the club bars from the last.
  if (holes[0]?.hazard) {
    findings.push({
      clause: "hazards-legal",
      hole: 1,
      note: "A hazard on the first hole.",
    });
  }
  const last = holes[holes.length - 1];
  if (last?.hazard) {
    const rule = HAZARDS.find((h) => h.id === last.hazard);
    if (rule && !rule.onFinalHole) {
      findings.push({
        clause: "hazards-legal",
        hole: holes.length,
        note: `${rule.label} cannot finish a round.`,
      });
    }
  }

  // The walk itself: no trek legs, and a night that goes somewhere.
  const { total, worst, progress } = span(holes);
  if (worst > TREK_LEG_KM) {
    findings.push({
      clause: "legs-in-bounds",
      note: `A ${worst.toFixed(1)}km leg is a march, not a walk between rounds.`,
    });
  }
  if (holes.length > 2 && progress > 0.05 && total / progress > DETOUR_CEILING) {
    findings.push({
      clause: "goes-somewhere",
      note: `${total.toFixed(1)}km walked to cover ${progress.toFixed(1)}km — a lap, not a crawl.`,
    });
  }

  // Drinks a pub actually pours. Only the pairings narrow enough to check;
  // `null` facts pass, because unknown is not no.
  holes.forEach((hole, index) => {
    const facts = hole.venue_id ? byVenue.get(hole.venue_id)?.facts : undefined;
    if (!facts) return;
    const drink = hole.drink;
    const refused =
      (BEERY.test(drink) && facts.servesBeer === false) ||
      (WINEY.test(drink) && facts.servesWine === false) ||
      (COCKTAILY.test(drink) && facts.servesCocktails === false);
    if (refused) {
      findings.push({
        clause: "drinks-pourable",
        hole: index + 1,
        note: `"${drink}" at a pub Google says does not pour it.`,
      });
    }
  });

  return { findings, clean: findings.length === 0 };
}

/** The report as the turn row stores it — compact, and stable enough to
 * aggregate across weeks of cards. */
export function contractRecord(report: ContractReport): {
  clean: boolean;
  findings: { clause: ContractClause; hole?: number; note: string }[];
} {
  return { clean: report.clean, findings: report.findings };
}
