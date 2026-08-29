# Migration Management

This document explains how database migrations work in this repository, and —
critically — what the historical record does and does not establish. Read the
**Historical provenance** section before assuming anything about how the
current production schema came to exist.

## Historical provenance

> The schema effect associated with a migration may be strongly supported by
> direct content-level comparison while execution provenance remains
> unproven.

This repository underwent a formal forensic audit of its migration history
(August 2026) because production has no migration-tracking table at all. That
audit's findings, which this document treats as established fact:

- **No historical `schema_migrations` execution ledger survives** — not in
  production, not in any backup, not in any inspected historical artifact.
  This means there is no record proving *which* migrations executed, *when*,
  or *through which runner*, for the vast majority of this project's history.
- **Historical execution must not be reconstructed from current schema
  state.** A table, column, or index existing in production today proves that
  the schema effect exists. It does not prove which migration produced it, or
  that migration ran through any particular tool.
- **Migration filenames and numbers are not reliable historical identifiers
  in this repository.** `backend/migrations/` and `database/migrations/`
  coexist and reuse the same numbers (009–021+) for entirely different SQL
  content. Never infer identity, chronology, or execution from a filename or
  number alone — compare actual SQL content against actual production schema.
- **`backend/migrations/` is currently tracked** (15 files, clean in the
  current repository HEAD) **but no reference to it was found** in the known
  migration runners, CI/CD configuration, or package scripts. Its historical
  intent should not be inferred beyond what the forensic audit established —
  see "Specific audited artifacts" below for exactly what is and isn't known
  about it.

**Do not create historical migration records based solely on current schema
state.** If you're tempted to add rows to `schema_migrations` to "fill in" the
history implied by production's current shape — don't. That would fabricate a
historical record that never existed and could mislead anyone who later
relies on it as fact.

## Specific audited artifacts

Precise language matters here. None of the following are stated as "Migration
X was applied" — only what the evidence actually supports.

| Artifact | Status |
|---|---|
| `backend/migrations/014_create_compliance_scan_results.sql` | The schema effect associated with this migration exists in production and is strongly supported by exact content-level comparison (every column, type, default, constraint, and index name matches). Execution provenance is unproven. |
| `backend/migrations/019_add_external_id_and_region_to_aws_accounts.sql` | Same standard: schema effect (`aws_accounts.external_id`, `aws_accounts.region`) strongly supported by exact content-level comparison. Execution provenance unproven. |
| `backend/migrations/020_add_org_id_and_connect_sessions.sql` | Schema effect (`aws_accounts.org_id`, `aws_connect_sessions`) strongly supported by exact content-level comparison — including a distinctive artifact: production has *two* differently-named unique constraints on `aws_accounts.org_id`, exactly reproducing this migration's own guarded-constraint logic. Strong circumstantial evidence of schema-effect origin; still not proof of framework execution. |
| `backend/migrations/021_create_security_scores.sql` | Likely historical create → later drop lifecycle (the table no longer exists, dropped by `database/migrations/024_drop_security_scores.sql`). Lower confidence than 014/019/020 specifically because the object no longer exists for direct content comparison. |
| `backend/migrations/022_add_is_fallback_to_cost_optimization.sql` | Documented invalid/reverted historical migration. Its own Git revert commit states its target tables did not exist in production. Do not execute. |
| `database/migrations/019_add_anomaly_unique_constraint.sql` | The schema effect (`unique_active_anomaly` partial unique index, including its exact expression, predicate, and verbatim comment text) is directly verified live in production. This conclusion rests entirely on SQL/schema content, independent of the migration's number or filename. Execution through `database/migrate.js` specifically remains unproven. |
| `database/migrations/030_fix_tracking_trigger_uuid_type_mismatch.sql` | The one migration in this project's history with **direct execution evidence** — and it was applied out-of-band (`sudo -u postgres psql -f`), bypassing every known migration runner. Not recorded in any ledger. This is concrete proof that out-of-band execution is a real, demonstrated pathway in this project, not a hypothetical. |
| `database/migrations/026_api_keys_org_scoping.sql`, `database/migrations/027_webhook_endpoints_org_scoping.sql` | **Do not execute.** Their target tables (`api_keys`, `webhook_endpoints`) were not found in current production, the May-30 pre-deploy backup, or the August-11 production dump — every checkpoint this audit was able to inspect. Not every conceivable historical environment was ruled out, but no evidence supports these tables ever having existed. |

## Canonical migration directory and runner

- **Canonical directory (new migrations):** `database/migrations/`
- **Canonical runner:** `database/migrate.js`
- **Not canonical:** `scripts/run-migrations.js` is deprecated — see the notice
  at the top of that file. It has no tracking ledger and should not be used.
