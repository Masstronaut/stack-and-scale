# The Renewer — local review

Run from this feature checkout (no package installation required for the UI):

```sh
node src/renewal/server.ts
node --test scripts/test-renewer.ts
```

Open <http://127.0.0.1:4317>. The default page never fabricates an AI-selected
portfolio. Until authenticated integrations are enabled, it explains that live
analysis is unavailable. **Preview the design with example data** is an explicit,
anonymous fixture mode. Its five rows are dynamically ranked from 24 examples;
they are not the 24 real Box customer accounts, and no model is called.

The interface intentionally contains no dashboard, charts, KPI cards, or bulk
actions. Generate Email opens a preview, supporting evidence, and a separate send
approval dialog. Delivery is disabled in both client and server. Forging an
approval or recipient cannot enable it. Closing a preview while generation is in
progress cannot replace a later preview with an older response.

## Live-analysis boundary

`--allow-live-analysis` is an explicit operator gate and has **not** been enabled
in this implementation review. It requires separate approval for live Box and
paid Bedrock operations. With approved existing dependencies installed, the local
provider uses the official Box TypeScript SDK and the existing AWS CLI for Nova
Converse. No new service, token store, model subscription, or cloud deployment is
created. CCG secrets must be injected privately; the server does not read local
credential files or SST state. Configure these names through an approved channel:

- `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ENTERPRISE_ID`
- AWS default credential chain / approved `AWS_PROFILE`
- `AWS_REGION`, `RENEWER_AWS_ACCOUNT`, `RENEWER_MODEL_ID`
- `RENEWER_AS_OF` (default explicit demo date `2026-10-17`)

The approved model profile must currently be `us.amazon.nova-2-lite-v1:0`.
Live provider calls have not been tested. The legacy four SQS worker handlers
remain unchanged and stubbed; they are **not** claimed to execute this new local
pipeline. The core is dependency-injected so it can be integrated into their
Effect services in a later approved/tested change. Production integration should
use the Bedrock Runtime SDK rather than packaging the CLI inside Lambda.

A live run reviews all eight documents per customer plus the four shared files
(196 unique content reads, cached within the run). The 24 historical original PDFs
remain catalogued, not treated as 24 additional active renewals. Shared documents
are reused, but the model must match the relevant supplier offering. A failure
blocks publication of a new portfolio, rather than silently ranking a subset.

Generate Email re-reads the selected account and invokes Nova again. Dates,
amounts, utilization inputs, quote substrings, source scope, and source versions
are checked in code. These checks establish source matching, **not** complete
semantic truth or legal correctness; human review is still required. Recommendations
are model-authored; rendering is deterministic. Scores use documented weights
and model-proposed rubric values, never a cross-currency nominal-value comparison.

Results are held in process memory only. Loading previously computed results
shows their original timestamp and cached status. Restarting the server discards
them. There is no persistent document cache, Box metadata write, email sender,
durable run ledger, cloud queue chaining, or production authentication in this
local prototype. It binds only to loopback, checks Host/Origin and a per-process
request token, uses a restrictive CSP and text-only document rendering, and serves
only three explicit static assets. It is not a publicly hosted application.

## Verification — October 17, 2026

### Latest AWS / Box readiness checkpoint

This supersedes the earlier missing-AWS-credentials observations below.

- Profile `renewer-sso`: account `562654496564`, Region `us-west-2`, authenticated
  non-root `AWSReservedSSO_StackScaleDeveloper` assumed role. OpenCode AWS MCP
  reconnected and passed its own STS identity call. Only profile/Region names were
  added to machine-local OpenCode configuration; that configuration is not part
  of this repository and contains no copied SSO credentials.
- Nova 2 Lite authorization/entitlement/Region availability succeeded and
  `us.amazon.nova-2-lite-v1:0` is ACTIVE. No inference invocation was made during
  the read-only assessment; runtime inference remains untested.
- All four production worker Lambdas are Active, with successful last updates
  and enabled SQS event mappings. Four worker queues plus DLQs exist, with three
  redrive attempts and 1,800-second worker visibility timeouts. Queue counts were
  zero at inspection. Infrastructure presence does not prove worker functionality.
- SES is healthy and enabled in sandbox mode, with `fmruslanai@gmail.com` verified.
  The existing production SST sender binding is still `verified-sender@example.com`.
  Correcting that mismatch requires separate approved configuration/deployment.
- Production SST Box CCG bindings are present and authenticate as service account
  `53094488804`. Secret values were used only in process memory, never printed or
  copied into project files. Secret objects are encrypted at rest and the state
  bucket blocks public access.
- **Blocking:** that application service account receives 404 for the approved
  dataset root, customer/shared folders and sampled files. The user's Box MCP
  connection can read the same folders. Review and separately approve the app's
  read-only dataset access; no Box permissions were changed.
- No deployment, email, Box write, infrastructure modification or model inference
  occurred during those checks. The UI still shows fixtures only when explicitly
  requested. A genuine 24-account live run has not been completed.

