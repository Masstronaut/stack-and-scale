# Box CCG credentials through SST

Documentation only: no secrets were read or set, no AWS resources deployed, and no Box permissions changed for this handoff.

## Existing integration

- `sst.config.ts` declares `sst.Secret("BOX_CLIENT_ID")`, `sst.Secret("BOX_CLIENT_SECRET")` and `sst.Secret("BOX_ENTERPRISE_ID")`, linking them to the consumer and worker functions.
- `src/lib/box.ts` reads `Resource.BOX_CLIENT_ID.value`, `Resource.BOX_CLIENT_SECRET.value` and `Resource.BOX_ENTERPRISE_ID.value` server-side and uses `CcgConfig`, `BoxCcgAuth` and `BoxClient` from the installed `box-node-sdk`.
- Linking secrets does **not** replace the stub services currently provided inside the pipeline workers. Dataset permissions for the existing Box CLI actor do not prove the separate CCG service account can read the folders.

## Operator setup (requires separate approval)

1. Confirm the intended existing AWS account/profile, SST app and stage with the team. Use the repository's approved toolchain; do not install software, bootstrap resources, deploy or create a new stage as part of this documentation review.
2. Obtain the Box CCG app's client ID, client secret and enterprise ID through the team's approved private channel. Never paste values into chat, GitHub issues/PRs, screenshots or source files. The Box app must already be authorized by the enterprise administrator and its service account must have the intended minimum folder access; request approval for any access/scope change rather than silently granting it.
3. After authorization to set cloud secrets, use the existing local SST executable with **interactive secret input**, omitting the value argument so it is not placed in shell history or process arguments. Run from this repository with the agreed stage (replace `TEAM_APPROVED_STAGE`, not with a newly invented stage):

   ```bash
   ./node_modules/.bin/sst secret set BOX_CLIENT_ID --stage TEAM_APPROVED_STAGE
   ./node_modules/.bin/sst secret set BOX_CLIENT_SECRET --stage TEAM_APPROVED_STAGE
   ./node_modules/.bin/sst secret set BOX_ENTERPRISE_ID --stage TEAM_APPROVED_STAGE
   ```

   Enter values only in SST's private prompt. If the installed version does not provide masked input, stop and use an approved secret-manager/stdin workflow; do not fall back to inline values. Avoid `--fallback` so credentials are not unintentionally shared across stages.
4. Secret setting is a cloud write, not a deployment approval. SST documents that a later deployment is required to apply changes when not using `sst dev`. Both `sst dev` and `sst deploy` can provision/update resources; run neither without explicit team approval. Do not push to `main` to apply secrets: this repository has a deployment workflow triggered by `main` pushes.
5. After an authorized integration/deployment, verify CCG identity via a server-side current-user read returning only non-secret ID/type information, then read metadata for one allowlisted dataset file. Confirm its ID, name, parent folder and version. Test retrieval without printing bodies or credential values; a 403/404 is an access issue to review, not permission to broaden scope. No live CCG check is claimed by this handoff.

## Security boundary

- Never use `VITE_*`, `NEXT_PUBLIC_*` or any browser-public variable for Box secrets. Keep CCG and token refresh server-side. Do not send access tokens in queue messages or UI links.
- Never commit `.env`, SST state, generated function packages, credentials, tokens, document downloads or model request logs. Do not run `sst secret list` or decrypted state export to check configuration: these can reveal secret values.
- SST secrets are encrypted in its AWS backing bucket and included in packages of functions that use them. Protect backend/state access, deployment artifacts and function access; linking is not a claim of runtime secret-vault isolation. Limit which functions receive credentials.
- Keep GitHub Actions on the repository's existing OIDC AWS access model. No long-lived AWS keys or Box values belong in GitHub variables or the manifest. Do not modify account permissions or workflows in this contribution.
- Read-only dataset retrieval should be scoped to explicit manifest files/folders. Any future metadata write or output upload requires a separate validated allowlist and manual approval gate in server code.

References checked for this handoff: [SST CLI secrets](https://sst.dev/docs/reference/cli/#secret), [SST secrets](https://sst.dev/docs/component/secret/), [Box CCG authentication](https://developer.box.com/guides/authentication/client-credentials/). Follow the installed SDK/config conventions rather than mixing legacy Box SDK examples.