- **Not canonical:** `backend/migrations/` is not scanned by any current
  runner. It remains in the repository as-is; see "Historical provenance"
  above. Do not merge it into `database/migrations/`, rename its files, or
  delete it without a separate, explicit decision.
- **Related, deliberately separate:** `database/migrations-admin/` holds
  migrations requiring ownership-level DDL that the application's
  `devcontrol` role cannot perform in **production** (e.g. `ENABLE ROW
  LEVEL SECURITY` on a `postgres`-owned table). It is never scanned by
  `database/migrate.js`'s ordinary `MIGRATIONS_DIR` resolution, so it can
  never be swept into a production `--pending` run. It **is** scanned by
  `.github/scripts/ci-bootstrap-schema.js` (with specific exclusions),
  since CI's ephemeral database has no ownership split to protect in the
  first place — see `database/migrations-admin/README.md`'s "CI ephemeral
  schema inclusion" section for the full mechanism and why that doesn't
  imply production authorization.
  `022_cost_recommendations_org_scoping.sql`,
  `028_alert_history_org_scoping.sql`, and eleven further migrations
  (`004_add_multi_tenancy.sql`, `005_migrate_existing_data.sql`,
  `006_create_service_dependencies.sql`, `008_create_aws_resources.sql`,
  `009_create_onboarding_progress.sql`, `010_create_analytics_events.sql`,
  `011_add_cost_attribution_to_aws_resources.sql`,
  `020_wire_compliance_and_orphaned_scanning.sql`,
  `021_wire_cost_recommendations_scanning.sql`,
  `023_create_account_security_findings.sql`,
  `029_add_resource_reconciliation.sql`) were moved there after their
  target tables were directly verified as `postgres`-owned — the same
  ownership mismatch as above, based on verified table ownership rather
  than on any migration merely containing RLS/policy keywords (one of the
  eleven, `005_migrate_existing_data.sql`, contains no RLS/policy syntax
  at all). See `database/migrations-admin/README.md` for the supporting
  evidence. `016_create_ai_generated_reports.sql` was a mixed-target file
  (a new, self-owned table plus an `ALTER TABLE` on the `postgres`-owned
  `scheduled_reports`) and has since been retired and split: the
  `generated_reports` table, its indexes, and its comments continue
  unchanged as `202608272013_create_generated_reports.sql` in this
  directory; the `scheduled_reports` constraint change moved to
  `database/migrations-admin/202608272014_extend_scheduled_reports_ai_types.sql`
  — see that file and `database/migrations-admin/README.md` for the
  supporting evidence and the disposition of the retired original.
  `026`/`027` (target tables not found in production — see "Specific
  audited artifacts" above) remain deliberately unmoved; that move is not
  addressed by this classification pass.

## Baseline

`database/migrate.js` maintains a dedicated `migration_tracking_baseline`
table — **not** a fake row in `schema_migrations`. A baseline record means:

> Migration tracking begins at this point. Historical execution provenance
> before the baseline was not reconstructed.

It never means "migration 001 ran" or "all prior migrations executed." It's
established once, explicitly:

```bash
node database/migrate.js --init-baseline "production schema as of <date>; historical migration provenance not reconstructed, see database/migrations/README.md"
```

The runner refuses to create a second baseline if one already exists. A fresh
or empty database can run migrations without a baseline at all — the warning
the runner prints in that case is informational, not an error; a baseline
only matters for a database whose pre-existing schema has ambiguous
provenance (i.e. production, right now).

**Establishing a production baseline has not been done as part of this
change.** It is a separate, explicitly gated operation requiring its own
review — see the note at the bottom of this document.

## How the runner works

- Scans `database/migrations/*.sql`, excluding files with `GUIDE` or
  `rollback` in the name, in alphabetical order.
- For each file, computes a SHA-256 checksum of its current content.
- A file with no `schema_migrations` row is **pending** and will be executed.
- A file with a row whose stored checksum matches the current file is
  **already applied** and is skipped.
- A file with a row whose stored checksum does **not** match the current file
  is a **checksum mismatch** — the runner refuses to proceed at all (not just
  for that file) until this is resolved by a human. This means: never edit an
  already-applied migration file. Write a new migration instead.
- Each migration runs inside `BEGIN`/`COMMIT`. A failure triggers `ROLLBACK`
  and the migration is never recorded as applied.
- A Postgres advisory lock is held for the duration of migration execution,
  so two concurrent invocations of the runner can't race on the same
  pending migration.

### Commands

```bash
node database/migrate.js                          # run all pending migrations
node database/migrate.js --dry-run                # list pending migrations, execute nothing
node database/migrate.js --pending                 # same as --dry-run
node database/migrate.js --init-baseline "<note>" [--repository-ref <ref>]
                                                    # establish the baseline (one-time)
node database/migrate.js --execute-only <name> [--dry-run]
                                                    # execute exactly one named, currently-pending
                                                    # migration, leaving every other pending
                                                    # migration untouched
```

`--repository-ref` is optional and purely operator-supplied (e.g. a deployed
git SHA read from `.deployed_sha` — see "Production deployment" below). It
is never inferred or guessed by the script itself, and has no effect unless
combined with `--init-baseline`.

### `--execute-only` — targeted execution of one migration

**What problem this solves:** a database with a baseline but an empty
`schema_migrations` (production's actual current state) has every
pre-baseline migration file classified as `pending`, because "pending"
means "no ledger row," regardless of whether the migration's effect is
already known to be reflected in the live schema. Plain `node database/migrate.js`
would attempt to re-execute all of them. `--execute-only <name>` lets an
operator apply exactly one genuinely new migration without triggering that
full sweep — the rest of the pending set is reported, explicitly, as
untouched.

**What this flag does NOT do, and never will:** it does not determine,
verify, or attest to whether the named migration predates or postdates the
baseline. `database/migrate.js` never invokes `git` and never will — the
deployed migration-tooling artifact on the production host has no `.git`
directory at all, so any such check would silently behave differently
depending on environment, which would be a misleading safety guarantee
worse than no guarantee at all.

**Mandatory operator precondition, performed BEFORE invoking this flag,
from a repository-aware environment (a developer checkout, not the
production host):**

```bash
git show <migration_tracking_baseline.repository_ref>:database/migrations/
```

Confirm the target migration's file did **not** exist at that commit. This
is what actually establishes "post-baseline" — the tool cannot establish it
for you, and every invocation prints a warning saying exactly that:

> Pending status does not prove historical non-execution. Post-baseline
> status is not verified by this tool and must be independently confirmed
> by the operator before invocation.

**What the tool does check, automatically, before executing anything:**
the target file exists in `database/migrations/`; it is currently
classified as `pending` (not already applied, not checksum-mismatched); no
*other* migration anywhere in the ledger has a checksum mismatch (the
existing global fail-closed rule — unchanged, unweakened). The same
advisory lock, the same per-migration `BEGIN`/`COMMIT`/`ROLLBACK`
transaction, and the same `schema_migrations` insert shape as normal-mode
execution are used — a row this creates means exactly what a row created
by the full sweep means: *the runner executed this migration during this
invocation.* Nothing more, nothing retroactive.

**Do not use this to reconstruct historical execution.** `--execute-only`
is for a migration you already know is genuinely new and post-baseline —
never as a convenient way to hand-run `001`–`030` one at a time to make an
empty ledger look populated. That would manufacture execution history and
sidestep the real, still-unresolved provenance question this project has
deliberately left open rather than paper over. See "Historical provenance"
above for why.

## Production deployment

`database/migrate.js` and `database/migrations/` are deployed to production
as their own artifact, entirely separate from the backend application
deploy — see the `deploy-migration-tooling` job in
`.github/workflows/ci.yml`. **This deployment only makes the tooling and
migration files available on the host. It never executes
`node database/migrate.js` in any mode — not even `--dry-run` — and never
touches `schema_migrations` or `migration_tracking_baseline`.** Running the
tool, establishing the baseline, and executing migrations all remain
separate, manually-approved operations performed later by a human.

**Where files land:** each deploy is packaged as `tar czf migrations.tar.gz
-C database .` (so the tarball root is the *contents* of `database/`, not
`database/` itself — same convention the backend deploy uses for
`backend/dist/`), uploaded to
`s3://devcontrol-deploy-artifacts/database/<git-sha>/migrations.tar.gz`,
then extracted on the production host into a versioned, immutable release
directory:

```
/home/ubuntu/devcontrol/database-releases/<git-sha>/
├── migrate.js
└── migrations/
    ├── *.sql
    └── README.md (this file)
```

`/home/ubuntu/devcontrol/database` is a symlink, managed by
`.github/scripts/deploy-migration-symlink.sh` after extraction succeeds — a
failed extraction is cleaned up and aborts before that script ever runs, so
the live path never shows a partially-deployed directory. That script does
**not** blindly repoint the symlink (it contains no `ln -sfn`); it only ever
runs a plain `ln -s` when the destination doesn't exist yet (Case A), and is
a no-op when the destination is already a symlink pointing at the target
release (Case B, idempotent). Every other state it finds — a symlink
pointing somewhere else (Case B2), an existing real directory (Case C), or
any other unexpected object (Case D) — is a hard refusal: exit 1, the
destination left completely untouched, requiring a human to remediate
before the next deploy can proceed. This mirrors the atomicity the backend
deploy achieves differently (extract-in-place + smoke test + rollback); the
symlink script is simpler here because migration tooling deployment has no
running process to restart or smoke-test, but "simpler" does not mean
"unconditional" — it deliberately refuses rather than replaces whenever the
destination state is anything other than absent or already-correct.

**Deployed-SHA marker:** `/home/ubuntu/devcontrol/database-releases/<git-sha>/.deployed_sha`
is written *inside* the release directory, before the symlink swap, so it
becomes visible at `/home/ubuntu/devcontrol/database/.deployed_sha`
atomically together with the rest of that release's content — never a
window where the marker and the files it describes disagree. This is the
production-side equivalent of the backend's own
`/home/ubuntu/devcontrol/backend/.deployed_sha`; the two are independent
files that happen to be written with the same Git SHA for a given push,
not a single shared file.

**Dependency resolution:** `database/migrate.js` needs the `pg` package,
but only `backend/`'s dependencies are installed on the production host
(`/home/ubuntu/devcontrol/backend/node_modules`) — the migration tooling
deploy deliberately does not install or ship a second `node_modules` tree.
Node's default module resolution only walks up from a script's own
directory, so a bare `node database/migrate.js` run from
`/home/ubuntu/devcontrol` would not find `backend/node_modules` (a
sibling, not an ancestor, of `database/`). The chosen mechanism is
`NODE_PATH`, pointed directly at `backend/node_modules`:

```bash
cd /home/ubuntu/devcontrol
NODE_PATH=/home/ubuntu/devcontrol/backend/node_modules \
node database/migrate.js --dry-run
```

**Operator commands**, once tooling is deployed (read-only, safe to run
anytime; require an authenticated session on the production host — never
run by CI):

```bash
cd /home/ubuntu/devcontrol
NODE_PATH=/home/ubuntu/devcontrol/backend/node_modules node database/migrate.js --dry-run
NODE_PATH=/home/ubuntu/devcontrol/backend/node_modules node database/migrate.js --pending
```

And, only as a separate, explicitly-approved step — **not part of any
deployment**:

```bash
cd /home/ubuntu/devcontrol
NODE_PATH=/home/ubuntu/devcontrol/backend/node_modules node database/migrate.js \
  --init-baseline "production schema as of <date>; historical migration provenance not reconstructed, see database/migrations/README.md" \
  --repository-ref "$(cat database/.deployed_sha)"
```

And, for a single genuinely-new migration — only after the git-history
precondition above has been performed, and only as its own explicitly-
approved step, never part of any deployment:

```bash
cd /home/ubuntu/devcontrol
NODE_PATH=/home/ubuntu/devcontrol/backend/node_modules node database/migrate.js --dry-run --execute-only <name>
# review the preview output, then:
NODE_PATH=/home/ubuntu/devcontrol/backend/node_modules node database/migrate.js --execute-only <name>
```

## Naming convention for new migrations

New migrations use:

```
YYYYMMDDHHMM_description.sql
```

e.g. `202608201430_add_widget_settings.sql`. This project's history has
directly demonstrated that small reused integers (`019`, `020`, `021`, ...)
are not safe once more than one migration effort or directory can exist —
a timestamp-based name can't collide the same way. **Do not renumber or
rename any existing migration file** to fit this convention; it applies to
new migrations only.

## Testing

`database/migrate.js` exports its internals (`runMigrations`,
`getPendingMigrations`, `getBaseline`, `initBaseline`, `computeChecksum`,
etc.) for testing. Tests inject a disposable `migrationsDir` (a temp
directory of fixture `.sql` files) and a real Postgres connection scoped to
an isolated schema — never mocks, and never the real
`database/migrations/` directory or a shared table. See
`backend/src/services/__tests__/migrate-runner.test.ts`.

## What developers must never do

- Never insert, delete, or edit `schema_migrations` rows by hand.
- Never edit an already-applied migration file — checksum protection exists
  specifically to catch this; create a new migration instead.
- Never mark a migration as applied because its schema effect appears to
  exist in production — that conflates schema-effect evidence with execution
  evidence, exactly the mistake this document exists to prevent.
- Never assume `backend/migrations/` and `database/migrations/` describe a
  single continuous history — they don't; they reuse numbers for different
  content.
- Never run `026_api_keys_org_scoping.sql` or `027_webhook_endpoints_org_scoping.sql`.

## When production schema and migration files disagree

Treat production as the source of truth for *what currently exists*, and the
migration files as a source of truth for *what future changes should look
like* — not as a guaranteed record of how production got to its current
state. If a discrepancy blocks a new migration, investigate via direct schema
comparison (as this project's forensic audit did) before assuming either side
is "correct." Do not silently patch a migration file to match production
without understanding why they diverged.

---

**A production baseline has not yet been established.** Doing so is a
separate, explicitly gated operation: it requires presenting the exact
`--init-baseline` command and its note text for review before running it
against production. This document does not authorize that step.
