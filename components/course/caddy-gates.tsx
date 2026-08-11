import type { CaddyGate } from "@/lib/caddy/readiness";

/**
 * The shut gates, named — a staging-only note explaining why the caddy is not
 * on this page.
 *
 * Deliberately plain. It is not a house surface and should not read as one: no
 * card, no eyebrow, no engraving, nothing that could be mistaken for something
 * a player is meant to see. `app/courses/new/page.tsx` is what keeps it off
 * production; this only has to look like what it is.
 */
export function CaddyGates({ gates }: { gates: CaddyGate[] }) {
  if (!gates.length) return null;
  return (
    <aside
      data-testid="caddy-gates"
      className="mx-auto mt-8 max-w-md px-4 pb-10 text-xs text-muted-foreground"
    >
      <p className="font-mono uppercase tracking-[0.08em]">
        Staging note — the caddy is not on this page
      </p>
      <ul className="mt-2 space-y-2">
        {gates.map((gate) => (
          <li key={gate.label}>
            <span className="font-medium text-foreground">{gate.label}</span>
            <br />
            {gate.fix}
          </li>
        ))}
      </ul>
      <p className="mt-3">
        This note never renders on production. See DEPLOYMENT.md.
      </p>
    </aside>
  );
}
