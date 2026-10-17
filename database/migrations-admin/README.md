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
**`029_add_resource_reconciliation.sql`**,
**`202608272014_extend_scheduled_reports_ai_types.sql`**,
**`202608312100_add_billing_lifecycle_state.sql`**,
**`202608312300_add_subscription_event_ordering.sql`**,
**`202609010800_add_payment_failed_notification_tracking.sql`**,
**`202609031800_add_cost_recommendations_occurrence_lifecycle.sql`**,
**`202609040035_add_account_security_findings_disposition.sql`**,
**`202610102024_drop_auto_detect_resource_ownership.sql`**,
**`202610112300_create_framework_evaluation_persistence.sql`**, and
**`202610161210_create_resource_health_evaluations.sql`**.

`202609010800_add_payment_failed_notification_tracking.sql` `ALTER TABLE`s
`organizations` (adding the payment-failed-notification-reliability fix's
`payment_failed_notification_sent_at` column) -- the same table, and the
same ownership finding, as every other `ALTER TABLE organizations`
migration above. Classified here from the start (not reclassified after a
failed attempt) -- the ownership finding was already well-established by
the time this migration was written.

`202608312300_add_subscription_event_ordering.sql` `ALTER TABLE`s
`organizations` (adding the P1 stale-subscription-event fix's
`latest_processed_subscription_event_created_at` column) -- the same
table, and the same ownership finding, as `202608270610_add_stripe_fields.sql`
and `202608312100_add_billing_lifecycle_state.sql` above. Unlike those two,
this file's reclassification was not preventive: it was placed in the
ordinary `database/migrations/` path first, a real `--execute-only` attempt
against production from there failed with the exact `42501` error this
directory exists to solve, and it was moved here as the direct, observed
consequence -- see "Production execution history" below for the record of
the failed ordinary-path attempt.