The user subsequently approved a GitHub checkpoint and requested a merge.
The checkpoint excludes credentials, `.sst/`, generated artifacts, dependencies,
and machine-local configuration. Merging `main` triggers the existing production
Deploy workflow, so deployment approval is required before merging this checkpoint.

### Approved dependency setup and live-access preflight

- Installed Node 24.22.0 in npm's isolated executable cache (system Node unchanged).
  Installed the existing lockfile with `npm ci --ignore-scripts`, using Node 24.
  No SST install/dev/deploy, permission change, Box write, or email send was run.
- With Node 24 on PATH: `npm run test` passed **8 existing tests**;
  `npm run test:renewer` passed **11 native tests**. The native CSS check was made
  case-insensitive because the project formatter lowercases CSS hexadecimal colors.
- Final `npm run check`: **passed**, all 43 files formatted, zero lint errors,
  one warning in the unchanged SST triple-slash reference. `git diff --check` passed.
- Applied the existing formatter/linter only to the new local prototype files.
  Checked the adapter against installed Box SDK 10.18.0 declarations. CSV download
  now pins `queryParams.version` to the approved manifest version.
- `vp lint --type-aware --type-check src/renewal scripts/test-renewer.ts` reported
  no compiler errors, but additional type-aware lint warnings (including Node test
  registration promises) remain. This is not evidence of successful live calls.
- `npm audit --json` reported **5 high-severity findings**, one underlying advisory:
  GHSA-c475-qrg2-pj4r in basic-ftp, propagated through get-uri / pac-proxy-agent /
  proxy-agent / box-node-sdk. No forced downgrade or automatic audit fix applied.
- `aws sts get-caller-identity --output json --no-cli-pager`: **NoCredentials**.
  `aws configure list-profiles`: **empty**. Box CCG and Renewer live configuration
  variable-presence checks: **unset** (no values printed and no secret files read).
  Therefore Nova, SES account/sender status, CCG identity/permissions, and the real
  portfolio run remain **blocked**, not verified. User-account Box access from the
  earlier assessment does not substitute for the service-account check.

To continue, the operator must authenticate the intended AWS account on this host
using their approved login method (for example `aws login` or existing SSO setup),
and privately inject the existing Box application's CCG variables listed above.
Never paste secrets into chat. After access is ready, verify STS identity against
the intended account, Nova availability/profile and a small inference, SES status
and sender with read-only APIs, then CCG identity and one allowlisted document.
Only after these checks should the approved 24-account analysis run begin.

### White workspace and larger type (current design)

- Supersedes the dark palette below: white page and dialogs, light-gray surfaces,
  dark text, and restrained orange status accents. Browser color scheme is light.
- Body, reasons, and email text are 16px; customer names are 18px; desktop title
  is 32px. Mobile preserves 16px body copy rather than shrinking to 11–12px.
- `node --test scripts/test-renewer.ts`: **11 passed**; `git diff --check`: **passed**.
- Playwright at 1440×1000 confirmed white background and 18px names / 16px reasons;
  at 390×844 confirmed no horizontal overflow, white email preview, 16px email
  text, and the unchanged delivery-disabled message.

### Neutral workspace redesign

- Replaced the green wash and oversized hero with `#0B0B0C` background,
  neutral panels/dividers, white CTAs, and restrained orange status indicators.
- Main actions are compact and left-aligned above the list. Row actions stay
  right-aligned on mobile. No new statistics, charts, or fabricated evidence tags.
- Playwright at 1440×900: compact list visually inspected. At 390×844: five
  fixture rows, no horizontal overflow, right-aligned buttons, computed background
  `rgb(11, 11, 12)` and background image `none`. Email preview still opens and
  delivery remains disabled. Screenshot: `renewer-neutral-desktop.png` in the
  existing ignored Playwright artifact directory.
- `node --test scripts/test-renewer.ts`: **11 tests passed** after the redesign,
  including palette/layout regression checks. `git diff --check`: **passed**.

- `node --test scripts/test-renewer.ts`: **10 tests passed**, including full
  24-account fake-provider coverage / 196 unique reads, ranking sensitivity,
  invalid evidence, currency handling, CSRF/Host rejection and send bypass denial.
  Provider tests use fixtures, not live Box/Bedrock calls.
- `node --check src/renewal/web/app.js`: **passed**.
- `git diff --check`: **passed**.
- Isolated Playwright: default unavailable state shows no fabricated customer
  rows; explicit fixture preview shows five rows and a visible fixture label;
  Generate Email opens the correct preview; Send Email opens a separate dialog
  with disabled Approve & Send; mobile layout at 390×844 has no horizontal
  overflow; desktop layout checked at 1440×1000.
- An initial browser favicon 404 was fixed. A fresh browser page had no reported
  console errors. Screenshot saved by the existing Playwright harness to its
  permitted ignored artifact directory as `renewer-desktop.png`.
- Full `npm run check` / `npm run test` were **not run**: dependencies are not
  installed and the current Node 22 runtime does not meet project Node 24 policy.
  No software installation or cloud execution was performed.
