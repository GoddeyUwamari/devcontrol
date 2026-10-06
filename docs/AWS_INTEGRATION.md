# AWS Integration

How DevControl reads an organization's AWS account, and how to work with AWS-backed features in local development.

## The rule

**DevControl only ever reads an organization's AWS data with credentials from that organization's own connected IAM role.** This is the same in local development, test, staging and production.

- An organization connects one AWS account by creating an IAM role in it and giving DevControl the role's ARN.
- For every AWS operation on behalf of that organization, the backend assumes that role (`sts:AssumeRole`, with the organization's external ID) and builds its AWS clients with the temporary credentials it gets back.
- An organization that has not connected an account gets **`AWS_NOT_CONNECTED`**. No AWS client is created and no AWS call is made. There is no fallback to any other credentials and no mock data.

The backend's own AWS credentials are used for one thing only: as the caller identity for `sts:AssumeRole`. They are never used to read cost, inventory, metrics or security data, in any environment.

## Connecting an AWS account

Only an organization **owner** can connect AWS. In the app, open **Connect AWS** (`/connect-aws`):

1. The page shows a trust policy containing DevControl's account and an external ID generated for your organization.
2. In your AWS account, create an IAM role with that trust policy and attach the `ReadOnlyAccess` managed policy, as the page instructs.
3. Paste the role's ARN into the page. DevControl verifies that it can assume the role before saving the connection.
4. The first resource scan starts automatically. Cost Explorer data can take a day or two to become available from AWS.

You control the role: deleting it in AWS removes DevControl's access.

The endpoints behind this flow are `GET /api/aws/accounts/connect-init`, `POST /api/aws/accounts` and `GET /api/aws/accounts`.

## What an unconnected organization sees

Pages stay reachable and say that AWS is not connected; they do not show figures. On the API, AWS-backed operations report the organization as not connected rather than returning data:

- Discovery (`POST /api/services/discover`, `POST /api/aws-resources/discover`) does not scan anything. The scheduled discovery job records the attempt as failed for that organization and continues with the next one.
- Cost endpoints fall back to the inventory estimate where one is defined, or report that live cost data is unavailable. They never return another account's bill.

## Backend configuration

The backend needs its own AWS identity so that it can call `sts:AssumeRole`. Set these in `backend/.env` (never commit that file):

| Variable | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | The platform identity used to assume organizations' roles. |
| `AWS_REGION` | Region for the STS call made while validating a new connection. |
| `AWS_ACCOUNT_ID` | The platform's AWS account ID, placed in the trust policy shown to organizations. |

These credentials only need permission to assume the roles organizations create for DevControl. Setting them does **not** make AWS data appear for any organization: that requires a connected account.

## Local development

Local development uses exactly the same model as production.

- To work on AWS-backed features locally, connect a **dedicated test AWS account or role** to your local organization through the Connect AWS page, the same way a customer would. Use an account you are happy for a development build to read; do not connect a production account to a local environment.
- Without a connected account, your local organization behaves like any unconnected organization: `AWS_NOT_CONNECTED`, and the unconnected states in the UI.
- The automated tests do not need AWS credentials or network access; they stub the STS and service clients.

Older local databases may contain resource rows that were written before this rule was enforced, when a development build could read the backend's own AWS account for organizations with no connection. Those rows do not belong to the organizations they are stored under and should not be relied on.

## Troubleshooting

**`AWS_NOT_CONNECTED`**
The organization has no connected AWS account, its stored connection is missing its external ID, or DevControl could no longer assume the role. Connect the account, or check that the role and its trust policy still exist in AWS.

**"Access denied" when connecting**
The role's trust policy does not allow DevControl's account, or the external ID does not match the one shown on the Connect AWS page. Copy the trust policy from the page again.

**Cost data is missing after connecting**
Cost Explorer must be enabled in the connected account, and AWS can take a day or two to make data available.
