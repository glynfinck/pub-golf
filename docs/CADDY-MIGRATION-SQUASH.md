# Squashing the caddy's migrations

Twenty-two migrations arrived on `claude/pub-golf-caddy-spec-ydipz4`, and a
good number of them undid each other.

**Done** — `20260917000000_the_caddy.sql` replaces the twenty-two. This is the
record of how it was built and what was checked, kept because the next person
to squash a branch will want it.

## How it was built

Mechanically, not by hand. A script walked the twenty-two in order, keyed every
statement by the object it defines, and kept the **last** definition of each at
the **first** position it appeared — so every body is byte-for-byte the text
that was applied to preview and probed there, while the order stays the one the
dependencies were written for.

Three bugs in that script are worth naming, because each produced a file that
looked complete and was not:

- **The splitter tracked `$$` and nothing else.** A `;` inside a `/* … */`
  block cut a statement in half and glued the tail of a comment onto the front
  of the next one, so `drop trigger if exists guard_caddy_credit` was never
  recognised as a drop. Six objects survived that should have been buried.
- **Keying used `re.match` on the raw statement.** Every statement here is
  preceded by its own comment block, so the `create` was never at position
  zero. Six functions went missing from the output entirely.
- **A superseded object moved to its last definition's position.** That put
  `grant execute on function public.caddy_balance` ahead of
  `caddy_balance` — five forward references that would have failed the file on
  the first `db reset`.

The lesson is the ordinary one: a squash is a program, and a program that has
not been checked against its own output is a guess.

## What was checked

- **Object inventory.** Everything the file creates matches what the preview
  project actually held after the twenty-two: 4 tables, 6 triggers, 8 policies,
  9 indexes, 1 enum, and 20 functions less the one deliberately dropped.
- **Creation-time resolution.** Policies and triggers resolve function names
  when they are created; plpgsql bodies do not. Every one of those ten pairings
  was asserted to be defined-before-used.
- **CI.** `supabase db reset` applies this from empty and then the db, stress
  and e2e tiers run against the result. That is the proof; the above is what
  made it worth running.

## What it contains

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

### And three decided rather than derived

**`caddy_budget_micropence()` is dropped.** `20260904000000` removed the money
budget from `guard_caddy_fair_use`, its only caller, and it went on returning a
figure derived from the £4 launch fee — three times out of step with
`caddyBudgetMicroPence()` in TypeScript, which is live as the tool loop's
runaway breaker. The db test that held them equal is inverted: the database
must not answer that name, and the TypeScript copy is the only one there is.

**`caddy_quota` is created with all three values.** It shipped as
`('redesign', 'tweak')` and gained `'course'` in its own migration, because
`alter type … add value` cannot run in the transaction that created the type.
In one file it has to be one statement. The order is preserved — `caddy_next_grant`
reads it.

**The four backfills are dropped.** They repaired rows that existed on the
branch project mid-flight. A squash runs from empty and has nothing to
repair.

## The inventory query

Run against a database with the twenty-two and one with the squash; the diff
must be empty. Preview's answer on 12 August 2026, with all twenty-two applied,
was 17 tables, 43 functions, 13 triggers, 37 policies, 40 indexes and 1 enum —
of which the caddy's share is 4, 20, 6, 8, 9 and 1.

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
