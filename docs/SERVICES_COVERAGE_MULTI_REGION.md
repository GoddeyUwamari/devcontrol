# Services coverage: the `multi_region` key (multi-region PR 2)

`GET /api/services/coverage` describes what DevControl's discovery scans have checked in the connected AWS account. Multi-region PR 2 adds one key, `coverage.multi_region`, so the Services page (PR 3) can render region coverage **without working out any state itself**. This document is the contract for that key.

Every example below is a real response. `backend/src/routes/__tests__/services-coverage.multi-region.examples.test.ts` builds each scenario in Postgres, calls the route, and compares its `multi_region` with the block here. Only the job id is replaced by a placeholder. All identifiers are placeholders.

## 1. Purpose and scope

- **Database only.** The route makes no AWS call (tested), and a GET writes nothing (tested; the auth middleware's own `api_usage` meter is the only write, as on every route).
- **Present only for a flagged organization.** `multi_region` appears only when `organization_feature_flags.multi_region_discovery` is on.
  - Without the flag, the response is byte-identical to the one before PR 2 (contract snapshot `services-coverage.multi-region-flag-off.contract.test.ts`).
  - A flag that cannot be read counts as off.
- **Additive.** No other key of `coverage` changes, for any organization. For example, `region_status[].last_error_code` keeps its two-code allow-list.

## 2. Auth and tenancy

- **Auth.** The route is `authenticate` + `requireCurrentMembership`, so every member role can read it, viewers included.
- **Tenancy.**
  - The organization comes from the authenticated request (`req.user.organizationId`). Nothing in the query string selects a tenant.
  - Every statement carries an explicit organization predicate. Row-level security is a second layer, and it holds on its own (tested as the non-superuser `devcontrol` role, with every predicate stripped).
  - `scan.id` is the organization's own discovery job id (`POST /api/services/discover` already returns it as `jobId`).

## 3. Shape

```text
multi_region: {
  scan: { id, status, started_at, completed_at, regions_total, regions_checked } | null
  coverage_status: 'in_progress' | 'all_checked' | 'completed_with_regions_not_checked' | 'latest_scan_failed' | 'unavailable'
  home_region: string | null
  savings_regions: string[]                       // the home region only
  not_enabled_regions: string[]                   // opt-in regions the account has not enabled
  regions: Region[]                               // the enabled regions of the latest list, home first, then by name
  regions_checked: { enabled, complete, partial, not_checked, not_reached, never_scanned, by_state }
  progress: { scan_started_at, regions_total, regions_done, regions_running, regions_waiting } | null
  region_warnings: { code, region }[]
  region_warnings_complete: boolean
}

Region: {
  region, home, opt_in,
  status, error_code,                             // the last recorded result (detail)
  last_scan_finished_at, last_success_at, stale,
  result_of: 'running_scan' | 'latest_scan' | 'earlier_scan' | null,
  scan_state: 'done' | 'running' | 'waiting' | 'excluded' | null,
  state,                                          // ONE field: read this
  resources: number | null, resources_from: 'last_result' | 'earlier_success' | null, empty: boolean
}
```

## 4. Scan selection

**`scan` is the scan this response describes.**
- While a discovery scan runs, it is that scan.
  - A scan runs when the account's discovery lease is held **and** names a running or pending job. This is the same rule as the existing `scan_in_progress`.
- Otherwise it is the organization's newest job, whatever its status.
- It is `null` when no job exists.

**Each region shows its own last recorded result. `result_of` says which scan wrote it:**

| `result_of` | Meaning |
|---|---|
| `running_scan` | written by the scan running now (the region is done in it) |
| `latest_scan` | no scan running; written by the newest scan (`scan`) |
| `earlier_scan` | written by an older scan, e.g. a region the newest scan never reached, or one still running or waiting |
| `null` | never scanned |

A region counts as done in a scan when its status write carries that job's `started_at` (`last_scan_started_at = job.started_at`; the scanner writes the job's `started_at`).

## 5. Region state (read `state`, never combine the other fields)

| `state` | When | `status` / `error_code` |
|---|---|---|
| `not_started` | waiting in the running scan, or never scanned | any / any; `never_scanned` |
| `in_progress` | running in the running scan | its earlier result |
| `checked` | last result ok, no warning code | `ok` / null |
| `checked_with_warnings` | ok with a Resource Explorer warning, or partial | `ok` / `resource_explorer_no_index`, `resource_explorer_no_view`; `partial` / `discovery_listing_truncated`, `deletion_detection_paused_truncated_index` |
| `failed` | the check did not complete | `failed` / `error`; `timed_out` / `throttled`, `call_timeout` |
| `not_checked_budget` | never started: the scan budget ran out | `timed_out` / `scan_budget` |
| `not_checked_deadline` | started, ran past its deadline | `timed_out` / `region_deadline` |
| `denied` | refused | `denied` / `access_denied`, `access_denied_scp` |
| `not_ready` | enabled but not usable yet | `failed` / `region_not_ready` |
| `excluded` | kept out of scans by the account's allow-list (`scan_enabled = false`; nothing writes this today) | any |

