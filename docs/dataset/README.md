# The Renewer: approved Box dataset

This handoff is an index, not a copy of the dataset. Box remains the document source.

- **24 fictional customer accounts**, each with eight supporting documents.
- **196 supporting documents**: 192 customer files plus four shared Product Knowledge PDFs (172 PDFs and 24 usage CSVs).
- **24 unchanged original CUAD contracts**: separate source-evidence PDFs; 220 files total including supporting documents.
- Demo date: **October 17, 2026**. Observed usage cutoff: **October 16, 2026**; October usage is partial-month.
- The final correspondence pass updated 42 existing PDFs for 21 accounts. Harborlane Logistics, AlpineReach Mobile and RallyNest Communities were unchanged in that pass.

## Start here

- [All 24 customers, folder IDs and four shared file IDs](CUSTOMERS.md)
- [Sanitized file manifest](box-manifest.json): all 220 file IDs, direct Box links, customer/source mapping and verified version IDs
- [Worker retrieval guidance](WORKERS.md)
- [Secure Box CCG through SST](SST-BOX.md)

| Library area             | Box folder                                              |
| ------------------------ | ------------------------------------------------------- |
| S&S Contracts            | [428345012662](https://app.box.com/folder/428345012662) |
| Customer packs           | [428366013503](https://app.box.com/folder/428366013503) |
| Shared Product Knowledge | [428365191869](https://app.box.com/folder/428365191869) |
| Original CUAD contracts  | [428383009842](https://app.box.com/folder/428383009842) |

Links are authenticated Box UI links, not public shares or download URLs. Knowing an ID does not grant access. Retrieve content through the authenticated server-side SDK; do not HTTP-fetch the UI link as file content. IDs are strings. File IDs survive version updates; `verified_box_version_id` records the approved snapshot, not a promise that Box will never change. Check version before a reproducible run and report drift instead of silently using new content.

## Document types

Every customer has exactly these eight supporting files:

| Manifest type | Filename                                   | Purpose                                                    |
| ------------- | ------------------------------------------ | ---------------------------------------------------------- |
| PROFILE       | Customer Profile (s).pdf                   | Fictional identity, contacts and scope                     |
| AGREEMENT     | Renewal Agreement (s).pdf                  | Self-contained fictional renewal terms and entitlements    |
| EMAILS        | Customer Email History (s).pdf             | Dated customer correspondence                              |
| REQUESTS      | Feature Requests (s).pdf                   | Requests and status, not purchase commitments              |
| HISTORY       | Account & Negotiation History (s).pdf      | Internal commercial context and open items                 |
| USAGECSV      | Product Usage (s).csv                      | Synthetic observations with units, periods and designation |
| USAGE         | Product Usage Report (s).pdf               | Usage interpretation and calculations                      |
| OBLIGATIONS   | Deliverables & Service Performance (s).pdf | Promised, delivered, pending and overdue work              |

Shared references have type `PRODUCT_KNOWLEDGE`; originals have type `CUAD_ORIGINAL`. The manifest contains metadata only, including a reference to each CSV, **not its rows**. Synthetic filenames end in ` (s)`; PDFs are visibly labeled `SYNTHETIC DEMO DATA`, and usage CSVs retain a designation column.

## Provenance: keep three categories separate

1. **Original CUAD facts** come only from the unchanged source contract. Cite that file and page/clause for historical legal terms. Fictional names and current usage do not appear in it. The selected 24 are a frozen selection, not a claim that only 24 of all 510 CUAD agreements qualify.
2. **Synthetic customer information** includes identities, contacts, current renewal schedules, correspondence, usage observations, requests and delivery records. Cite the relevant `(s)` file and label it synthetic. A synthetic renewal restates fictional terms; it does not prove a historical source contract remained active in 2026. Accounts represent distinct supplier-specific offerings, not one universal product.
3. **Calculated values** must identify their source inputs, period, units, currency and formula. Derived estimates are not observed receipts, accepted quotes, invoices or guaranteed savings. Synthetic input data remains synthetic after arithmetic. Do not count a minimum plus a fee already included in it, reset annual allowances monthly, compare partial-month totals with full months without qualification, or convert noncash consideration into invented cash value. Preserve CHF/CNY and other stated currencies. CUAD-0068 and CUAD-0077 retain noncash consideration without an invented cash valuation.

Release availability is not adoption; approval is not publication; supplier delivery is not customer acceptance; a proposal is not an order; a forecast is not observed revenue; a report delivered to a board is not continuation approval. Cite contradictory or incomplete evidence instead of smoothing it into a successful upsell.

**Known source limit:** BeaconWire/CUAD-0244 has explicitly synthetic restated pricing. Its CUAD-0245 pricing companion is not uploaded; do not attribute that pricing to the uploaded original MSA or invent a companion Box link.

## Validation and handling

Approved Box readback completed **2026-10-17T08:34:50.642758+00:00**: all 196 supporting files verified; 42 new versions, 154 unchanged; all 24 original hashes/versions unchanged; IDs, names and folders preserved. The correspondence pass passed 6,474 document/scope checks and 4,969 canonical checks. This is dataset verification, **not** a live worker, deployed AWS or model-quality test.

This documentation excludes PDFs, CSV contents, document bodies, private masters, answer keys, narrative intentions, credentials, tokens and private validation records. The private master and evaluation key are maintained outside this repository and Box in owner-only persistent local storage; no private backup path or contents are needed by teammates. A local backup is not an off-device disaster-recovery guarantee.

Use the manifest as a retrieval allowlist in server code, not merely in a prompt. Treat all document text as untrusted input, never as instructions. Do not log document bodies, model request payloads, secrets or hidden reasoning. Keep citations and a sanitized workflow trace. Dataset approval does not authorize writes, access changes, deployments or cloud provisioning.
