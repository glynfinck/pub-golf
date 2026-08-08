/**
 * Bounded fan-out, shared by the fixtures and the teardown.
 *
 * Setup and cleanup are not the experiment. Minting twenty sessions, or
 * deleting them again, is something the suite needs done — not something it
 * is measuring — so it goes through a bounded pool, which is a faster and
 * steadier way to arrive at the same twenty sessions than firing all twenty
 * at gotrue at once. Where the simultaneity IS the point (the join stampede,
 * the score storm), the tests use Promise.all directly and say so.
 *
 * Results come back in the order of `items`, never the order they finished.
 */
export async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await work(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
