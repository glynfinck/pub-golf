# Squashing the caddy's migrations

Twenty-two migrations arrived on `claude/pub-golf-caddy-spec-ydipz4`, and a
good number of them undo each other. This is what a squash has to contain, why
it has not been done here, and the one command that makes it safe.

## Why not here

**It cannot be executed in this environment, and a squash that is not executed
is a guess.** `supabase db reset` needs Docker; the daemon starts fine, but the
registry's blob CDN answers `403 Forbidden` through the agent proxy, so no
Postgres image can be pulled. The remaining way to verify would be resetting
the preview branch project and applying the squash to it — which destroys the
staging data somebody may be testing against, and is not a call to make
unprompted.

The failure mode is the reason for the caution: a squash that is 99% right is a
schema that is wrong on `main`, and `PostgREST` answers a missing column with
`42703` on the whole request. The twenty-two files are applied, each was probed
against preview when it landed, and each carries the reasoning for what it
does. That is worth more on a review than one tidy file that has never run.

## What the squash must contain

### Never mention these — born and buried on the branch

| | object | born | died |
|---|---|---|---|
| table | `caddy_credits` | `20260829` | `20260831` |
| function | `caddy_courses_per_fee` | `20260829` | `20260831` |
| function | `caddy_credits_left` | `20260829` | `20260831` |
| function | `caddy_unspent_fee` | `20260829` | `20260831` |
| function + trigger | `guard_caddy_credit` | `20260829` | `20260831` |
| index | `caddy_sessions_one_course_per_fee` | `20260906` | `20260913` |

The first five are the credits table that the counted ledger replaced. The
index is the one-course rule keyed on the purchase, which
`guard_caddy_course_slot` replaced with a rule keyed on the `course` credit.

### Keep only the last definition

Ten functions are `create or replace`d more than once. Taking the final body
verbatim is the whole of the merge — they are all self-contained:

`caddy_balance` (`20260912`) · `caddy_fair_use_cap` (`20260913`) ·
`caddy_grant_size` (`20260906`) · `caddy_next_grant` (`20260912`) ·
`caddy_topup_size` (`20260909`) · `grant_caddy_package` (`20260911`) ·
`guard_caddy_fair_use` (`20260904`) · `guard_caddy_session_course` (`20260907`)
· `guard_caddy_spend` (`20260906`) · `guard_round_members` (`20260912`)

Two policies are replaced and should appear once in final form: `caddy
sessions: start your own` (`20260912`) and `bug reports: file your own`
(`20260914`, which is the version carrying both `owns_caddy_session` and
`owns_caddy_turn`).

### Keep the drops that reach back into `main`

Three statements remove objects `main` created, and must survive the squash:

- `drop trigger/function guard_caddy_course_allowance` (`20260829`)
- `drop index entitlements_one_per_round` (`20260916`)

### And one thing to drop that nothing has yet

`caddy_budget_micropence()` is orphaned. `20260904000000` removed the money
budget from `guard_caddy_fair_use`, which was its only caller, and it still
returns a figure derived from the £4 launch fee — three times out of step with
`caddyBudgetMicroPence()` in TypeScript, which is live as the loop's runaway
breaker. A db test asserts the two are equal, so that tier is red until one of
them goes. The SQL copy is the dead one.

## Verifying it

```
supabase db reset            # applies the squash from empty, and only it
npm run test:db              # the adversarial suites, against the result
npm run test:stress
```

The stronger check, if the squash is built alongside the twenty-two rather than
replacing them straight away: apply each to its own database and diff the
object inventories.

```sql
select 'table' as kind, tablename as name from pg_tables where schemaname='public'
union all select 'function', p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname='public'
union all select 'trigger', t.tgname from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and not t.tgisinternal
union all select 'policy', pol.polname || ' on ' || c.relname from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname='public'
union all select 'index', indexname from pg_indexes where schemaname='public'
union all select 'type', t.typname from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
 where n.nspname='public' and t.typtype='e'
order by 1, 2;
```

Run it against both and the diff must be empty. The result for the twenty-two,
read off preview on 12 August 2026, is 17 tables, 43 functions, 13 triggers,
37 policies, 40 indexes and 1 enum.

## The bookkeeping, which is the part that bites

Supabase's GitHub integration records applied migrations by version in
`supabase_migrations.schema_migrations`. The preview branch project has all
twenty-two recorded. Deleting those files and adding one squashed version
leaves preview holding twenty-two versions the repo no longer contains and
missing the one it does — so the integration would try to apply the squash to a
database that already has everything, and every `create table` in it would
fail.

**So the squash and a preview reset are one operation, not two.** That is
already the plan of record for this branch. `main` has none of these
migrations, so it takes the squash cleanly.
