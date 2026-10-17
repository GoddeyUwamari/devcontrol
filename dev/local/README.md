# Local stack and demo workspace

`npm run dev:local` runs DevControl on this machine against a throwaway
Postgres in Docker, with every external integration off. The repository
root `README.md` describes what it starts and what it refuses. This page covers
the demo workspace, resets and logins. Because the stack touches nothing real,
it doubles as a safe environment for demos.

## Two workspaces

| Login | Organization | What it shows |
|---|---|---|
| `owner@example.test` | Example Local Org | An empty organization (the first-run, nothing-connected view) |
| `founder@example.com` | Example SaaS Inc. | The demo: a Series A SaaS with about $31K/month of AWS and no DevOps team |

The demo workspace is invented from end to end: two placeholder AWS accounts
(`000000000001`, `000000000002`) in ARNs, about 330 resources in three
regions, 40 services in six teams, tags as messy as real ones (mixed case,
typos, missing team or service, shared infrastructure, owners who left),
cost recommendations and account security findings. Some services have no
owner and some resources belong to no service, on purpose.

## Seed, reset, log in

```bash
npm run dev:local -- --seed                  # set up, (re)write the demo, start the app
npm run dev:local -- --setup-only --seed     # the same, without starting the servers
npm run dev:local -- --reset --seed          # start from a new, empty database first
```

- Seeding replaces the whole demo organization each time. Anything changed in
  it while clicking around is gone. The same day gives the same data.
- Logins are in git-ignored files. Open them and never paste them anywhere:
  - demo: `dev/local/.state/db/demo-login.txt`
  - empty org: `dev/local/.state/db/owner-login.txt`

  A password stays the same on every reseed of the same database, and is
  replaced when the database is.
- `--reset` deletes the database volume and everything in
  `dev/local/.state/db/`, so both logins get new passwords.
- Then open http://localhost:3010 and sign in.

## What the demo looks like

- **A "Connect AWS to get started" prompt** appears on the dashboard. This is
  expected: AWS is disabled locally, so the demo organization has no AWS
  connection. Dismiss it with "I'll Do This Later". The prompt is real product
  behaviour for an organization without a connection.
- **Live AWS data is absent.** Cost Explorer trends and CloudWatch metrics come
  only from AWS. The demo shows the inventory-based estimates and
  recommendations that are stored in the database.
- **Compliance frameworks** need the enterprise tier. The demo is on pro, so
  those sections show as not established.

## One worktree at a time

Every checkout uses the same compose project (`devcontrol-local`), so all
worktrees share **one** Postgres container, port and volume. Run `dev:local`
from one worktree at a time. Starting it from another worktree takes the
database over: that worktree's `.state/db/` gets new passwords and logins (the
"adopt" step below), and the first worktree adopts it back on its next run.

## How the database password stays in step

Postgres sets the superuser password only when a volume is first created, so a
password kept only in `.state/` breaks when the two part ways (for example,
`.state/` deleted while the volume is kept). Each run therefore:

1. checks for the volume. If there is none, it starts a new `.state/db/`
   (**fresh**);
2. compares a random marker stored in the database comment with
   `.state/db/volume.json`. If they match, it keeps `.state/db/` (**reuse**);
   otherwise it replaces `.state/db/` and re-stamps the volume (**adopt**);
3. sets the superuser password from `.state/db/` through the container's own
   Unix socket (trusted inside the container; the published port still needs
   the password).

## Safety of the seed

`dev/local/seed-icp.js` refuses, naming the check but never a value, unless:

1. `DEVCONTROL_LOCAL_STACK=1` is set in its own process environment;
2. the backend's environment passes the local-stack guard (no production
   `NODE_ENV`, loopback database, no Stripe, SMTP, Anthropic, Resend, Slack or
   AWS credential);
3. it connects to exactly `127.0.0.1:55432`, database `devcontrol_local`;
4. the server reports `devcontrol_local` as the current database;
5. the database carries this checkout's volume marker;
6. no organization exists beyond `default`, `example-local-org` and
   `example-saas`.

Only after all six does it delete and rewrite the demo organization, in one
transaction.
