# Worker retrieval contract

This is implementation guidance, **not a claim that the workers already enforce it**. At handoff, `src/workers/{contractScanner,relatedDocuments,salesNotes}.ts` explicitly provide stub Box/LLM services. `relatedDocuments` currently returns every candidate ID rather than applying relevance filtering. No worker code changes or live pipeline tests are included here.

## contractScanner

- For the 2026 fictional renewal demo, enumerate the manifest's **24 `AGREEMENT` files**, one per account, rather than classifying all 220 files or scanning the whole enterprise. Use these as `contractFileId` for downstream jobs.
- Read each Renewal Agreement for the fictional current term, expiration, renewal mechanism, notice convention, approved scope and approval conditions. Extract structured values with citations; represent unknown/conditional dates explicitly. Never infer notice deadlines from a universal rule.
- Read that customer's `PROFILE` only when identity context is necessary. Follow `customer_id` and the explicit original-source mapping; the historical parties have different names.
- The mapped `CUAD_ORIGINAL` is historical source evidence, not a second active fictional renewal. Retrieve it for source/clause verification or a separately labeled historical-contract demonstration; do not substitute its old dates for the synthetic current schedule or enqueue duplicate active accounts.
- Scanning must be read-only by default. The current worker's metadata-write path needs a separate server-side write allowlist, validated output and explicit write approval before live use. Never stamp demo dates onto the originals as if historically verified.

## relatedDocuments

1. Resolve the supplied `contractFileId` by exact manifest ID. Reject unknown or ambiguous IDs. If given a `CUAD_ORIGINAL` for a historical mode, resolve its explicit customer mapping and retain provenance.
2. Select the **same customer's eight files**. The agreement is already the primary input, so return the other seven as the baseline related set, with a reason for each. Do not select another customer's correspondence by keyword similarity.
3. Consult the four shared Product Knowledge references for the matching supplier-specific offering: Product Catalog (scope), Release Notes (shipped capability/date), Product Roadmap (planned items), Pricing & Service Tiers (commercial basis). Include only relevant sections; a shared file does not make every offering apply to every customer.
4. Add the mapped original only when a historical factual/clause claim needs grounding. Preserve its original provenance. Return allowlisted IDs plus relevance/citation metadata, not fabricated download links.

`PROFILE` provides identity; `EMAILS` and `HISTORY` supply asks and negotiation context; `REQUESTS` supplies request status; `USAGECSV`/`USAGE` supply observations and formulas; `OBLIGATIONS` supplies delivery evidence. Fetch content, not just filenames, before asserting relevance. Bound file sizes and context, paginate folder listings if used, and keep all candidate IDs scoped to this account plus approved shared references.

## salesNotes

- Read the primary Renewal Agreement and validated related IDs. Use the profile, correspondence and account notes to understand the conversation; reconcile claims against usage, obligations, request status and shared release/pricing evidence.
- Produce grounded notes: account context; current scope and renewal/notice conditions; customer priorities; value evidenced; delivery/adoption gaps; decisions required; open questions; proposed next steps. Recommend expansion only when evidence supports it—routine continuation, adoption support or remediation may be the appropriate outcome.
- Use `USAGECSV` for exact inputs and `USAGE` for the documented interpretation. They are two views of the same observations, not independent confirmation or additive totals. Recompute necessary arithmetic deterministically and show inputs/formula/period/currency, without exposing private evaluation material.
- Cite file ID/direct link and page, section or CSV period/metric for factual claims. Label historical original facts, synthetic observations/terms and derived estimates separately. Record unverified or conflicting evidence; do not invent approval, delivery, accepted prices, savings or disputes.
- Private master data and answer keys are **never retrieval inputs**. This handoff includes no sales deck or sales-notes output and authorizes no upload. The existing `uploadFile` path needs a separately approved output folder and server-side write gate before activation. Never overwrite source inputs.

## Integration boundary

Current queue types use `contractFileId` and `relevantDocumentIds`; the manifest is a suggested mapping/allowlist, not an automatically loaded integration. Implement input validation, folder/resource allowlists, provenance tracking and write approval outside the LLM. Do not run an unmodified full-enterprise scanner against live Box merely because credentials are available.
