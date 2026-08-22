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

Currently: **`202608221231_enable_rls_on_anomaly_rules.sql`** only.

A migration belongs here if and only if it requires ownership-level DDL
that `devcontrol` cannot perform under its normal grants — enabling RLS on
a table it doesn't own, creating a policy, or replacing a function it
doesn't own. Anything `devcontrol` can already do with its existing
SELECT/INSERT/UPDATE/DELETE-plus-DDL-it-owns privileges belongs in the
ordinary `database/migrations/` directory instead.

Classification is structural, not a naming convention or a maintained
exclusion list: a migration is administrative *because* it lives in this
directory, and nothing here is ever scanned by
`database/migrate.js`'s ordinary `MIGRATIONS_DIR` resolution (which is
always `database/migrations/`, hardcoded relative to wherever `migrate.js`
itself is deployed) or by `.github/scripts/ci-bootstrap-schema.js`'s
`SOURCE_DIR` (same directory). There is no list to remember to update —
a migration simply cannot be swept up by the normal path unless it's
physically moved there.

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
