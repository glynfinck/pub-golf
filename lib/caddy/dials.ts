import { withMove, withSwap } from "@/lib/caddy/swap";

/**
 * The host's hand on the menu, as a state machine.
 *
 * **The rule this exists to hold: re-routing forgets the hand-edit and the
 * open card, together or not at all.** Every control that changes which walk
 * is on the map used to forget only *some* of it — the dials cleared `edited`
 * and `routeIndex` but left `tapped` pointing at a position in a walk that no
 * longer existed. On a shorter walk the card then described the wrong pub,
 * "Swap" offered "nothing else round here" over a full menu, and "Later" faked
 * an edit by moving a stop the host had never tapped.
 *
 * That rule was six `reset()` calls in a hook, which is a convention: the
 * seventh mutator is one line away from shipping without it, and nothing but
 * a careful reader stands in the way. Here it is a function of the action, so
 * `tests/unit/caddy-dials.test.ts` can walk every action there is and prove
 * it — the tier CLAUDE.md asks for, since a browser was never needed to know
 * this.
 *
 * Pure and stops-in, so the reducer never has to reach for the routing it
 * would otherwise need: a swap and a move are arithmetic over the walk the
 * caller already has on screen.
 */

export interface DialState {
  /** How many holes the walk is dialled to. */
  holes: number;
  /** How far apart, on the brief's own 1..9 scale. */
  stretch: number;
  /** Which of the offered walks. */
  routeIndex: number;
  /** The host's version of the chosen walk, once they have changed one. Null
   * means "the caddy's, as offered". */
  edited: string[] | null;
  /** Which stop's card is open, by position in the walk. */
  tapped: number | null;
  /** The open card is showing what it could be swapped for. */
  swapping: boolean;
}

export const DIALS_START: DialState = {
  holes: 9,
  stretch: 5,
  routeIndex: 0,
  edited: null,
  tapped: null,
  swapping: false,
};

export type DialAction =
  /** A menu arrived: take its shape and drop everything about the last one. */
  | { type: "seed"; holes: number; stretch: number }
  | { type: "route"; index: number }
  | { type: "holes"; value: number }
  | { type: "stretch"; value: number }
  | { type: "tap"; index: number | null }
  | { type: "swapping"; open: boolean }
  /** `stops` is the walk on screen — the reducer does not route. */
  | { type: "swap"; index: number; id: string; stops: string[] }
  | { type: "move"; index: number; delta: number; stops: string[] }
  /** Put the caddy's own walk back. */
  | { type: "restore" };

/**
 * The actions that change which walk is on the map.
 *
 * Named as data rather than spelled out in each branch, so the test can assert
 * the invariant over this list and a new re-routing action has one obvious
 * place to declare itself.
 */
export const REROUTING: DialAction["type"][] = [
  "seed",
  "route",
  "holes",
  "stretch",
  "restore",
];

/** Forget the hand-edit and the open card. Never one without the others. */
const FORGOTTEN = { edited: null, tapped: null, swapping: false } as const;

export function dialsReducer(state: DialState, action: DialAction): DialState {
  switch (action.type) {
    case "seed":
      return {
        ...state,
        ...FORGOTTEN,
        holes: action.holes,
        stretch: action.stretch,
        routeIndex: 0,
      };
    case "route":
      return { ...state, ...FORGOTTEN, routeIndex: action.index };
    case "holes":
      // Back to the first walk: the walks are re-solved for the new count, so
      // "the second one" is not the same second one.
      return { ...state, ...FORGOTTEN, holes: action.value, routeIndex: 0 };
    case "stretch":
      return { ...state, ...FORGOTTEN, stretch: action.value, routeIndex: 0 };
    case "restore":
      return { ...state, ...FORGOTTEN };
    case "tap":
      // Opening a different stop's card closes the swap list the last one had
      // open; leaving it open showed one pub's name over another's options.
      return { ...state, tapped: action.index, swapping: false };
    case "swapping":
      return { ...state, swapping: action.open };
    case "swap":
      return {
        ...state,
        edited: withSwap(action.stops, action.index, action.id),
        tapped: action.index,
        swapping: false,
      };
    case "move": {
      const next = withMove(action.stops, action.index, action.delta);
      // A refused move returns the same array. Re-pointing the card at
      // `index + delta` anyway is how "Later" on the last stop came to open a
      // different pub's card and look like an edit that never happened.
      if (next === action.stops) return state;
      return {
        ...state,
        edited: next,
        tapped: Math.min(
          Math.max(action.index + action.delta, 0),
          next.length - 1,
        ),
        swapping: false,
      };
    }
  }
}
