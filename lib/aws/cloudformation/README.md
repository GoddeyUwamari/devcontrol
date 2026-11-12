# DevControl CloudFormation templates

The Connect AWS page can offer a "Launch stack" link that opens the AWS
CloudFormation console with one of these templates. The link is shown only
when the backend's server switch and template configuration are set (AWS
connect PR D2). Until then the page offers the manual setup only.

## Files

| File | What it is |
|---|---|
| `devcontrol-role.v1.template.json` | Template v1: one IAM role with SecurityAudit, job-function/ViewOnlyAccess and the inline policy DevControlReadExtras (`../customer-role-inline-policy.json`), trusting DevControl's AWS account only with the organization's External ID |
| `published-templates.json` | Every published version: its file, the SHA-256 of that file, and the permission-contract version it implements |

The trust principal is the placeholder `{{PLATFORM_ACCOUNT_ID}}`. This
repository is public and holds no real AWS account ID. The hosted copy is
rendered from this file by `scripts/render-customer-role-template.js`.

## Rules

- **A published version never changes.** Its SHA-256 is pinned in
  `published-templates.json` and a test fails if the file differs.
- **A permission change is a new version.** Changing the inline policy, the
  managed policies or the trust policy bumps `CUSTOMER_ROLE_CONTRACT_VERSION`
  (`backend/src/services/connect-policy-compare.ts`). It also adds a new
  `devcontrol-role.v{n}.template.json` and a new entry here. The earlier file
  stays byte-identical.
- **Parity with the manual setup** is a static test
  (`backend/src/__tests__/customer-role-template.static.test.ts`). The current
  version's role must have exactly:
  - the trust policy the Connect page shows;
  - the two managed policies;
  - the inline policy JSON;
  - the role-name and External ID rules the backend enforces.
- **No real account IDs, External IDs, ARNs or bucket names** in this directory.

## Publishing a version (founder, by hand)

The steps below use placeholders: `<PLATFORM_ACCOUNT_ID>` for DevControl's
AWS account and `<TEMPLATE_BUCKET>` for the hosting bucket.

### Where to host it

Choose the AWS account before you start. Either option works.

- **A dedicated AWS account that holds nothing but this bucket (recommended).**
  Making one object public then can't affect anything else.
- **An existing AWS account.** First check the account-level S3 Block Public
  Access settings (S3 console → "Block Public Access settings for this
  account"). If they block public bucket policies, the template can't be made
  public without relaxing them for the whole account. Before relaxing anything:
  - check every other bucket in that account: none should show "Public" or
    "Objects can be public" in the S3 console's Access column;
  - turn off only the two *policy* settings, never the ACL settings.

Never use a bucket that holds anything else. The deploy-artifacts bucket is
one such bucket.

### Steps, in this order

1. **Create the bucket** in us-east-1:
   - ACLs disabled (bucket owner enforced);
   - in the bucket's Block Public Access, only the two *policy* settings turned off;
   - Versioning enabled;
   - SSE-S3 encryption;
   - Object Lock enabled, with no default retention;
   - **no lifecycle rules, ever.** A rule that expires current versions would
     put a delete marker over the template, and every Launch stack link would
     then fail.
2. **Render.** From a checkout of the commit that published the version, into
   a directory **outside** the checkout. The rendered file holds the real
   account ID, and the script refuses any path inside the repository:

   ```
   mkdir -p "$HOME/devcontrol-template"
   node scripts/render-customer-role-template.js --version 1 \
     --platform-account-id <PLATFORM_ACCOUNT_ID> \
     --out "$HOME/devcontrol-template/devcontrol-role.v1.json"
   ```

   It prints two lines:

   ```
   Source SHA-256 <source hash>  devcontrol-role.v1.template.json
   SHA-256 <output hash>  devcontrol-role.v1.json
   ```

   - **Source:** compare `<source hash>` with `sourceSha256` for version 1 in
     `lib/aws/cloudformation/published-templates.json` **on GitHub at the merge
     commit**, not just in your checkout. If they differ, stop.
   - **Output:** check `<output hash>` with
     `shasum -a 256 "$HOME/devcontrol-template/devcontrol-role.v1.json"`.
3. **Upload with no retention.**
   - Key: `cloudformation/devcontrol-role/v1/devcontrol-role.v1.json`.
   - Content-Type: `application/json`.
   - No Object Lock retention and no legal hold yet.
4. **Bucket policy, first edit:** only these two statements.
   - Public read of `cloudformation/devcontrol-role/*` (`s3:GetObject`, principal `*`).
   - A Deny on every request that isn't TLS (`aws:SecureTransport` false).

   No `s3:ListBucket` for anyone. The anonymous read in step 5 needs the public-read statement.
5. **Anonymous read-back.** In a private browser window or with `curl`, with no credentials:
   - `https://<TEMPLATE_BUCKET>.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json`:
     its SHA-256 **must equal** step 2's. If it doesn't, stop. Nothing is
     locked yet, so delete the object and redo step 3.
   - The bucket root and any key outside `cloudformation/devcontrol-role/`
     must answer AccessDenied.
6. **Set Compliance retention for 1 year** on the uploaded object version
   (Object Lock retention → Compliance, retain until one year after today).
   In Compliance mode nobody can overwrite or delete that version, or shorten
   the period. The period can be extended later.
   - **Extend the retain-until date before it passes.** Set a reminder well
     before that date. After it, only the bucket-policy Deny from step 7
     protects the version, and an administrator can remove that Deny.
7. **Bucket policy, second edit: the write-Deny, last.** Add a Deny for
   `s3:PutObject`, `s3:DeleteObject` and `s3:DeleteObjectVersion` on
   `cloudformation/devcontrol-role/v1/*` for principal `*`.
   - Object Lock protects the uploaded *version* only; a new upload to the same key would become the current version. This Deny is what keeps the key from changing.
   - It applies to you too.
   - Then repeat step 5's read-back once.

### Never public

- the bucket listing;
- any object outside `cloudformation/devcontrol-role/`;
- any write or delete;
- any other bucket;
- a presigned URL (it expires);
- credentials or configuration.

The hosted template does show DevControl's AWS account ID. Every customer's
trust policy shows it too.

## Turning the link on (backend configuration)

The backend reads these variables on every request:

| Variable | Value |
|---|---|
| `CONNECT_TEMPLATE_URL` | `https://<TEMPLATE_BUCKET>.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json` |
| `CONNECT_TEMPLATE_VERSION` | `1` |
| `CONNECT_LAUNCH_STACK_REGION` | optional; if set, exactly `us-east-1` (the only Region the link uses) |
| `CONNECT_LAUNCH_STACK_ENABLED` | `true`. **Set last**, after checking the startup line below |

At startup the API logs exactly one of these lines:

```
[connect] Launch stack: off
[connect] Launch stack: off (template v1 configured)
[connect] Launch stack: ready (template v1)
[connect] Launch stack: misconfigured (<variable names>)
```

| Line | Meaning |
|---|---|
| `off` | No template variables are set, and the switch is unset or `false` |
| `off (template v1 configured)` | The template variables are valid and the switch is unset or `false`. Expect this before you set the switch |
| `ready (template v1)` | The switch is `true` and everything is valid: the Connect AWS page shows Launch stack |
| `misconfigured (…)` | The named variables are missing or invalid. For example, a switch value other than `true`/`false`, a template URL not in us-east-1 or not ending in `/v1/devcontrol-role.v1.json`, or a Region other than `us-east-1`. The link stays off |

The line names variables, never their values. With the switch off, or any
value invalid, the Connect AWS page shows the manual setup only.