`error_code` is one of the codes above, or null. A stored value that is not on the list is null, and the stored message never leaves the database. A not-enabled region is never in `regions`; it is in `not_enabled_regions`.

## 6. Resources and "empty"

**`resources` is a count only when a successful check backs it** (founder decision H-1). Otherwise it is `null`, never 0.

| Case | `resources` | `resources_from` |
|---|---|---|
| last result `ok` or `partial` (and not running or waiting) | the region's rows now | `last_result` |
| last result failed, denied, not ready, timed out or scan budget, with an earlier success (`last_success_at`) | the rows kept from that success | `earlier_success` |
| running or waiting in a scan, ever checked successfully | the rows stored **before** the scan began (never what the scan wrote so far) | `earlier_success` |
| anything else (never scanned, never successfully checked) | `null` | `null` |

**`empty` is true only for a successful check that found nothing:**
- the last result is `ok` with no warning code;
- the region is not running or waiting;
- `resources` is 0.

A partial result, a Resource Explorer warning, a failure, the scan budget, a running or waiting region, or a 0 kept from an earlier success is never empty.

The rows counted are the Services list's: this organization's, not terminated, any resource type stored at that region (S3 buckets at their own region included).

**Known limits for a region that is running or waiting** (small, transient; exact counts need a stored per-region count, the optional PR 4):
- a row the scan already terminated in it is not counted before its status write;
- a terminated row the scan found again is counted;
- an S3 bucket first stored by the running scan (S3 is listed before the regions) is excluded until that region is done.

## 7. Progress and the denominator

`progress` is `null` with no scan running. While one runs:
- `regions_total` is the regions **that scan covers**: the home region plus the enabled, allow-listed regions of the latest list. This is the scanner's own rule. It is never the result rows, never a hard-coded list, and never the regions with resources.
- `regions_done` counts regions with a terminal result written by that scan.
- `regions_running` counts regions the scan has started but not finished. The scanner appends each region it starts to the job's `regions` column.
- `regions_waiting` is the rest.

`scan.regions_total` is the same set. `scan.regions_checked` counts only regions with a `checked` / `checked_with_warnings` result written **by that scan**. So "N of M checked" for a scan is `scan.regions_checked` of `scan.regions_total`, and an older scan's results never make it look complete.

`regions_checked` describes each enabled region's **last** result, which may come from different scans:
- `complete` (ok), `partial`;
- `not_checked` (denied, failed, not ready, deadline);
- `not_reached` (scan budget; never counted as failed);
- `never_scanned`;
- `by_state`: every state, including 0s.

`enabled` is the latest list's enabled count (null with no list).

## 8. Coverage status

| `coverage_status` | When |
|---|---|
| `in_progress` | a scan is running |
| `all_checked` | the newest scan completed, and every region it covers has a checked result from it |
| `completed_with_regions_not_checked` | the newest scan completed, but at least one region it covers has no checked result from it (failed, denied, not ready, deadline, scan budget, or no result written) |
| `latest_scan_failed` | the newest scan failed, or was abandoned (running or pending with no held lease). Regions it did not reach read `result_of: 'earlier_scan'`. |
| `unavailable` | no scan has run, or no region list is stored yet (no "N of M" can be stated) |

## 9. Not-enabled regions

`not_enabled_regions` lists the latest stored list's `enabled = false` regions (opt-in regions the account has not enabled), by name.
- They are never scanned and never in a denominator or count.
- A region missing from the latest list is reported nowhere.

## 10. Warnings and provenance

- **`region_warnings`** gives `{ code, region }` for the region-scoped warning codes: the Resource Explorer `no_index` / `no_view` codes and the truncation codes. Each comes from that region's own result: the scanner records a Resource Explorer warning on the region it came from (RR-M2), never on the home region.
- **Not region warnings:**
  - `scan_budget` is a state (`not_checked_budget`);
  - `scan_deadline` is a scan-level stop after the regions, reported in `last_scan.warnings` / `last_completed_scan.warnings` (it has no region).
- **`region_warnings_complete`** is false when any scanned region's last result is not `ok`. Such a region's one code column holds its own outcome, so a Resource Explorer warning in it cannot be named. The job's `warnings` still lists every code. Full provenance needs a second column (optional PR 4).

