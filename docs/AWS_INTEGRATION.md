# AWS Integration

How DevControl reads an organization's AWS account, and how to work with AWS-backed features in local development.

## The rule

**DevControl only ever reads an organization's AWS data with credentials from that organization's own connected IAM role.** This is the same in local development, test, staging and production.

- An organization connects one AWS account by creating an IAM role in it and giving DevControl the role's ARN.
- For every AWS operation on behalf of that organization, the backend assumes that role (`sts:AssumeRole`, with the organization's external ID) and builds its AWS clients with the temporary credentials it gets back.
- An organization that has not connected an account gets **`AWS_NOT_CONNECTED`**. No AWS client is created and no AWS call is made. There is no fallback to any other credentials and no mock data.

The backend's own AWS identity is used for one thing only: as the caller identity for `sts:AssumeRole`. It is never used to read cost, inventory, metrics or security data, in any environment.

## Connecting an AWS account

Only an organization **owner** can connect AWS. In the app, open **Connect AWS** (`/connect-aws`):

1. The page shows a trust policy containing DevControl's account and an external ID generated for your organization.
2. In your AWS account, create an IAM role with that trust policy and attach the `ReadOnlyAccess` managed policy, as the page instructs. **The role name must start with `DevControlRole`** (for example `DevControlRole` or `DevControlRole-Prod`) and the role must not use an IAM path, because DevControl's own identity is only allowed to assume roles matching `arn:aws:iam::*:role/DevControlRole*`.
3. Paste the role's ARN into the page. DevControl checks the role name, then verifies that it can assume the role before saving the connection. A role ARN with any other name, or with a path, is refused with a 422 and nothing is saved. Connections saved before this rule existed are not re-checked.
4. The first resource scan starts automatically. Cost Explorer data can take a day or two to become available from AWS.

> **Cutover warning:** existing connections are not re-checked by the app, but once the platform identity may only assume `role/DevControlRole*`, any stored `aws_accounts.role_arn` with a different role name or with an IAM path will fail to assume and the organization will see `AWS_NOT_CONNECTED`. Before removing the AWS keys from the production environment, operators must confirm that every stored `role_arn` matches the rule (no path, name starting with `DevControlRole`). Run the count query with the organization RLS context set, or as the database owner: a query run without either is silently filtered by RLS and can report zero non-matching rows when there are some.

You control the role: deleting it in AWS removes DevControl's access.

The endpoints behind this flow are `GET /api/aws/accounts/connect-init`, `POST /api/aws/accounts` and `GET /api/aws/accounts`.

## What an unconnected organization sees

Pages stay reachable and say that AWS is not connected; they do not show figures. On the API, AWS-backed operations report the organization as not connected rather than returning data:

- Discovery (`POST /api/services/discover`, `POST /api/aws-resources/discover`) does not scan anything. The scheduled discovery job records the attempt as failed for that organization and continues with the next one.
- Cost endpoints fall back to the inventory estimate where one is defined, or report that live cost data is unavailable. They never return another account's bill.

## Backend configuration

The backend needs its own AWS identity so that it can call `sts:AssumeRole`. Its STS clients are built **without explicit credentials**, so the AWS SDK's default credential provider chain supplies that identity:

- **Production (target):** the EC2 instance role, with no AWS keys set in the backend environment. Until the cutover is complete, production may still supply keys via the environment; the default chain uses them first.
- **Local development:** whatever the default chain finds first, for example `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `backend/.env` (never commit that file) or a local AWS profile. Environment keys are a local-development fallback only.

Because the chain reads environment keys before the instance role, an environment that still sets the keys keeps using them.

| Variable | Purpose |
|---|---|
| `AWS_REGION` | Region for the STS call made while validating a new connection. Required by `POST /api/infrastructure/sync-aws`. |
| `AWS_ACCOUNT_ID` | The platform's 12-digit AWS account ID, placed in the trust policy shown to organizations. Required, with no default: the backend does not start in production without it, and connecting an AWS account fails (500) in any environment where it is missing or not 12 digits. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Optional, local development only: one way to give the default chain an identity. |

The platform identity only needs permission to assume the roles organizations create for DevControl:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::*:role/DevControlRole*"
    }
  ]
}
```

Having an identity does **not** make AWS data appear for any organization: that requires a connected account.

## Local development

Local development uses exactly the same model as production.

- To work on AWS-backed features locally, connect a **dedicated test AWS account or role** to your local organization through the Connect AWS page, the same way a customer would. Use an account you are happy for a development build to read; do not connect a production account to a local environment.
- Without a connected account, your local organization behaves like any unconnected organization: `AWS_NOT_CONNECTED`, and the unconnected states in the UI.
- The automated tests do not need AWS credentials or network access; they stub the STS and service clients.

Older local databases may contain resource rows that were written before this rule was enforced, when a development build could read the backend's own AWS account for organizations with no connection. Those rows do not belong to the organizations they are stored under and should not be relied on.

## Troubleshooting

**`AWS_NOT_CONNECTED`**
The organization has no connected AWS account, its stored connection is missing its external ID, or DevControl could no longer assume the role. Connect the account, or check that the role and its trust policy still exist in AWS.

**"The IAM role name must start with DevControlRole" when connecting**
The role's name does not start with `DevControlRole`, or the role was created under an IAM path. Create a role named `DevControlRole…` with no path and paste its ARN.

**"Access denied" when connecting**
The role's trust policy does not allow DevControl's account, or the external ID does not match the one shown on the Connect AWS page. Copy the trust policy from the page again.

**Cost data is missing after connecting**
Cost Explorer must be enabled in the connected account, and AWS can take a day or two to make data available.
