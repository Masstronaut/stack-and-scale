# The Renewer — minimal portfolio renewal assistant

## Approved local scope

Build on `feat/renewer-portfolio-command-center`. Do not single out a customer.
One action evaluates all 24 manifest customers, verifies each result, ranks the
portfolio, and displays the five highest priorities. Original currency, period,
recurring/variable/noncash consideration, and synthetic provenance are preserved.

No deployment, Box mutation, real email, commit, push, dependency installation,
or permission change is authorized by this local implementation. Live model
execution requires explicit operator enablement and an authenticated AWS context.

## Smallest implementation path

1. Shared dependency-injected pipeline: source inventory → per-customer extraction
   → deterministic verification/calculations → portfolio ranking → AE drafts.
2. Reuse the four workers. `contractScanner` extracts agreements;
   `relatedDocuments` resolves same-customer evidence and the matching shared
   offering; `salesNotes` produces verified findings and email drafts;
   `salesSlides` remains an optional, disabled presentation stage.
3. Nova proposes priorities and actions, not commercial approvals. Fixed scoring
   weights make urgency (35%), business impact (20%), actionability (30%), and
   evidence quality (15%) explainable. Value is not ranked by comparing nominal
   amounts across currencies. A complete run requires all 24 successful reviews.
4. Use one read-only source snapshot per run. Version drift, missing evidence,
   incomplete coverage, malformed output, and unsupported monetary claims block
   publication. Unknowns are not filled with guessed data.
5. Latest UI direction supersedes the command-center/dashboard design: only five
   rows, each with a name, a short priority reason, and Generate Email. No KPIs,
   charts, statistics, dashboard sections, or bulk-send controls. A small source/
   cached-status notice is necessary for honesty. Generate Email re-reads the
   selected customer's documents and invokes Nova again before a polished email
   preview with evidence links. Send Email opens a separate approval step. No new
   UI framework or cloud service. Fixture previews are never live/verified cache.
6. Reuse SST/Lambda/SQS for later approved deployment. Queue messages carry run
   and customer IDs, not credentials or document bodies. Existing DLQs and partial
   responses remain. Durable coordination/idempotency must be approved and
   implemented before enabling queued email sending; SES has no exactly-once
   guarantee and ambiguous send outcomes must not be blindly retried.

## Acceptance checks

- All 24 manifest customers are eligible; no predetermined names, top-five list,
  values, or findings in live ranking. Change evidence and the ranking can change.
- Days/utilization are calculated in code, with observed/forecast and full/partial
  periods retained. Missing dates remain unknown.
- Claims cite a same-customer or shared file, matching version and a supporting
  passage. UI distinguishes these mechanical checks from human semantic review.
- Roadmap is not shipped, adoption is not availability, proposals are not orders,
  support response is not resolution, and noncash is not invented ARR.
- Cards and AE email use the same verified facts. No synthetic recipient is used.
- Server selects approved test recipients. Browser requests cannot grant write or
  send permission. Local email remains blocked during this implementation.
- Fixture/cache/live modes and retrieval/verification/delivery states are visible.
- Run native tests and isolated Playwright browser checks. Full project CI needs
  approved dependency installation and the project-required Node 24 runtime.

## Prerequisites for a genuine live demo

AWS account/stage confirmation and credentials; Nova 2 Lite inference-profile
access; installed existing project dependencies; confirmed Box CCG actor with
read access to the dataset; verified SES sender and recipient allowlist. Do not
extract secrets from SST state or credential stores. SDK/CLI auth must return
non-secret success/failure only. Production SDK adapters remain server-side.

## Separate approvals after local review

Dependency setup → live Box/Bedrock run → deployment/resource permissions →
Box metadata/output writes → selected SES sends → commit/push. A preview or
fixture confirmation is not approval for any later gate.
