# Administrative migrations

This directory holds migrations that require **ownership-level PostgreSQL
DDL** — operations like `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` or
`CREATE POLICY` that PostgreSQL restricts to a table's owner (or a
superuser), and `CREATE OR REPLACE FUNCTION` on functions owned by a
different role. It is deliberately **separate from `database/migrations/`**,
the canonical directory for ordinary application migrations.

## Why this directory exists

The application's only production database role, `devcontrol`, is
intentionally non-superuser and does not own the tables it operates on —
confirmed live via `pg_roles` (`rolsuper = false`, and ownership checks
against `pg_class`). This is not an oversight; it's what makes Row-Level
Security meaningful in the first place: a role can't be usefully restricted
by RLS on a table it owns, since owners bypass RLS by default. Nearly every
application table in production is owned by `postgres`, an artifact of how
the schema was originally built, not a deliberate ownership model.

The practical consequence: `devcontrol` cannot execute `ENABLE ROW LEVEL
SECURITY` or `CREATE POLICY` against a `postgres`-owned table. Running
`database/migrate.js` with `devcontrol`'s normal credentials against such a
migration fails with `must be owner of table <name>` (PostgreSQL error
`42501`) — this was directly observed and documented while building this
mechanism, not a hypothetical.

This is not unique to any single migration. `022_cost_recommendations_org_scoping.sql`
and `028_alert_history_org_scoping.sql` (both already in
`database/migrations/`, both still pending) target `cost_recommendations`
and `alert_history` respectively — both independently confirmed
`postgres`-owned in production. Any future migration that enables RLS or
otherwise requires ownership will hit the same wall. This directory and its
execution mechanism exist to handle that whole class of migration
consistently, rather than solving it ad hoc each time.

## Why Unix-socket peer authentication

Production's `pg_hba.conf` already grants OS user `postgres` passwordless
access to PostgreSQL role `postgres`, over the Unix socket only:

```
local   all             postgres                                peer
```

This is pre-existing configuration, not something introduced by this
mechanism. Using it means an administrative migration never requires a new
password, a stored credential, or any change to `devcontrol`'s own setup —
peer authentication ties database identity to OS process identity, with
nothing to leak, rotate, or accidentally expose. The alternative (a TCP
password credential for the `postgres` role) was investigated and found not
to exist anywhere in this project's configuration, and deliberately was not
created — provisioning one would be a separate, larger decision than
building an execution path.

## What role actually executes the migration

