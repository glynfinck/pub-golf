# Caddy: where this is up to

**Superseded.** This was a running handoff for the branch
`claude/pub-golf-caddy-spec-ydipz4`, and it was stale by seven migrations
before anybody noticed — which is what a document that has to be rewritten on
every commit does. The state of the branch is in the branch.

Read these instead:

- **`docs/CADDY-DESIGN-AUDIT.md`** — what the caddy is, the pricing model and
  its invariants, how a plan is produced, what is stored, the covenant as
  enforceable rules, and the decisions taken against it. Section 9 records
  where each decision landed, with the file or migration it became.
- **`docs/CADDY-TOPUPS.md`** — the measured cost of a plan, a roll and a tweak,
  the worst case a fee can reach, and why the ladder is priced the way it is.
- **`docs/CADDY-STAGES.md`** — why the plan is a bounded agentic loop rather
  than one call, and what the per-turn timeout is for.
- **`docs/CADDY-ROUTE-GRAPH.md`** — how the walk is worked out, which is
  arithmetic's job and never the model's.
- **`CLAUDE.md`** — the conventions, the data model, and the caddy's own
  section, which is the thing to read first in a fresh session.
- `git log --oneline main..` — what actually happened, in order, with the
  reasoning in the commit messages.

The one thing a handoff was genuinely useful for, kept:

**Nothing here runs the db, stress or e2e tiers.** They need a local Supabase
stack (`supabase start`) and Docker, and no session on this branch has had
either. `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` are
the four that have been run on every commit. Database changes have instead been
applied to the preview branch project and probed with adversarial SQL inside a
transaction — which proves the rule and does not prove the suite.
