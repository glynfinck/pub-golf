/**
 * Draft figures: the optimistic overlay a screen shows while its writes are
 * on their way to the server. Pure map maths — the debounce and the writes
 * live in `hooks/use-draft-figures.ts`; the dissolution rule lives here so
 * the unit tier can hold it.
 */

export type Figures = Record<string, number>;

/**
 * Drop every draft entry the server has caught up with — once Postgres
 * echoes the figure, the overlay's work is done and later edits from other
 * phones must show through. Returns the same object when nothing settled,
 * so a state setter can bail without a re-render.
 */
export function withoutSettled(draft: Figures, server: Figures): Figures {
  const settled = Object.keys(draft).filter((key) => server[key] === draft[key]);
  if (settled.length === 0) return draft;
  const next = { ...draft };
  for (const key of settled) delete next[key];
  return next;
}
