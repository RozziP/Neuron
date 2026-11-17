# Automatic unsupported-mouse reports

Neuron prepares a JSON report in the background at startup and after newly connected hardware is detected. Once a production endpoint is configured, it submits the report without asking the user to log in, click a button, or open a browser. Hardware detection is read-only. Version 2 adds identification evidence without vendor feature commands or input capture. Network activity never blocks the device-control loop.

## Deployment status

Live as of November 17, 2026. Neuron 0.1.1 sends reports to `https://neuron-hardware-reports.rozzipeter.workers.dev/hardware-report`, configured in `app/reporting-config.json`. The production Worker stores `GITHUB_TOKEN` as an encrypted secret. No GitHub credential belongs in the app configuration or anywhere in the distributed desktop application.

The repository is `RozziP/Neuron`. The Worker is deployed on Workers Free using a SQLite-backed Durable Object. The dashboard showed the free allowance of 100,000 requests/day during deployment; no paid subscription was enabled. Free limits apply; failures are retried by the client.

Production verification created [issue #1](https://github.com/RozziP/Neuron/issues/1) from the connected Logitech receiver. Two concurrent repeat submissions returned HTTP 200 and the same issue URL, with no extra issue or comment. The initial creation returned HTTP 201.

The dedicated fine-grained GitHub token is restricted to this repository's Issues read/write permission (plus required metadata read). It expires **November 17, 2027**. Renew it before then and update the encrypted `GITHUB_TOKEN` secret to keep automatic reporting working.

Version 2 identification reports and the confirmation-resolution endpoint were deployed on November 17, 2026 (Worker version e5acecfb-69fe-4926-a006-e438f3f13318). A real enriched Compx receiver report was accepted with a matching fingerprint and added once to [issue #3](https://github.com/RozziP/Neuron/issues/3). That unsupported-mouse issue remains open. Desktop users need the updated build to collect the extra evidence and use the confirmation panel.

## Maintainer setup

The current deployment is already configured. For maintenance or a new deployment:

1. In `worker`, run `npm ci`, then `npx wrangler login` with the Cloudflare account that will host the service. Stay on Workers Free. For a fork, update `account_id` in `worker/wrangler.jsonc` and both repository settings before deploying.
2. Create a fine-grained GitHub access token limited to **RozziP/Neuron**, with **Issues: read and write**. Enter it with `npx wrangler secret put GITHUB_TOKEN`. Do not paste it into source files or chat. Renew the secret before the token expires. The token's account will author the issues.
3. Run `npm run check`, then `npm run deploy` from `worker`. Deploying can create the free-tier Worker and its SQLite-backed Durable Object.
4. Set `endpoint` in `app/reporting-config.json` to the deployed HTTPS URL followed by `/hardware-report`, for example `https://neuron-hardware-reports.<your-subdomain>.workers.dev/hardware-report`. Keep `repository` set to `RozziP/Neuron`.
5. Rebuild the desktop distribution with `npm run pack`. End users need no configuration or GitHub account. Existing portable builds must be replaced with the rebuilt version.

The Worker uses the repository's existing Issues feature; no labels or templates need to be created. `npm run dev` in `worker` starts a local test service. The production desktop client accepts HTTPS endpoints only.

## Report contents

Version 2 reports include:

- USB/HID vendor and product IDs; product/manufacturer labels and release numbers for each collection (release is not necessarily firmware version); interface numbers and usage pages/usages.
- Windows HID descriptor summaries: input/output/feature report byte lengths, link collection count, and button/value capability counts. These counts describe HID structures, not the mouse's physical button count. Windows' cached preparsed data is read through HidD_GetPreparsedData/HidP_GetCaps; no feature requests or input reads are made.
- Windows device class, device/bus descriptions, manufacturer, driver provider and driver version, restricted to present devices with the same VID/PID. PnP instance IDs, location paths, container IDs and serials never leave the collector.
- Matching installed mouse-software evidence where a supported adapter exists: product name, software version, configured model ID and matching VID/PID. The initial adapter examines only Redragon mouse software registered under Program Files and the known Compx configuration format; the configuration must explicitly match the reported VID/PID. It does not upload the file, mappings, macros or an installed-program inventory. Other vendors get an explicit not-supported status.
- Collection success/unavailable statuses, an identity-confidence label, Neuron version, OS version and architecture.

Installed software is a candidate, not proof of the connected model. The configured MID is not a live firmware response. Shared receivers can remain unidentified; no universal collection of USB metadata guarantees a retail model or its configuration protocol. Resolving such devices requires a verified model-specific identification query, manufacturer evidence, or physical model confirmation.

Reports exclude HID paths, serial-number fields, usernames, profiles, game lists, filesystem paths and input events. Duplicate interfaces collapse, while differing labels, releases and descriptor summaries are retained as variants within the VID/PID report. Reports are bounded to 32 collection entries, 16 distinct Windows entries and 8 matching software entries. Oversized normalized reports are trimmed below 30,000 UTF-8 bytes with an explicit truncated flag, preserving a mouse collection. These are identification diagnostics, not a raw descriptor dump or protocol capture.

Unknown devices must advertise the HID mouse usage (page 1, usage 2). Catalogued Naga devices without a driver also qualify even when their mouse collection is unavailable. Models with a driver are excluded. Collection is limited to enumeration, descriptor summaries and the selected identification sources above; this is not a full system inventory or protocol capture. Receivers may identify themselves instead of the paired mouse, and composite keyboards can expose an emulated mouse interface; these reports require maintainer triage.

Evidence is collected asynchronously outside the device-control loop and cached for an hour; incomplete results retry after a minute and device replacement invalidates the cache. Missing Windows properties, helper failures or software adapters never suppress the base report. Sanitized reports are saved under `%APPDATA%/Neuron/hardware-reports/`. A separate `hardware-reporting.json` file remembers delivery receipts and retry times. These files stay outside the repository and release package. The README discloses automatic reporting; there is no opt-in prompt in the app.

## User identification and supported-issue closure

**Devices** shows an identification panel using catalog names and matching installed-software candidates. Users can confirm a suggestion or enter the actual brand/model. The answer is saved in hardware-identifications.json under userData, survives restarts, and is added to the next report as explicitly user-supplied evidence. Confirming an unsupported model never changes its driver or settings and leaves its issue open.

For a confirmed model with a working driver for the exact VID/PID connection, the desktop posts to /hardware-resolution. The service checks its own catalog and the normalized confirmed model name; it ignores caller-supplied support flags or issue URLs. It finds the associated issue using its own receipt/listing and closes only an issue bearing the matching automatic-report marker. It never closes pull requests, issues for another USB identity, or unmarked manual discussions; those remain for maintainer review. A supported model name on a shared, unsupported receiver ID cannot close that receiver's issue. Current support means the experimental Trinity driver for its 7- and 12-button plates, not every feature on the mouse.

Resolution uses the existing repository token, serialized coordinator and scan limits. Closure is idempotent: failed/lost responses retry by reading the issue state first; completed closure receipts survive restarts. Confirmed answers stay local while offline, with the UI showing pending resolution. The associated GitHub issue can be opened from the panel. Automated tests disable the reporting endpoint, so simulated confirmations never post or close live issues.

## Duplicate handling

- The model key is `vendorId:productId`, such as `1532:0096`. It does not contain a serial or installation identifier.
- All requests for a repository use one Durable Object coordinator. It serializes the check/create operation across machines and stores successful receipts durably.
- Before creating an issue, it lists **open and closed issues**, paging through up to 2,000 entries. Pull requests are excluded. A listing failure or page-limit overflow blocks creation.
- Existing issues match a hidden `<!-- neuron-hardware:1532:0096 -->` marker, the explicit ID pair, or separate VID/PID fields. Known-model support/driver/compatibility titles are also recognized, except the ambiguous bare name Naga. Add the marker to an unusually named manual issue to ensure it is recognized. Arbitrary prose cannot be matched reliably.
- Version 1 repeats still receive no comments. Version 2 uses a SHA-256 fingerprint of normalized identification evidence, excluding app/OS versions. New evidence is added as one comment on the existing issue (open or closed); identical evidence is acknowledged without another comment. Shared receiver variants remain in the same VID/PID issue. Comments preserve the original issue body and state. Deleting an issue does not erase its stored receipt.
- The client remembers acknowledged evidence fingerprints across restarts. Old receipts are upgraded automatically; improved evidence is sent again. A version 2 receipt must echo the expected fingerprint, so an older service cannot silently discard enrichment and mark delivery complete. Changing the endpoint resets the cache. Network failures back off from one minute to one day, with server retry hints honored.

GitHub issue creation has no atomic create-if-absent operation. The Worker records a pending attempt **before** posting. If GitHub's response is lost, it searches again and recovers the existing issue. If the outcome remains ambiguous, it leaves the attempt pending instead of risking a duplicate. A maintainer must inspect GitHub and the Durable Object record before clearing a permanently unresolved `report:<VID>:<PID>` record. Evidence comments use the same pending-before-POST rule. Before posting, the service checks the original issue and up to 500 comments for the evidence marker; lost responses are reconciled without blindly posting twice. Permanently ambiguous evidence records also require maintainer review. A human can still create a duplicate during the check/create window; the coordinator serializes this service's requests only.

## Abuse limits and operations

The endpoint is public so users need no accounts. Hardware claims cannot be authenticated solely from an anonymous desktop report. Both client and server allowlist fields; request bodies are limited to 32 KiB. The service caps its queue at 16, incoming coordinator requests at 120/minute, uncached GitHub scans at 10/minute, new issue attempts at 20/day, and evidence comments at 20/day and 8 per VID/PID issue. Persistent counters protect scan/creation budgets; the incoming rate limit is in-memory and resets with the object. The service never accepts a caller-selected repository, title, or issue body. Logs are disabled in the Worker configuration.

These limits bound GitHub spam but do not prevent deliberate exhaustion of free Cloudflare quotas. On Workers Free, exhausted quotas fail rather than incur overage charges. The app retries later. Avoid enabling paid plans without separately reviewing limits and billing.

Run `node --test test/*.test.cjs` from the project root for automated tests. They use simulated GitHub responses and do not open real issues. Run `npm run check` from `worker` to verify the deployable bundle. Deploy the Worker before distributing the version 2 desktop client. Repeat the live end-to-end verification after changing deployment or authentication. GitHub requests use `redirect: 'manual'` because the Cloudflare runtime does not support `'error'`; non-success responses are rejected, so credentials are never forwarded to redirect destinations. Ad hoc `wrangler tail` sessions can inspect sanitized failure messages even though persistent observability logs remain disabled.

References: [GitHub Issues API](https://docs.github.com/en/rest/issues/issues), [Cloudflare Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Descriptor API references: [HidD_GetPreparsedData](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getpreparseddata), [HIDP_CAPS](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/ns-hidpi-_hidp_caps).