## 11. Home-only cost and global listings

- `savings_regions` is `[home]`: cost recommendations are checked in the home region only. There is no per-region cost.
- S3 is listed account-wide (each bucket counted in its own region); CloudFront is global (not a region of the list).
- **No region is assumed.**
  - `home_region` is the account's recorded region. Only when none is recorded is it `us-east-1`, the same rule the client factory uses to choose where the scan runs.
  - Nothing else in the coverage path names a region. The examples include a non-`us-east-1` home.

## 12. Staleness

`stale` is true when the region's result was written more than 13 hours ago (two scheduled scans plus the longest scan) by the database clock. A never-scanned region is never stale.

The examples use fixed past instants, so every region with a result reads `stale: true` in them.

## 13. Not for progress: `GET /api/aws-resources/discovery/jobs` (review L-3)

That legacy endpoint returns raw job rows. For a flagged organization, a running job's `regions` column holds `[]`, then the regions started so far, and the full list at the end. Use `multi_region.progress`; never read that column.

## 14. Examples

Scenario inputs are in the examples test. Job ids are shown as a placeholder.

### All regions checked
<!-- example: all_checked -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 3,
    "regions_checked": 3
  },
  "coverage_status": "all_checked",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "ap-south-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": "resource_explorer_no_index",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked_with_warnings",
      "resources": 1,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "eu-west-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 2,
      "resources_from": "last_result",
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 3,
    "complete": 3,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 2,
      "checked_with_warnings": 1,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [
    {
      "code": "resource_explorer_no_index",
      "region": "ap-south-1"
    }
  ],
  "region_warnings_complete": true
}
```

### A scan in progress (1 done, 1 running, 2 waiting; one never scanned)
<!-- example: in_progress -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "running",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": null,
    "regions_total": 4,
    "regions_checked": 1
  },
  "coverage_status": "in_progress",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "running_scan",
      "scan_state": "done",
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "ap-south-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T04:03:00.000Z",
      "last_success_at": "2026-11-15T04:03:00.000Z",
      "stale": true,
      "result_of": "earlier_scan",
      "scan_state": "waiting",
      "state": "not_started",
      "resources": 0,
      "resources_from": "earlier_success",
      "empty": false
    },
    {
      "region": "eu-west-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T04:03:00.000Z",
      "last_success_at": "2026-11-15T04:03:00.000Z",
      "stale": true,
      "result_of": "earlier_scan",
      "scan_state": "running",
      "state": "in_progress",
      "resources": 2,
      "resources_from": "earlier_success",
      "empty": false
    },
    {
      "region": "us-west-2",
      "home": false,
      "opt_in": false,
      "status": "never_scanned",
      "error_code": null,
      "last_scan_finished_at": null,
      "last_success_at": null,
      "stale": false,
      "result_of": null,
      "scan_state": "waiting",
      "state": "not_started",
      "resources": null,
      "resources_from": null,
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 4,
    "complete": 3,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 1,
    "by_state": {
      "not_started": 2,
      "in_progress": 1,
      "checked": 1,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": {
    "scan_started_at": "2026-11-15T10:00:00.000Z",
    "regions_total": 4,
    "regions_done": 1,
    "regions_running": 1,
    "regions_waiting": 2
  },
  "region_warnings": [],
  "region_warnings_complete": true
}
```

### Completed, scan budget ran out (2 regions not reached)
<!-- example: budget_incomplete -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 4,
    "regions_checked": 2
  },
  "coverage_status": "completed_with_regions_not_checked",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "ap-south-1",
      "home": false,
      "opt_in": false,
      "status": "timed_out",
      "error_code": "scan_budget",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": null,
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "not_checked_budget",
      "resources": null,
      "resources_from": null,
      "empty": false
    },
    {
      "region": "eu-west-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 1,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "us-west-2",
      "home": false,
      "opt_in": false,
      "status": "timed_out",
      "error_code": "scan_budget",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": null,
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "not_checked_budget",
      "resources": null,
      "resources_from": null,
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 4,
    "complete": 2,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 2,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 2,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 2,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [],
  "region_warnings_complete": false
}
```

### Completed with regional failures (SCP denial, denial with an earlier success, not ready)
<!-- example: regional_failure -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 4,
    "regions_checked": 1
  },
  "coverage_status": "completed_with_regions_not_checked",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "ap-south-1",
      "home": false,
      "opt_in": false,
      "status": "denied",
      "error_code": "access_denied",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-14T04:00:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "denied",
      "resources": 3,
      "resources_from": "earlier_success",
      "empty": false
    },
    {
      "region": "eu-west-1",
      "home": false,
      "opt_in": false,
      "status": "denied",
      "error_code": "access_denied_scp",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": null,
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "denied",
      "resources": null,
      "resources_from": null,
      "empty": false
    },
    {
      "region": "me-central-1",
      "home": false,
      "opt_in": true,
      "status": "failed",
      "error_code": "region_not_ready",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": null,
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "not_ready",
      "resources": null,
      "resources_from": null,
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 4,
    "complete": 1,
    "partial": 0,
    "not_checked": 3,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 1,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 2,
      "not_ready": 1,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [],
  "region_warnings_complete": false
}
```

