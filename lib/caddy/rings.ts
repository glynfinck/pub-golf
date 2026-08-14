/**
 * Spending a bounded candidate budget evenly down a line.
 *
 * The gather samples a drawn walk (or a corridor between two areas) as a row
 * of circles, fires them together, and flattens the answers into one list.
 * `buildCandidates` then keeps the first `MAX_CANDIDATES` of it.
 *
 * **Flattening in circle order made that cap a decision about geography.**
 * A twelve-circle stroke returns up to twenty pubs per circle, so the first
 * two or three circles filled the budget on their own and every pub past the
 * opening quarter of the line was thrown away before the router ever saw it.
 * The host drew a walk across town and got a card in the first street of it —
 * not because anything routed badly, but because the rest of their line was
 * never a candidate.
 *
 * Interleaving by rank spends the same budget along the whole line: the best
 * pub beside every circle, then the second-best beside every circle, and so
 * on. Google's relevance order survives *within* a circle, which is the order
 * the dossier is entitled to preserve; what does not survive is one end of
 * the walk outranking the other end for no reason but arriving first.
 *
 * Pure and total: no clock, no network, and a ragged set of rings (a circle
 * over water returns nothing) simply contributes nothing at its rank.
 */
export function interleaveRings<T>(rings: T[][]): T[] {
  const deepest = rings.reduce((most, ring) => Math.max(most, ring.length), 0);
  const out: T[] = [];
  for (let rank = 0; rank < deepest; rank += 1) {
    for (const ring of rings) {
      if (rank < ring.length) out.push(ring[rank]);
    }
  }
  return out;
}