`202608312100_add_billing_lifecycle_state.sql` `ALTER TABLE`s
`organizations` (adding the P0 payment-failure lifecycle's
`billing_lifecycle_state`/`payment_failed_at`/`grace_period_ends_at`
columns) -- the same table, and the same ownership finding, as
`202608270610_add_stripe_fields.sql` above. No new ownership audit was
needed: `organizations`' ownership hasn't changed, and a local
`pg_get_userbyid(relowner)` check re-confirmed it at the time this
migration was written.

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
# 1. preview: prints current_database(), current_user and the target; executes nothing
cd /opt/devcontrol-admin && runuser -u postgres -- env DB_NAME=<production database name> DB_USER=postgres DB_HOST=/var/run/postgresql node database/migrate.js --execute-only <name> --dry-run
# 2. review the preview output, then the same command without --dry-run:
cd /opt/devcontrol-admin && runuser -u postgres -- env DB_NAME=<production database name> DB_USER=postgres DB_HOST=/var/run/postgresql node database/migrate.js --execute-only <name>
```

`DB_NAME` is required. `database/migrate.js` refuses `--execute-only`
(including its `--dry-run` preview), `--init-baseline` and any non-dry-run
run when `DB_NAME` is unset, before it connects to anything. Without that
check, a command run as OS user `postgres`, whose environment has no
`DB_NAME`, would silently target the runner's `platform_portal` default
instead of the production database. Check the `Database` and `Role` lines
in the preview before running step 2. The production database name is
deliberately not written in this public repository.

This is the canonical `database/migrate.js` — same
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

This invocation must run as OS user `postgres` (the `runuser -u postgres
-- env ...` form above) for peer authentication to apply — see "Why
Unix-socket peer authentication," above.

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

## Production execution history — `202608312300_add_subscription_event_ordering.sql`

A real (non-dry-run) `--execute-only 202608312300_add_subscription_event_ordering.sql`
attempt was made against production via the ordinary path, before this
migration was reclassified into this directory (SSM CommandId
`b777239f-78bd-4350-b7e9-395273dc320d`, `ExecutionStartDateTime`
`2026-09-01T03:01:42.371Z`). A read-only pre-flight in the same session had
already confirmed the deployed release matched the target commit and the
migration file's checksum matched the exact Git blob at that commit before
the attempt was made.

**Directly observed:**
- The attempt failed with PostgreSQL `42501: must be owner of table
  organizations`, and `database/migrate.js` itself reported `Rolled back.
  Not recorded as applied.`
- A fresh read-only check immediately after confirmed `schema_migrations`
  contained zero rows for this migration name, and
  `organizations.latest_processed_subscription_event_created_at` did not
  exist -- the failed attempt left no partial state.
- A separate `/health` check immediately after returned `200`,
  `database: connected` -- the failed attempt did not affect the running
  application.

Only the migration's classification and deployment path changed as a
result; its SQL is unchanged from the ordinary-path version, and its
checksum changed only because this reclassification note was added to the
file's own header comment (the `ALTER TABLE`/`COMMENT ON` statements
themselves are byte-identical).

## Production execution history — `202609031800_add_cost_recommendations_occurrence_lifecycle.sql`

A real (non-dry-run) `--execute-only
202609031800_add_cost_recommendations_occurrence_lifecycle.sql` attempt
was made against production via the ordinary path, before this migration
was reclassified into this directory (SSM CommandId
`840a782e-c42a-4dbb-a18e-8f51eed26d0b`, `ExecutionStartDateTime`
`2026-09-03T18:16:44.254Z`). A read-only precheck for this migration's own
documented deployment precondition (no duplicate `(organization_id,
resource_id, issue)` groups among `ACTIVE` rows in `cost_recommendations`)
had already passed in the same session (`PRECHECK_ROWCOUNT: 0`) before the
attempt was made.

**Directly observed:**
- The attempt failed with PostgreSQL `42501: must be owner of table
  cost_recommendations`, and `database/migrate.js` itself reported
  `Rolled back. Not recorded as applied.`
- A dedicated, separate read-only ownership audit (`pg_class` /
  `pg_get_userbyid(relowner)` joined against `pg_namespace`, plus
  `pg_roles`) run immediately after confirmed `public.cost_recommendations`
  is owned by `postgres` in production, while the ordinary migration
  runner connects as `devcontrol` (`current_user` = `session_user` =
  `devcontrol`, `rolsuper = false`) — the same ownership/identity mismatch
  already documented above for `organizations`. The same audit also
  confirmed `organizations` and `aws_accounts` are `postgres`-owned, and
  enumerated every other `public`-schema table's owner in the same pass.
- A separate `/health` check immediately after the failed attempt returned
  `200`, `database: connected` — the failed attempt did not affect the
  running application.

Only the migration's classification and deployment path changed as a
result; its SQL is unchanged from the ordinary-path version except for the
addition of a PLACEMENT NOTE to its own header comment (the `ALTER TABLE`
/ `CREATE UNIQUE INDEX` statements themselves are byte-identical).

## Classification — `202609040035_add_account_security_findings_disposition.sql`

Unlike every entry above, this file was placed directly in this directory
from the start -- no ordinary-path attempt was made and none is expected to
succeed. `account_security_findings` is already one of the eleven tables
confirmed `postgres`-owned in production by the batch ownership audit
described earlier in this document (the same audit that covers
`023_create_account_security_findings.sql`, this table's own creation
migration, which already lives here). Since that ownership finding was
already established before this migration was written, writing it to the
ordinary path first would only reproduce a known, already-documented
`42501: must be owner of table account_security_findings` failure -- the
same preventive reasoning already applied to
`202609010800_add_payment_failed_notification_tracking.sql`. This migration
adds five nullable/additive columns (`disposition`, `disposition_actor_id`,
`disposition_at`, `disposition_note`, `evidence`) to that table; it contains
no RLS or policy DDL, so, as with `005_migrate_existing_data.sql` above,
this classification is ownership-based, not keyword-based.

## Classification -- `202610102024_drop_auto_detect_resource_ownership.sql`

Removes `public.auto_detect_resource_ownership()`, created by
`011_add_cost_attribution_to_aws_resources.sql`. The reason is tenant
isolation: the function sets `aws_resources.team_id` and `service_id` by
matching the resource's `Team`/`Service` tags against `teams.name` and
`services.name` with no `organization_id` predicate. Run by a role that
bypasses row-level security, as administrative SQL is, it can attach one
organization's resources to another organization's team or service. Nothing
in this repository calls it (no trigger, application code, script, scheduled
job or CI step), and the dead frontend method that targeted a nonexistent
backend route for it is removed in the same change. It is removed as a
precaution, not because a wrong mapping is known to exist.

Placed here from the start: 011 is an administrative migration, so the
function is expected to be `postgres`-owned, and only its owner or a
superuser can drop it. The migration is idempotent (a no-op if 011 never ran
or the function is already gone), targets only the exact zero-argument
`public` signature, and never uses `CASCADE`. Before dropping, it raises an
exception naming anything that uses the function: `pg_depend` dependents,
extension membership, other functions whose source mentions it, and pg_cron
jobs that call it. On that exception the runner rolls back and nothing is
dropped.

The paired `202610102024_drop_auto_detect_resource_ownership_rollback.sql`
is **manual-only and unsafe to execute**: it restores the function
byte-for-byte as 011 defined it, and with it the cross-tenant
ownership-assignment risk. `database/migrate.js` and
`.github/scripts/ci-bootstrap-schema.js` skip any filename containing
`rollback`, so no sweep applies it and `--execute-only` refuses it as not
found. The file also refuses to run without an explicit session opt-in.

As with every entry above, adding this file does not apply it anywhere. No
claim is made that it has been executed against production.

### Applying `202610102024_drop_auto_detect_resource_ownership.sql`

Each step is its own explicitly authorized operation. Steps 1 and 4 are
read-only: each runs inside `BEGIN TRANSACTION READ ONLY` and ends in
`ROLLBACK`. They are psql scripts (they use `\gset`/`\if`), run as OS user
`postgres` against the production database, by name:

```bash
cd /tmp && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d <production database name> -f <check file>
```

The check SQL lives here, not as a `.sql` file in this directory: every
`*.sql` file here is packaged as a migration and would be picked up by the
runner.

**1. Pre-check (read-only).** Expected: the first row shows the production
database and `postgres`; the identity query shows exactly one row,
`auto_detect_resource_ownership()` in schema `public`, owned by `postgres`
(or none, in which case the migration is a no-op); the dependents,
extension and untracked-caller queries return zero rows; and the pg_cron
check either reports pg_cron absent or returns zero rows. Any other result
means stop: the migration would refuse anyway, and the finding needs review
first.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT current_database(), current_user;

-- Function identity, schema and owner (every function with this name)
SELECT p.oid::pg_catalog.regprocedure AS signature,
       n.nspname AS schema,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       l.lanname AS language,
       p.prosecdef AS security_definer,
       p.proconfig
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
 WHERE p.proname = 'auto_detect_resource_ownership'
 ORDER BY n.nspname, p.oid::pg_catalog.regprocedure::text;

-- Objects that depend on the target (expect 0 rows)
SELECT pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent,
       d.deptype
  FROM pg_catalog.pg_depend d
 WHERE d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   AND d.refobjid = pg_catalog.to_regprocedure('public.auto_detect_resource_ownership()');

-- Extension membership (expect 0 rows)
SELECT e.extname
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
 WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   AND d.objid = pg_catalog.to_regprocedure('public.auto_detect_resource_ownership()')
   AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
   AND d.deptype = 'e';

-- Callers pg_depend does not track: other functions whose source mentions it (expect 0 rows)
SELECT p.oid::pg_catalog.regprocedure AS signature
  FROM pg_catalog.pg_proc p
 WHERE p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.auto_detect_resource_ownership()')
   AND pg_catalog.strpos(pg_catalog.lower(p.prosrc), 'auto_detect_resource_ownership') > 0;

-- pg_cron: is it installed, and does any job call the function (expect absent, or 0 rows)
SELECT pg_catalog.to_regclass('cron.job') IS NOT NULL AS pg_cron_installed \gset
\if :pg_cron_installed
SELECT jobid, schedule, command
  FROM cron.job
 WHERE pg_catalog.strpos(pg_catalog.lower(command), 'auto_detect_resource_ownership') > 0;
\else
\echo 'pg_cron not installed (cron.job does not exist)'
\endif

ROLLBACK;
```