### Empty regions (ok and nothing found; partial with 0 is not empty)
<!-- example: empty_regions -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 3,
    "regions_checked": 3
  },
  "coverage_status": "all_checked",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "ap-south-1",
      "home": false,
      "opt_in": false,
      "status": "partial",
      "error_code": "discovery_listing_truncated",
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": null,
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked_with_warnings",
      "resources": 0,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "eu-west-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 0,
      "resources_from": "last_result",
      "empty": true
    }
  ],
  "regions_checked": {
    "enabled": 3,
    "complete": 2,
    "partial": 1,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 2,
      "checked_with_warnings": 1,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [
    {
      "code": "discovery_listing_truncated",
      "region": "ap-south-1"
    }
  ],
  "region_warnings_complete": false
}
```

### Not-enabled opt-in regions (and one enabled opt-in region)
<!-- example: not_enabled -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 2,
    "regions_checked": 2
  },
  "coverage_status": "all_checked",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [
    "af-south-1",
    "ap-east-1",
    "me-south-1"
  ],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "me-central-1",
      "home": false,
      "opt_in": true,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 1,
      "resources_from": "last_result",
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 2,
    "complete": 2,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 2,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [],
  "region_warnings_complete": true
}
```

### The latest scan failed after the home region
<!-- example: latest_scan_failed -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "failed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:21:00.000Z",
    "regions_total": 2,
    "regions_checked": 1
  },
  "coverage_status": "latest_scan_failed",
  "home_region": "us-east-1",
  "savings_regions": [
    "us-east-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "us-east-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 4,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "eu-west-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T04:03:00.000Z",
      "last_success_at": "2026-11-15T04:03:00.000Z",
      "stale": true,
      "result_of": "earlier_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 2,
      "resources_from": "last_result",
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 2,
    "complete": 2,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 2,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [],
  "region_warnings_complete": true
}
```

### Home region eu-central-1 (us-east-1 is just another region)
<!-- example: home_not_us_east_1 -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 2,
    "regions_checked": 2
  },
  "coverage_status": "all_checked",
  "home_region": "eu-central-1",
  "savings_regions": [
    "eu-central-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "eu-central-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 5,
      "resources_from": "last_result",
      "empty": false
    },
    {
      "region": "us-east-1",
      "home": false,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 0,
      "resources_from": "last_result",
      "empty": true
    }
  ],
  "regions_checked": {
    "enabled": 2,
    "complete": 2,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 2,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [],
  "region_warnings_complete": true
}
```

### An account with one enabled region ("1 of 1")
<!-- example: single_region -->
```json
{
  "scan": {
    "id": "00000000-0000-4000-8000-00000000a001",
    "status": "completed",
    "started_at": "2026-11-15T10:00:00.000Z",
    "completed_at": "2026-11-15T10:20:00.000Z",
    "regions_total": 1,
    "regions_checked": 1
  },
  "coverage_status": "all_checked",
  "home_region": "eu-west-1",
  "savings_regions": [
    "eu-west-1"
  ],
  "not_enabled_regions": [],
  "regions": [
    {
      "region": "eu-west-1",
      "home": true,
      "opt_in": false,
      "status": "ok",
      "error_code": null,
      "last_scan_finished_at": "2026-11-15T10:03:00.000Z",
      "last_success_at": "2026-11-15T10:03:00.000Z",
      "stale": true,
      "result_of": "latest_scan",
      "scan_state": null,
      "state": "checked",
      "resources": 3,
      "resources_from": "last_result",
      "empty": false
    }
  ],
  "regions_checked": {
    "enabled": 1,
    "complete": 1,
    "partial": 0,
    "not_checked": 0,
    "not_reached": 0,
    "never_scanned": 0,
    "by_state": {
      "not_started": 0,
      "in_progress": 0,
      "checked": 1,
      "checked_with_warnings": 0,
      "failed": 0,
      "not_checked_budget": 0,
      "not_checked_deadline": 0,
      "denied": 0,
      "not_ready": 0,
      "excluded": 0
    }
  },
  "progress": null,
  "region_warnings": [],
  "region_warnings_complete": true
}
```
