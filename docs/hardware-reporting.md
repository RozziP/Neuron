# Automatic unsupported-mouse reports

Neuron prepares a JSON report in the background at startup and after newly connected hardware is detected. Once a production endpoint is configured, it submits the report without asking the user to log in, click a button, or open a browser. Hardware detection is read-only. Network activity never blocks the device-control loop.

## Deployment status

Live as of November 17, 2026. Neuron 0.1.1 sends reports to `https://neuron-hardware-reports.rozzipeter.workers.dev/hardware-report`, configured in `app/reporting-config.json`. The production Worker stores `GITHUB_TOKEN` as an encrypted secret. No GitHub credential belongs in the app configuration or anywhere in the distributed desktop application.

The repository is `RozziP/Neuron`. The Worker is deployed on Workers Free using a SQLite-backed Durable Object. The dashboard showed the free allowance of 100,000 requests/day during deployment; no paid subscription was enabled. Free limits apply; failures are retried by the client.

Production verification created [issue #1](https://github.com/RozziP/Neuron/issues/1) from the connected Logitech receiver. Two concurrent repeat submissions returned HTTP 200 and the same issue URL, with no extra issue or comment. The initial creation returned HTTP 201.

The dedicated fine-grained GitHub token is restricted to this repository's Issues read/write permission (plus required metadata read). It expires **November 17, 2027**. Renew it before then and update the encrypted `GITHUB_TOKEN` secret to keep automatic reporting working.

## Maintainer setup

The current deployment is already configured. For maintenance or a new deployment:

1. In `worker`, run `npm ci`, then `npx wrangler login` with the Cloudflare account that will host the service. Stay on Workers Free. For a fork, update `account_id` in `worker/wrangler.jsonc` and both repository settings before deploying.
2. Create a fine-grained GitHub access token limited to **RozziP/Neuron**, with **Issues: read and write**. Enter it with `npx wrangler secret put GITHUB_TOKEN`. Do not paste it into source files or chat. Renew the secret before the token expires. The token's account will author the issues.
3. Run `npm run check`, then `npm run deploy` from `worker`. Deploying can create the free-tier Worker and its SQLite-backed Durable Object.
4. Set `endpoint` in `app/reporting-config.json` to the deployed HTTPS URL followed by `/hardware-report`, for example `https://neuron-hardware-reports.<your-subdomain>.workers.dev/hardware-report`. Keep `repository` set to `RozziP/Neuron`.
5. Rebuild the desktop distribution with `npm run pack`. End users need no configuration or GitHub account. Existing portable builds must be replaced with the rebuilt version.

The Worker uses the repository's existing Issues feature; no labels or templates need to be created. `npm run dev` in `worker` starts a local test service. The production desktop client accepts HTTPS endpoints only.

## Report contents

Reports include USB/HID vendor and product IDs, product/manufacturer labels, the device release number (not necessarily its firmware version), interface numbers, usage pages/usages, Neuron version, OS version, and architecture. They exclude HID paths, serial-number fields, usernames, profiles, game lists, filesystem paths, and input events. Multiple identical units and interfaces collapse into one model report.

Unknown devices must advertise the HID mouse usage (page 1, usage 2). Catalogued Naga devices without a driver also qualify even when their mouse collection is unavailable. Models with a driver are excluded. Detection is limited to what HID enumeration exposes; this is not a full system inventory or protocol capture. Receivers may identify themselves instead of the paired mouse, and composite keyboards can expose an emulated mouse interface; these reports require maintainer triage.

Sanitized reports are saved under `%APPDATA%/Neuron/hardware-reports/`. A separate `hardware-reporting.json` file remembers delivery receipts and retry times. These files stay outside the repository and release package. The README discloses automatic reporting; there is no opt-in prompt in the app.

## Duplicate handling

- The model key is `vendorId:productId`, such as `1532:0096`. It does not contain a serial or installation identifier.
- All requests for a repository use one Durable Object coordinator. It serializes the check/create operation across machines and stores successful receipts durably.
- Before creating an issue, it lists **open and closed issues**, paging through up to 2,000 entries. Pull requests are excluded. A listing failure or page-limit overflow blocks creation.
- Existing issues match a hidden `<!-- neuron-hardware:1532:0096 -->` marker, the explicit ID pair, or separate VID/PID fields. Known-model support/driver/compatibility titles are also recognized, except the ambiguous bare name Naga. Add the marker to an unusually named manual issue to ensure it is recognized. Arbitrary prose cannot be matched reliably.
- Existing issues receive no repeated comments. Closed issues suppress future creation as well. Deleting an issue does not erase its stored receipt.
- The client remembers successful receipts across restarts; changing its configured endpoint resets that delivery cache. Network failures back off from one minute to one day, with server retry hints honored.

GitHub issue creation has no atomic create-if-absent operation. The Worker records a pending attempt **before** posting. If GitHub's response is lost, it searches again and recovers the existing issue. If the outcome remains ambiguous, it leaves the attempt pending instead of risking a duplicate. A maintainer must inspect GitHub and the Durable Object record before clearing a permanently unresolved `report:<VID>:<PID>` record. A human can still create a duplicate during the check/create window; the coordinator serializes this service's requests only.

## Abuse limits and operations

The endpoint is public so users need no accounts. Hardware claims cannot be authenticated solely from an anonymous desktop report. Both client and server allowlist fields; request bodies are limited to 8 KiB. The service caps its queue at 16, incoming coordinator requests at 120/minute, uncached GitHub scans at 10/minute, and new issue attempts at 20/day. Persistent counters protect scan/creation budgets; the incoming rate limit is in-memory and resets with the object. The service never accepts a caller-selected repository, title, or issue body. Logs are disabled in the Worker configuration.

These limits bound GitHub spam but do not prevent deliberate exhaustion of free Cloudflare quotas. On Workers Free, exhausted quotas fail rather than incur overage charges. The app retries later. Avoid enabling paid plans without separately reviewing limits and billing.

Run `node --test test/*.test.cjs` from the project root for automated tests. They use simulated GitHub responses and do not open real issues. Run `npm run check` from `worker` to verify the deployable bundle. Repeat the live end-to-end verification after changing deployment or authentication. GitHub requests use `redirect: 'manual'` because the Cloudflare runtime does not support `'error'`; non-success responses are rejected, so credentials are never forwarded to redirect destinations. Ad hoc `wrangler tail` sessions can inspect sanitized failure messages even though persistent observability logs remain disabled.

References: [GitHub Issues API](https://docs.github.com/en/rest/issues/issues), [Cloudflare Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