**2. Preview**, then **3. apply**, with the commands from "Execution
mechanism" above and
`<name>` = `202610102024_drop_auto_detect_resource_ownership.sql`. In the
preview, confirm the `Database` and `Role` lines before applying.

**4. Post-check (read-only).** Expected: the production database and
`postgres`; `function_absent` is `t`; the remaining-functions query shows
only same-named functions in other schemas or with arguments, if any
existed in step 1 (the migration does not touch them); and exactly one
ledger row for the migration.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT current_database(), current_user;

SELECT pg_catalog.to_regprocedure('public.auto_detect_resource_ownership()') IS NULL AS function_absent;

-- Remaining functions with this name, if any (never the public zero-argument one)
SELECT p.oid::pg_catalog.regprocedure AS signature,
       n.nspname AS schema,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname = 'auto_detect_resource_ownership'
 ORDER BY n.nspname, p.oid::pg_catalog.regprocedure::text;

-- Ledger row (expect exactly 1)
SELECT migration_name, checksum, executed_at
  FROM public.schema_migrations
 WHERE migration_name = '202610102024_drop_auto_detect_resource_ownership.sql';

ROLLBACK;
```

## Classification -- `202610112300_create_framework_evaluation_persistence.sql`

Placed here from the start: it creates three tables that the `postgres` role
must own (`framework_evaluation_runs`, `compliance_check_evaluations`,
`framework_evaluation_reconciliations`), enables and forces row-level security
on them with one tenant policy each, and may add a unique constraint to
`aws_resources` (`postgres`-owned). `devcontrol` receives `SELECT`, `INSERT`,
`UPDATE` and `DELETE` on the three tables, and not `TRUNCATE`. No sequence
privilege is granted: `framework_evaluation_runs.generation` is an identity
column, and inserting through it needs only the table's `INSERT` privilege.

It is a plain create: it refuses to run if any of the three tables, or
`aws_resources_compliance_evaluation_ref_key`, already exists.

**`aws_resources (id, organization_id)` uniqueness.** The composite foreign
keys need a unique constraint over exactly `(id, organization_id)`. The
migration reuses one if any exists, whatever its name, and otherwise adds its
own as `aws_resources_compliance_evaluation_ref_key`. It never creates or drops
`aws_resources_id_org_unique`, the name
`202610161210_create_resource_health_evaluations.sql` adds when no such
constraint exists; that migration reuses this one instead (see its section
below).

**Nothing applies it automatically.** Like every file in this directory it is
run with `--execute-only` as `postgres`, after explicit authorization (see
"Execution mechanism"). The application works with or without it:

- **Not applied.** Each scan logs one error line containing
  `FRAMEWORK_EVAL_STORAGE_UNAVAILABLE`. Frameworks are not evaluated. Each
  resource's baseline findings are refreshed and its existing framework
  findings are left exactly as they are. `GET /api/services/intelligence`
  reports `framework_evaluation.storage: "unavailable"` and marks framework
  findings `current: false` (`storage_unavailable`).
- **Applied.** The first scan afterwards opens a run and rebuilds every
  resource's framework findings from what it stores.

Apply it before, or at any time after, deploying a release that uses it.

### Rollback

`202610112300_create_framework_evaluation_persistence_rollback.sql`, run
manually as `postgres` in one transaction (the runner and the CI bootstrap skip
files whose name contains `rollback`):

```bash
psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
  -f 202610112300_create_framework_evaluation_persistence_rollback.sql