**PostgreSQL role `postgres`**, via the OS process running as OS user
`postgres` (never `devcontrol`, and this mechanism never touches
`devcontrol`'s grants, ownership, or credentials in any way). The
application continues running as `devcontrol` at all times, completely
unaffected by this directory's existence or use.

## Which migrations are classified as administrative

Currently: **`202608221231_enable_rls_on_anomaly_rules.sql`**,
**`202608270610_add_stripe_fields.sql`**,
**`022_cost_recommendations_org_scoping.sql`**,
**`028_alert_history_org_scoping.sql`**,
**`004_add_multi_tenancy.sql`**,
**`005_migrate_existing_data.sql`**,
**`006_create_service_dependencies.sql`**,
**`008_create_aws_resources.sql`**,
**`009_create_onboarding_progress.sql`**,
**`010_create_analytics_events.sql`**,
**`011_add_cost_attribution_to_aws_resources.sql`**,
**`020_wire_compliance_and_orphaned_scanning.sql`**,
**`021_wire_cost_recommendations_scanning.sql`**,
**`023_create_account_security_findings.sql`**,
**`029_add_resource_reconciliation.sql`**, and
**`202608272014_extend_scheduled_reports_ai_types.sql`**.

A migration belongs here if and only if it requires ownership-level DDL
that `devcontrol` cannot perform under its normal grants — enabling RLS on
a table it doesn't own, creating a policy, replacing a function it doesn't
own, or **any other DDL — including a plain `ALTER TABLE ... ADD COLUMN`
— against a table `devcontrol` doesn't own.** Anything `devcontrol` can
already do with its existing SELECT/INSERT/UPDATE/DELETE-plus-DDL-it-owns
privileges belongs in the ordinary `database/migrations/` directory instead.

`202608270610_add_stripe_fields.sql` was moved into this directory after a
live `--execute-only` attempt against production failed with PostgreSQL
`42501: must be owner of table organizations`. Direct inspection confirmed
`public.organizations` is owned by `postgres` in production (`pg_class` /
`pg_get_userbyid`), while the ordinary runner connects as `devcontrol`
(`current_user` = `session_user` = `devcontrol`) — the same ownership
pattern already documented above for RLS, just triggered by ordinary
`ADD COLUMN` DDL rather than `ENABLE ROW LEVEL SECURITY`. The failed
attempt rolled back cleanly (`BEGIN`/`ROLLBACK`, per `database/migrate.js`'s
own transaction handling) and was never recorded in `schema_migrations` —
nothing was left partially applied. Only the migration's classification and
deployment path changed; its SQL is untouched.

`022_cost_recommendations_org_scoping.sql` and
`028_alert_history_org_scoping.sql` were moved into this directory
preventively, following a live, read-only production ownership audit (a
single `pg_class`/`pg_namespace` query, not application documentation)
across every table targeted by an `ALTER TABLE` statement anywhere in
`database/migrations/`. That audit **directly observed** that
`cost_recommendations` and `alert_history` are owned by `postgres` in
production, and that the ordinary migration runner connects as
`devcontrol` (`current_user` = `session_user` = `devcontrol`) — the same
identity/ownership mismatch already established for `organizations`
above. Both files also contain real `ALTER TABLE ... ENABLE ROW LEVEL
SECURITY` and `CREATE POLICY` statements against those tables. PostgreSQL
requires ownership of the target table for both `ALTER TABLE` and `CREATE
POLICY` — this classification is made **because live ownership was
verified to not match the connecting role**, not merely because the SQL
happens to contain the words `ROW LEVEL SECURITY`/`POLICY`; a file
containing those exact keywords against a `devcontrol`-owned table would
not belong here, and (per the same audit) a file with neither keyword
against a `postgres`-owned table still would. This is a **preventive**
move: no migration in this directory (including these two) has been
executed as part of this reclassification, and no claim is made here
about whether either file has ever executed successfully against
production historically, through any runner or otherwise — that remains
exactly as unestablished as it was before this change, per the historical
provenance standard already documented in `database/migrations/README.md`.

`004_add_multi_tenancy.sql`, `005_migrate_existing_data.sql`,
`006_create_service_dependencies.sql`, `008_create_aws_resources.sql`,
`009_create_onboarding_progress.sql`, `010_create_analytics_events.sql`,
`011_add_cost_attribution_to_aws_resources.sql`,
`020_wire_compliance_and_orphaned_scanning.sql`,
`021_wire_cost_recommendations_scanning.sql`,
`023_create_account_security_findings.sql`, and
`029_add_resource_reconciliation.sql` were moved into this directory as a
batch, following the same live ownership audit referenced above extended
to every table targeted by an `ALTER TABLE` statement anywhere in
`database/migrations/`. That audit **directly observed** each of these
files' target table(s) — `teams`, `services`, `deployments`,
`infrastructure_resources`, `cost_recommendations`, `alert_history`,
`audit_logs`, `service_dependencies`, `aws_resources`,
`resource_discovery_jobs`, `onboarding_progress`, `analytics_events`, and
`account_security_findings` — as `postgres`-owned, against the same
`devcontrol` connecting identity confirmed throughout this document. Some
of these files also contain real `ENABLE ROW LEVEL SECURITY`/`CREATE
POLICY` DDL; at least one (`005_migrate_existing_data.sql`) contains
**no** RLS or policy keywords at all and is classified here purely on
verified ownership — direct evidence that this classification is
ownership-based, not keyword-based. As with the moves above, this is a
**preventive, classification-only** change:

- No migration among these eleven has been executed as part of this
  reclassification, and none is executed by moving it or by any CI job
  that packages/deploys this directory.
- No claim is made about whether any of these files has or has not
  historically executed successfully against production, through
  `database/migrate.js`, manually, or otherwise — that remains exactly as
  unestablished as before this change, per `database/migrations/README.md`'s
  historical provenance standard.
- No claim is made that these files' effects are reconciled with
  `schema_migrations` — none of them have a ledger row, and moving them
  does not create, remove, or verify one.
- This move does not, by itself, change any table's actual ownership in
  any database. (A later, separate change taught CI's ephemeral schema
  bootstrap to include eligible files from this directory — see "CI
  ephemeral schema inclusion" below — but that was not part of this
  reclassification.)
- `016_create_ai_generated_reports.sql` is deliberately **not** included
  here despite touching a `postgres`-owned table (`scheduled_reports`):
  it also creates a new, unrelated table (`generated_reports`) in the same
  file, so a whole-file move would misclassify its safe portion. Resolving
  it requires a separate content decision, not a plain move.
- `026_api_keys_org_scoping.sql` and `027_webhook_endpoints_org_scoping.sql`
  are deliberately **not** included here: their target tables were not
  found in production at all during the same audit, which is a different,
  already-documented problem (see `database/migrations/README.md`'s
  "Specific audited artifacts" table), not an ownership question this
  directory's mechanism addresses.

`202608272014_extend_scheduled_reports_ai_types.sql` is the resolution of
the `016_create_ai_generated_reports.sql` mixed-file case flagged above.
`scheduled_reports` was already confirmed `postgres`-owned by the same
audit that covers the eleven-file batch. The original file has been
**retired** (deleted, not repurposed) rather than edited in place or
reused under its old name, and split in two:

- `database/migrations/202608272013_create_generated_reports.sql` — the
  `generated_reports` table, its five indexes, and its comments, unchanged
  from the original file except for the separation itself and five
  previously-added `CREATE INDEX IF NOT EXISTS` guards (`generated_reports`
  is a table this migration creates itself, not `postgres`-owned, and
  stays on the ordinary path).
- This file — the `scheduled_reports_report_type_check` constraint
  replacement, preserving the original's exact `DROP CONSTRAINT IF
  EXISTS` / `ADD CONSTRAINT` semantics and its exact six allowed values.
  The original's `DO $$ ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE ...
  END $$;` wrapper has been **removed entirely**: it existed only to
  swallow a `42501` ownership error under the ordinary path so the rest
  of the migration could still commit, which meant a real failure could
  go unnoticed while the migration was still recorded as applied. On this
  path, connecting as the actual table owner, a failure should abort and
  roll back loudly instead.

As with every move above, this is classification and content-separation
only: **no claim is made that either resulting file has been executed,
through any runner or otherwise, and neither has a `schema_migrations`
row.** A prior, separate, read-only production verification (see the
Stripe section below for the equivalent exercise) found both of the
original file's intended effects — the `generated_reports` table/indexes/
comments, and the new AI-inclusive `scheduled_reports` constraint — already
present in production; that finding describes production's current state,
not execution provenance for either new file, and is not re-asserted here
as a reason to treat either as already applied.

Classification is structural, not a naming convention or a maintained
exclusion list: a migration is administrative *because* it lives in this
directory, and nothing here is ever scanned by `database/migrate.js`'s
ordinary `MIGRATIONS_DIR` resolution in **production** (always
`database/migrations/`, hardcoded relative to wherever `migrate.js` itself
is deployed) — there is no list to remember to update there; a migration
simply cannot be swept into a production `--pending` sweep unless it's
physically moved back to the ordinary directory. **This directory's CI
treatment is different — see "CI ephemeral schema inclusion" below.**

## CI ephemeral schema inclusion

`.github/scripts/ci-bootstrap-schema.js` **does** scan this directory as
of a later, separate change from every reclassification above — it no
longer only scans `database/migrations/`. This is deliberately not the
same thing as production execution:

- The reason this directory exists at all is that production's
  `devcontrol` role is non-superuser and doesn't own many application
  tables, so DDL against them must run as `postgres` instead. CI's
  ephemeral `lint-and-build` Postgres container has no such split: both
  the schema-bootstrap step and the subsequent test-run step already
  connect as `DB_USER=postgres` — the actual superuser of that disposable
  database — so the ownership restriction this directory exists to solve
  in production **cannot occur in CI regardless of which directory a
  migration file lives in.**
- Given that, `ci-bootstrap-schema.js` copies eligible `*.sql` files from
  **both** `database/migrations/` and this directory into one shared temp
  directory and applies them through a single `runMigrations()` call —
  not a second pass — so the runner's own alphabetical filename sort
  resolves ordering across both directories (e.g. an admin-classified
  migration that `ALTER`s a table an ordinary migration creates).
- `202608221231_enable_rls_on_anomaly_rules.sql` is excluded from this CI
  sweep specifically, for a reason unrelated to ownership: it intentionally
  `RAISE EXCEPTION`s unless the pre-existing production table
  `anomaly_rules` already exists with an exact assumed shape, and no
  migration in this repository creates that table. It cannot succeed
  against any fresh database, CI included, by its own explicit design —
  this exclusion reflects what that file already says about itself, not a
  new decision made for CI's sake.
- **This CI inclusion does not authorize, perform, or imply execution of
  any admin migration against production.** Every administrative
  migration still requires its own separate, explicit production
  execution authorization exactly as described below — CI building a
  disposable test schema is a different act entirely from applying DDL to
  the real database.

## Explicit authorization required

Every administrative migration requires its own separate, explicit
execution authorization — the same discipline already applied throughout
this mechanism's design and construction. This directory being deployed to
production does **not** mean any migration in it has run; deployment only
stages files (see "Deployment," below), exactly like
`deploy-migration-tooling` already does for the ordinary path.

## Deployment

A dedicated CI job, `deploy-migration-tooling-admin` (parallel to, and
independent from, `deploy-migration-tooling`), packages `database/migrate.js`
together with this directory's `*.sql` files (staged internally as
`migrations/`, matching what `migrate.js`'s hardcoded `MIGRATIONS_DIR`
resolution expects), **plus a self-contained `node_modules/` containing
only `pg` and its own dependencies** — deliberately, so this deployment
never needs to read anything under `/home/ubuntu` (including
`backend/node_modules`, which OS user `postgres` cannot reach). Node's
ordinary module resolution finds this `node_modules/` automatically, as a
sibling of `migrate.js`, with no `NODE_PATH` override needed.

This artifact is deployed to `/opt/devcontrol-admin/`, a location created
for this purpose alone — never a permissions change retrofitted onto
`/home/ubuntu`. It reuses `.github/scripts/deploy-migration-symlink.sh`
completely unmodified (that script already accepts an arbitrary `dest`
argument), so the same atomic, verified, never-blindly-overwriting symlink
logic already relied on for the ordinary path applies here too. The release
directory is created group-owned by `postgres` with no "other" access, so
only OS users `root` and `postgres` can read it — never `ubuntu`, and never
world-readable.

**Like `deploy-migration-tooling`, this job only makes files available on
the host. It never executes `node database/migrate.js` in any mode.**
Running it remains a separate, manually-approved operation performed later
by a human (or an explicitly authorized agent action), exactly as already
documented for the ordinary migration path in
`database/migrations/README.md`.

## Execution mechanism

```bash
cd /opt/devcontrol-admin
DB_USER=postgres DB_HOST=/var/run/postgresql \
node database/migrate.js --execute-only <name>
```

This is the **unmodified** canonical `database/migrate.js` — same
checksum validation, same per-migration `BEGIN`/`COMMIT`/`ROLLBACK`, same
advisory lock, same `schema_migrations` insert on success. Only the
connection identity differs from the ordinary path (`DB_USER=postgres`,
`DB_HOST` pointed at the Unix socket directory instead of `devcontrol`'s
usual TCP `localhost`) and the working directory (the self-contained
administrative deployment, not the ordinary one). No `NODE_PATH` override
is needed — `node_modules/pg` ships as part of this deployment, as a
sibling of `migrate.js`, found by Node's default resolution. Nothing about
`migrate.js`'s own code changes, and nothing here bypasses its ledger the
way the historical `sudo -u postgres psql -f` precedent for
`030_fix_tracking_trigger_uuid_type_mismatch.sql` did (see
`database/migrations/README.md`'s "Specific audited artifacts" table) — a
successful administrative migration is recorded in `schema_migrations`
exactly like any other.

This invocation must run as OS user `postgres` (e.g. via `runuser -u
postgres --`) for peer authentication to apply — see "Why Unix-socket
peer authentication," above.

## Production execution history — `202608270610_add_stripe_fields.sql`

A real (non-dry-run) `--execute-only 202608270610_add_stripe_fields.sql`
attempt was made against production via the ordinary path, before this
migration was reclassified into this directory (SSM CommandId
`5848b26e-c714-4c8b-94ed-181858692709`, `ExecutionStartDateTime`
`2026-08-27T22:22:58.572Z`). It failed and was rolled back. A fresh,
separate read-only verification was then run against production to
establish current state. What follows distinguishes exactly what each
source actually established.

**Directly observed (fresh `SELECT`s against production, same session):**
- All 6 Stripe columns (`stripe_customer_id`, `stripe_subscription_id`,
  `subscription_status`, `subscription_current_period_start`,
  `subscription_current_period_end`, `subscription_cancel_at_period_end`)
  currently exist on `public.organizations`.
- All 3 Stripe indexes (`idx_organizations_stripe_customer_id`,
  `idx_organizations_stripe_subscription_id`,
  `idx_organizations_stripe_customer_unique`) currently exist, with
  definitions matching this migration's `CREATE INDEX`/`CREATE UNIQUE INDEX`
  statements exactly, including the unique index's partial
  `WHERE (stripe_customer_id IS NOT NULL)` clause.
- `schema_migrations` currently contains exactly 2 rows
  (`202608221231_enable_rls_on_anomaly_rules.sql`,
  `202608231400_create_organization_invitations.sql`) and does **not**
  contain `202608270610_add_stripe_fields.sql`.
- `public.organizations` is owned by `postgres`; the connection identity
  the ordinary migration runner actually used was `devcontrol`
  (`current_user` = `session_user` = `devcontrol`).
- The real execution attempt failed with PostgreSQL
  `42501: must be owner of table organizations`, and `database/migrate.js`
  itself reported `Rolled back. Not recorded as applied.`

**Inference (derived from the above, not a fresh observation on its own):**
the schema state observed by the fresh verification is consistent with the
Stripe columns and indexes having pre-existed this failed execution
attempt, not having been created by it. This follows from combining two
already-established facts — the failed statement almost certainly aborted
before any DDL in the file took effect (ownership errors on the first
statement in a multi-statement batch halt the whole batch), and
`schema_migrations` still has no row for this migration — not from the
rollback log in isolation. The failed transaction reporting `ROLLBACK` does
not, by itself, prove the schema is unchanged; the fresh `SELECT` evidence
above is what establishes the current state.

**Not established:** neither the failed execution nor the fresh
verification can determine *when* or *by what process* the Stripe columns
and indexes already on `public.organizations` were originally created —
only that they exist now, and that this migration's own ledger entry is
still absent now. Net result: the migration remains **unrecorded in
`schema_migrations`** despite its target schema objects already existing
in production, and no successful execution of this migration (by any
runner or path) has occurred as of this writing.
