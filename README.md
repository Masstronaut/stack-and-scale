# stack-and-scale

Base tech stack ([#1](https://github.com/Masstronaut/stack-and-scale/issues/1)) for a job-processing service on AWS:

- **SST (v4)** defines and deploys all AWS resources in TypeScript (`sst.config.ts`)
- **SQS** is the job queue (`JobQueue`, with a dead-letter queue after 3 failed attempts)
- **Lambda (Node.js)** consumes jobs off the queue
- **SES** sends the notification emails (via `sst.aws.Email`)
- **Box TS SDK** (`box-node-sdk` v10, the consolidated Box TS SDK, client-credentials grant) pulls files in the job consumer
- **Vite+** (`vp`) is the unified toolchain: install, lint, format, typecheck, test
- **GitHub Actions** for CI (check + test) and CD (deploy + smoke test)

## Layout

```
sst.config.ts              AWS resources: ApiGatewayV2 (/health), SQS + DLQ + consumer, SES, secrets
src/lib/health.ts          shared health payload (lambda + local server)
src/lib/box.ts             Box client (CCG auth) + file pull
src/lib/email.ts           SES send helper
src/functions/api.ts       GET /health lambda
src/functions/consumer.ts  SQS job consumer (Box -> SES), partial batch responses
src/server.ts              local HTTP server exposing the same /health handler
test/health.test.ts        spins up the local server and hits /health over HTTP
scripts/smoke.ts           post-deploy smoke test against a deployed /health URL
infra/gha-oidc.yaml        one-time CloudFormation: OIDC deploy role for GitHub Actions
```

## Local development

```bash
npm install          # or: vp install
npm run server       # start local health server (reads .env) -> http://localhost:3000/health
npm run check        # vp check: format + lint + typecheck
npm run test         # vp test: hits a live local server over HTTP
```

## Deploy

```bash
cp .env.example .env   # fill in AWS credentials + SES_SENDER_EMAIL
npx sst deploy --stage production
```

SST prints the stack output `api` — the health endpoint lives at `<api>/health`. Verify:

```bash
npm run smoke -- https://<api-id>.execute-api.<region>.amazonaws.com
```

Each queue message is a JSON job; the consumer pulls the file from Box and emails the recipient via SES:

```json
{ "fileId": "1234567890", "recipient": "someone@example.com" }
```

## Environment variables

### `.env` (local, gitignored — see `.env.example`)

| Variable                                                                             | Used by         | Purpose                                      |
| ------------------------------------------------------------------------------------ | --------------- | -------------------------------------------- |
| `AWS_REGION`                                                                         | SST CLI         | Region to deploy into / use locally          |
| `AWS_PROFILE` _or_ `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | SST CLI         | AWS credentials for `sst deploy` / `sst dev` |
| `SST_STAGE`                                                                          | SST CLI         | Stage name (`dev`, `production`, ...)        |
| `SES_SENDER_EMAIL`                                                                   | `sst.config.ts` | Verified SES sender (address or domain)      |
| `PORT`                                                                               | `src/server.ts` | Local health server port (default 3000)      |

### GitHub Actions environment

Set these in the **`production` environment** (Settings → Environments → production) as _variables_:

| Variable                        | Used by                        | Purpose                                                   |
| ------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN`           | deploy workflow                | ARN of the OIDC deploy role (see `infra/gha-oidc.yaml`)   |
| `AWS_REGION`                    | deploy workflow                | Region to deploy into                                     |
| `SES_SENDER_EMAIL`              | `sst.config.ts` at deploy time | Verified SES sender for the stage                         |
| `HEALTH_CHECK_URL` _(optional)_ | deploy smoke test              | Explicit health URL; otherwise extracted from stack state |

No AWS keys are stored in GitHub — the deploy job assumes the role via OIDC
(`permissions.id-token: write`). Bootstrap the role once with:

```bash
aws cloudformation deploy \
  --template-file infra/gha-oidc.yaml \
  --stack-name stack-and-scale-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM
```

### SST secrets (per stage, used at runtime by the consumer)

Stored in SST's backend — never in `.env` or GitHub. Set once per stage:

```bash
npx sst secret set BOX_CLIENT_ID <value> --stage production
npx sst secret set BOX_CLIENT_SECRET <value> --stage production
npx sst secret set BOX_ENTERPRISE_ID <value> --stage production
```

These are the Box **client credentials grant** values from your Box app (Box
console → app → Configuration → OAuth 2.0 Credentials, enterprise ID enabled).

### Deployment checklist (first run)

1. `aws cloudformation deploy ... infra/gha-oidc.yaml` (above) and add `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `SES_SENDER_EMAIL` to the `production` environment
2. `sst secret set BOX_*` for the stage
3. Verify `SES_SENDER_EMAIL` in the SES console (sandbox accounts can only send to verified recipients)
4. Push to `main` — the Deploy workflow runs `sst deploy`, then smoke-tests `/health`

## CI/CD

- **`ci.yml`** — on PRs and pushes: `voidzero-dev/setup-vp` → `npx sst install` (generates SST platform types) → `vp check` → `vp test`
- **`deploy.yml`** — on push to `main` (or manual dispatch): OIDC assume role → `sst deploy --stage production` → smoke test of the deployed `/health`