```

It drops the three tables and the migration's own `schema_migrations` row. It
drops `aws_resources_compliance_evaluation_ref_key` only if the migration added
it and no other foreign key uses it; otherwise it leaves the constraint in
place and says so. It never uses `CASCADE`, and refuses if another table
references one of the three. Stored evaluations are discarded;
`aws_resources.compliance_issues` is not touched. With the tables gone, a
release that uses them behaves as under "Not applied" above.

### Framework entries stored before this release

No data migration accompanies this one. Entries the scanner wrote into
`aws_resources.compliance_issues` before frameworks had to be explicitly
enabled (HIPAA and SOC 2 entries with no `framework` key) are handled by the
application:

- **Read.** From the moment the release is live they are not findings: scores,
  at-risk counts, reports and exports all skip them
  (`isActiveComplianceFinding`).
- **Next scan.** The scan rewrites each scanned resource's `compliance_issues`
  from this scan's baseline findings plus the stored framework failures, which
  drops them. This happens whether or not this migration is applied.

A resource that is no longer scanned (soft-terminated, or in an organization
with no AWS connection) keeps its old entries in the column; the read rule
above still applies to them.

## Classification -- `202610161210_create_resource_health_evaluations.sql`

Placed here from the start: it creates two tables that the `postgres` role
must own (`resource_health_evaluation_runs`,
`resource_health_evaluation_results`), enables and forces row-level security
on them with one tenant policy each, and may add a unique constraint to
`aws_resources` (`postgres`-owned). `devcontrol` receives `SELECT`, `INSERT`,
`UPDATE` and `DELETE` on both, and not `TRUNCATE`, which row-level security
does not apply to. Schema only: nothing reads or writes these tables yet.

It is a plain create: it refuses to run if either table already exists.

**`aws_resources (id, organization_id)` uniqueness.** Same rule as
`202610112300_create_framework_evaluation_persistence.sql` above: the
migration reuses any unique constraint over exactly `(id, organization_id)`,
whatever its name, and adds its own (`aws_resources_id_org_unique`) only when
there is none. `202610112300` sorts first everywhere and is applied in
production, so on every database this migration reuses
`aws_resources_compliance_evaluation_ref_key` and adds nothing. (The comments
in `202610112300` still describe this migration's earlier, pending form,
which added `aws_resources_id_org_unique` unconditionally; that file is
applied and is not edited.)

**Stored evidence.** A result row is read as written, never re-derived from
rows that may have changed since: `health_state` (`checks_passing`,
`check_failing`, `no_signal`), `reason_code` (set exactly when `no_signal`),
`lifecycle_state` (`aws_resources.status` at evaluation time),
`telemetry_observed_at`, `evidence_basis` and `evidence`. Runs record `source`
and `evaluator_version`, and their `evaluated_at` (the metric window's end,
taken during the run) must lie within `[started_at, finished_at]`.

- **Codes and free-form columns.** `source`, `evaluator_version`,
  `check_name`, `reason_code` and `lifecycle_state` are checked against a
  format, and `status`, `outcome`, `evaluator_status`, `health_state`,
  `failure_code`, `evaluation_range` and `evidence_basis` against allowlists.
  `resource_type` has a format CHECK only (lowercase type names such as `ec2`
  or `load-balancer`), not a list of types. Two columns are free-form JSONB:
  `evidence`, which must be an object with a `schema_version` key and at most
  4096 bytes as text, and `resource_health_evaluation_runs.type_outcomes`,
  which is unchecked. Wording is rendered by the application; no column is
  meant to hold an exception message, an ARN or an AWS response.
- **`evidence_basis` allowlist.** `aws_status_check`, `cloudwatch_metric`
  and `control_plane` are the evaluator's check kinds (`HealthCheckKind` and
  `SUPPORTED_CHECKS` in `backend/src/services/resource-health.ts`);
  `lifecycle_state` is a `down` row decided by the recorded lifecycle state
  (`FAILED_LIFECYCLE_STATES`); `none` is no evidence, as in `202610112300`'s
  evidence contract. `tag` is not allowed: that contract does not count a tag
  as evidence, and the health evaluator never reads tags.
- **Conclusive states.** `checks_passing` and `check_failing` need a basis
  other than `none`, non-NULL `evidence` and a recorded `lifecycle_state`.
  Passing needs an evaluated, monitored resource whose check reported
  `healthy`; failing needs an evaluated resource whose check reported
  `degraded`, `critical` or `down`.

### Showing stored resource health

Health is shown only from a stored, finished evaluation. The staleness rule is
`RESOURCE_HEALTH_MAX_AGE_MS` in `backend/src/services/resource-health.ts`
(15 minutes), measured from the run's `evaluated_at`.

- **Which run.** The latest run with `status` `complete` or `partial`
  (`resource_health_evaluation_runs_org_finished`). A `running` run is never
  read; until it finishes, the previous finished run is used, subject to the
  staleness rule.
- **Per-resource reads join to the run.** A result is read only together
  with its run (`run_id`), and only when that run is `complete` or
  `partial`. A query on `resource_health_evaluation_results` alone (for
  example through `resource_health_evaluation_results_org_resource_time`)
  can return a row whose run is not the one being shown, so it must join
  `resource_health_evaluation_runs` and filter on `status`. Staleness uses the
  run's `evaluated_at`, not the copy on the result row.
- **Stale.** If that run's `evaluated_at` is older than the limit, every
  resource is shown as **Stale** (`no_signal`), never with its stored state.
- **Failed run.** A `failed` run (including `failure_code = 'abandoned'`, a
  `running` run that outlived its time limit) has no results to show. It does
  not replace the previous finished run, which is still subject to the
  staleness rule; with none usable, resources are **Not evaluated**.
- **Partial run.** Resources with an `evaluated` result show their stored
  `health_state`. Resources with an `evaluation_failed` result are **Not
  evaluated**.
- **No row.** A resource with no result in the run (added after the run, or
  outside its inventory) is **Not evaluated**. A resource whose type has no
  check is `not_supported` and is never stored.
- **Never Healthy by default.** Only a stored `checks_passing` result from a
  non-stale run is shown as passing. A service or summary that is passing says
  how many of its resources were evaluated (the run's `inventory_count`,
  `evaluated_count`, `failed_count`); a passing evaluation never implies that
  every resource is healthy.

### Rollback

`202610161210_create_resource_health_evaluations_rollback.sql` ships in the
admin artifact with the other `*.sql` files, but `migrate.js` never executes
it: `getMigrationFiles()` excludes every file whose name contains `rollback`,
so neither a sweep nor `--execute-only` can select it, and
`ci-bootstrap-schema.js` skips it the same way. Running it is a separate,
manually authorized operation, as the `postgres` role, in one transaction:

```bash
psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
  -f 202610161210_create_resource_health_evaluations_rollback.sql
```

It drops the two tables and this migration's `schema_migrations` row. It
drops `aws_resources_id_org_unique` only if this migration added it and no
foreign key uses it; a reused constraint
(`aws_resources_compliance_evaluation_ref_key` in production) is never
dropped. It never cascades: it refuses if anything else references the two
tables. Roll back the application release that uses these tables first.
