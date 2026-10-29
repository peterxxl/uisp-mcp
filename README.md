# UISP MCP Server

MCP server for [Ubiquiti UISP](https://www.ui.com/software/uisp/)'s Network REST API (`/nms/api/v2.1`) and CRM REST API (`/crm/api/v1.0`) - sites, devices, outages, the event/audit log, data links, gateways, background tasks, firmware, speed tests, and CRM clients, services, invoices, and payments - for AI assistants and the WYRE Conduit gateway. One opt-in write tool can change a customer's home Wi-Fi password on an airCube or Wi-Fi ONU.

## Authentication

UISP Network authenticates with a static **account token**, generated in the UISP console under **Settings -> Users -> API tokens** (tokens can be issued in read-only or read/write mode - issue a read-only token unless you intentionally enable `uisp_set_wifi_password`). UISP has **no shared multi-tenant endpoint**: every deployment, including Ubiquiti's own hosted-cloud tier, runs at its own instance FQDN, so this connector requires **both** a token and a base URL. The token is sent as the `x-auth-token` header to `<base URL>/nms/api/v2.1/...`.

UISP CRM is a separate API on the same host, at `<base URL>/crm/api/v1.0/...`, authenticated with an **app key** (`X-Auth-App-Key`) from **CRM -> System -> Security -> App keys** (Read is enough for every CRM tool here). That key is not the NMS token. Set it with `UISP_CRM_APP_KEY`. `UISP_CRM_BASE_URL` overrides the host; when it is unset the CRM calls use `UISP_BASE_URL`.

In gateway mode NMS credentials arrive per request via `X-UISP-Api-Key` and `X-UISP-Base-URL`, and CRM credentials via `X-UISP-Crm-App-Key` and optional `X-UISP-Crm-Base-URL`. In local/stdio mode they are read once from the environment.

### Credential scope

**Vendor-documented, not independently verified against a live instance** (see Verification below): UISP's own console lets a token be issued in "Read Only" or "Read/Write" mode at creation time - a genuine, vendor-supported way to scope a token to reads before it's ever handed to this connector, unlike some vendors in this fleet whose keys always inherit their creating user's full permission set. With `UISP_ENABLE_WRITES` unset, this connector only issues `GET` requests. The single write (`uisp_set_wifi_password`) is omitted from the tool list until `UISP_ENABLE_WRITES=true`, and even then it PUTs only after `confirm: true`. Issuing a Read Only NMS token and a Read CRM app key is still the customer's guarantee: this process cannot downgrade a Read/Write credential UISP already minted.

A closely-related finding worth stating plainly: UISP is simultaneously a network-management platform and a lightweight ISP CRM (UCRM) - a `Site` in this API can carry a linked `ucrm.client` reference that includes the real customer's name, and `uisp_list_site_clients` returns customer records. Several tools are classified `isAdmin: true` specifically for this reason even though they read like plain infrastructure inventory - see Scope below and this connector's entry in Conduit's `vendor-config.ts` for the full accounting.

### Verification

The original NMS tools were built against UISP's generated OpenAPI/Swagger specification (title `UISP API`, `swagger: "2.0"`, `basePath: /nms/api/v2.1`, `securityDefinitions.UserSecurity` = the `x-auth-token` header). Every UISP installation publishes a live Swagger UI at `https://<instance>/nms/api-docs/`.

CRM tools follow the official CRM blueprint at [unmscrm.docs.apiary.io](https://unmscrm.docs.apiary.io) (also linked from Ubiquiti's [UISP CRM API Usage](https://help.uisp.com/hc/en-us/articles/22590956856087-UISP-CRM-API-Usage) article). Invoice status codes used here are that blueprint's `InvoiceStatus` enum: **0 Draft, 1 Unpaid, 2 Partially paid, 3 Paid, 4 Void, 5 Processed proforma**. Paid, void, draft, and processed-proforma invoices are never counted as overdue. `GET /invoices` filters used here (`clientId`, `statuses[]`, `overdue`, `createdDateFrom` / `createdDateTo`, `limit` / `offset`, `order` / `direction`) are the ones in that blueprint.

The home Wi-Fi write follows the NMS v2.1 operations `PUT /devices/aircubes/{id}/wireless` (`wifi2Ghz.key`, `wifi5Ghz.key`) and `PUT /devices/onus/{id}/wireless` (`key`, `key5g`). airMAX, airOS, airFiber, and Wave devices are refused because those keys are backbone links.

None of this was exercised against a live UISP console. Shapes, status codes, and the wireless PUT bodies are verified against those docs and against mocked HTTP tests only.

## Configuration

| Env var | Description |
|---|---|
| `UISP_API_KEY` | NMS account token (`x-auth-token`). Required for NMS tools and for `uisp_set_wifi_password`. |
| `UISP_BASE_URL` | Console origin, e.g. `https://uisp.example.com`. CRM calls use this host unless `UISP_CRM_BASE_URL` is set. |
| `UISP_CRM_APP_KEY` | CRM app key (`X-Auth-App-Key`). Required for CRM tools. Independent of `UISP_API_KEY`. |
| `UISP_CRM_BASE_URL` | Optional CRM origin. Defaults to `UISP_BASE_URL`. A trailing `/crm/api/v1.0` is accepted and not doubled. |
| `UISP_ENABLE_WRITES` | Must be the string `true` to advertise and allow `uisp_set_wifi_password`. Unset or any other value keeps the server read-only. The tool still dry-runs unless the call sets `confirm: true`. |
| `UISP_TIMEZONE` | IANA timezone for invoice day counts. Defaults to `Pacific/Easter` (Rapa Nui, UTC−6, no daylight saving). Set `dueDate` to count days in each invoice dueDate's own offset. Overdue itself follows the due instant, the same rule as CRM `overdue=1`. |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `MCP_HTTP_HOST` | HTTP bind address. Defaults to `127.0.0.1`. Set `0.0.0.0` only when something else authenticates the port (the Docker image does this for container port mapping). |
| `MCP_HTTP_PORT` | HTTP port. Defaults to `8080`. |
| `AUTH_MODE` | `env` (default, reads the vars above) or `gateway` (credentials arrive per-request via `X-UISP-Api-Key`, `X-UISP-Base-URL`, `X-UISP-Crm-App-Key`, and optional `X-UISP-Crm-Base-URL`). |
| `CONDUIT_S2S_SECRET` | When set, the HTTP transport requires a valid `X-Gateway-S2S` header (Conduit sidecar auth) on every `/mcp` request. |
| `LOG_LEVEL` | `debug` \| `info` (default) \| `warn` \| `error`. |

### Security

- HTTP mode binds to **127.0.0.1** unless `MCP_HTTP_HOST` is set. The Docker image sets `0.0.0.0` so published container ports work; do not publish that port on a host interface without `CONDUIT_S2S_SECRET` or another authenticator. This server does not authenticate MCP clients itself when `CONDUIT_S2S_SECRET` is unset.
- In gateway mode the caller-supplied base URL is the host this process will call. That is an SSRF foothold if the HTTP listener is reachable by anything other than the trusted gateway: a request can aim `X-UISP-Base-URL` or `X-UISP-Crm-Base-URL` at an internal service, and the NMS token or CRM app key is attached to that request. Keep gateway mode behind the gateway, and do not accept those headers from the public internet. Embedded userinfo in a base URL is rejected; private addresses are not, because a self-hosted UISP console often lives on a LAN.
- Logs record method, path, and status for retries, and an audit line for a confirmed Wi-Fi password change (device id, site id, client id, field names). They do not record tokens, app keys, query strings, request bodies, or response bodies. The new password is not returned by the tool.
- CRM list tools send `limit`/`offset` (default 100). Overdue and debtor summaries walk pages and stop after 20 full pages, with `truncated: true` when the cap is hit. Tool results are a reduced view (name, amounts, dates, status), not the raw CRM record (no bank accounts).

### Request limits

- HTTP request bodies are capped at 256 KiB (262144 bytes). After the `X-Gateway-S2S` check passes, a `Content-Length` above the cap returns 413 with a JSON-RPC error; bodies without `Content-Length` are capped by the MCP SDK transport. Unauthenticated requests still get 401 first.
- `tools/call` arguments are capped at 10,000 elements (every array item and object key at any depth). Larger inputs return an `isError` tool result and are never dispatched.

These limits address CVE-2026-111768 / GHSA-46jr-4wx8-v453 (memory exhaustion during validation) and GHSA-f897-62hf-6gxq (no request body / batch cap).

## Tools

### Sites
- `uisp_list_sites` - list sites (network locations - sites, endpoints, and clients - each optionally tied to a UCRM client/service record).
- `uisp_get_site` - get a single site's detail.
- `uisp_search_sites` - search sites/endpoints/clients by name, address, MAC address, or IP address.
- `uisp_list_site_clients` - list all client sites belonging to a given (parent) site.
- `uisp_get_site_statistics` - get upload/download traffic between a site and its parent site.
- `uisp_get_site_traffic_summary` - get a site's total upload/download for a given interval up to now.

### Devices
- `uisp_list_devices` - list devices (hostname/IP/MAC, status, parent site). Compact page of 50 by default; `detail: "full"` returns raw objects for that page. NMS does not page this endpoint, so the slice happens here.
- `uisp_get_device` - get a single device's status overview.
- `uisp_get_device_detail` - get a device's detail, optionally including interfaces and/or connected stations.
- `uisp_get_device_statistics` - device telemetry bucketed by `interval`. Returns the newest `limit` buckets (default 24; `period` is an alias) so the series stays small.
- `uisp_list_device_interfaces` - list a device's network interfaces, including configured IP addresses.
- `uisp_get_device_by_mac` - look up a device by its MAC address.
- `uisp_list_discovered_devices` - list devices discovered on the network but not yet added.

### Outages
- `uisp_list_outages` - list network outages - UISP's alerting surface - filterable by device, type, and in-progress state.

### Logs
- `uisp_list_logs` - list the UISP event/audit log (logins, device state changes, backups, upgrades).

### Data Links
- `uisp_list_data_links` - list data links. Compact page of 50 by default (endpoints, frequency, signal). `detail: "full"` keeps the raw link for that page.
- `uisp_get_data_link` - get a single data link's detail.
- `uisp_list_site_data_links` - data links for one site, with the same compact paging as `uisp_list_data_links`.

### Gateways
- `uisp_list_gateways` - list gateways (routers configured as network gateways) and their NetFlow/QoS/suspend configuration.
- `uisp_get_gateway` - get a single gateway's detail.

### Tasks
- `uisp_list_tasks` - list background tasks (firmware upgrades, backups, mass operations) and their status.
- `uisp_get_tasks_in_progress` - get the number of tasks currently in progress.

### Firmware
- `uisp_list_firmwares` - get the firmware versions available to UISP for its supported device models.

### Speed Test
- `uisp_get_speed_tests` - get detail about running and recent speed tests.

### System
- `uisp_get_version` - get the UISP version, deployment type, and build info. Useful as a credential/connectivity sanity check.
- `uisp_get_network_statistics` - network-wide statistics. `interval` is the UISP bucket; `limit` or `period` is how many recent buckets to return (default 24, newest first). Summary counts stay in the result.
- `uisp_get_summary` - get badge-count-like values across the instance (unread logs/outages/firmwares, active client/site counts).

### CRM
Read-only. Invoice status text uses the official codes above. `daysOverdue` is computed from the due date for status 1 (Unpaid) and 2 (Partially paid) only.

- `uisp_search_clients` - search clients by name (`query`), email, phone, or custom id (`userIdent`). At least one field is required.
- `uisp_get_client` - one client, including `accountBalance` (positive means credit, negative means the client owes), `accountCredit`, and `accountOutstanding`.
- `uisp_list_client_services` - a client's services, with service plan, status, and `unmsClientSiteId` when the service is linked to an NMS site.
- `uisp_list_invoices` - invoices for the whole network or one client. Defaults to newest first (`createdDate` DESC). Filters: `statuses`, `overdue`, `createdDateFrom` / `createdDateTo`. Rows include number, client, total, amountToPay, dueDate, status text, and days overdue. An invoice is overdue once its due instant has passed; `daysOverdue` is whole calendar days in `UISP_TIMEZONE`.
- `uisp_get_invoice` - one invoice.
- `uisp_list_overdue_invoices` - overdue invoices across pages, sorted by days overdue or amount still to pay. Paid invoices are dropped even if the server returned them.
- `uisp_list_debtors` - per-client totals for those overdue invoices, sorted by amount or days overdue.
- `uisp_list_payments` - payments for one client and/or a created-date range.
- `uisp_map_client_site` - CRM service `unmsClientSiteId` to the NMS site, and the NMS site's `ucrm.client` / `ucrm.service` back to CRM. CRM client and service ids are numbers. Provide `clientId`, `serviceId`, or `siteId`.

### Home Wi-Fi (opt-in write)
- `uisp_set_wifi_password` - resolve client, service, site, or device id to an airCube or Wi-Fi ONU and change the home Wi-Fi passphrase (8-63 characters). Listed only when `UISP_ENABLE_WRITES=true`. Default is a dry-run preview; the PUT runs only with `confirm: true`. airMAX, airOS, airFiber, and Wave devices are refused. The password is not logged or echoed.

## Scope

**Read-only by default.** The NMS surface is the original NOC/MSP monitoring workflow (site and device inventory, status, telemetry, outages, and the audit log): 27 `GET` operations. CRM adds read-only client, service, invoice, and payment reads, plus a client/site mapping. The only mutating tool is `uisp_set_wifi_password`, and it is absent from `tools/list` unless `UISP_ENABLE_WRITES=true`. UISP's own OpenAPI spec documents a much larger surface (full device configuration, user and API-token administration, backups, server administration). Everything not listed above stays excluded.

**Hard-excluded (device credential vault) - never implemented:** `GET /vault/credentials`, `/vault/credentials/devices`, `/vault/{deviceId}/credentials` - this is literally a store of device login credentials; excluded outright regardless of verb.

**Hard-excluded (API token / user / access-group administration - identity and credential management, not network data) - never implemented:** `GET /token`, `/token/{tokenId}`, `/users`, `/user`, `/user/totpauth`, `/access-groups/sites`, `/access-groups/sites/{groupId}`, `/nms/keep-alive`, `/nms/account/login/ubiquiti`.

**Hard-excluded (backups, restore, and support-bundle downloads - binary/sensitive, and restore is a write-adjacent maintenance action even where the read that feeds it is `GET`) - never implemented:** `GET /nms/backups`, `/nms/backups/{backupId}`, `/nms/backups/{backupId}/download-token`, `/nms/downloads/{token}`, `/nms/maintenance/backup`, `/nms/maintenance/backup/restore`, `/nms/maintenance/supportinfo`, `/devices/{deviceId}/backups`, `/devices/{deviceId}/backups/{backupId}`, `/devices/{id}/supportfile`.

**Hard-excluded (server administration and settings - can include mail-server/SMTP credentials and server-level config, not network/device data) - never implemented:** `GET /nms/settings`, `/nms/server-config`, `/nms/setup`, `/nms/mailserver`, `/nms/connection` (returns the UISP server's own connection key), `/nms/log-verbosity`, `/nms/update`, `/nms/update/log`, `/nms/traffic/blacklist`, `/nms/traffic/subnets`, `/nms/address`, `/nms/search`, `/nms/news`, `/nms/blog/posts`, `/nms/questionnaires/active`, `/nms/changed`, `/nms/server-time`, `/nms/heartbeat` (unauthenticated liveness only - `uisp_get_version` is this connector's authenticated sanity check instead).

**CRM writes, exports, and admin collections stay excluded.** Implemented CRM reads are only clients, client services, invoices, and payments (see Tools). Not implemented: creating or editing clients, services, invoices, or payments; `GET /crm/roles`; service-plan administration; GDPR export `GET /gdpr/clients/{id}`.

**Hard-excluded (GDPR/customer data export) - never implemented:** `GET /gdpr/clients/{id}` - a formatted export of one customer's personal data. CRM tools return a reduced client/invoice view, not this export.

**Hard-excluded (raw device pass-through / UDAPI proxy) - never implemented:** `GET /devices/{deviceId}/udapi/{version}/{udapiUrl*}` - a generic reverse-proxy into a device's own local API; UISP's own spec does not constrain this to `GET` semantics on the far side, so it is excluded as a category regardless of the outer verb, the same treatment `unifi-mcp` gives its analogous per-console connector-proxy path.

**Hard-excluded (network discovery control-plane) - never implemented:** `GET /discovery/scan-status`, `/discovery/status/{deviceId}` - status of an active network scan, which is triggered/controlled elsewhere in the API; excluded as part of that same discovery workflow rather than picked apart.

**Hard-excluded (deep per-device configuration: DHCP, firewall, routing, VLANs, NetFlow, and wireless config other than the opt-in home Wi-Fi password) - never implemented:** every `GET` under `/devices/erouters/*`, `/devices/uisprs/*` (DHCP leases/servers, firewall filters/mangles/NATs/sets/settings, OSPF, routes, NetFlow), `/devices/{id}/router/*`, `/devices/{id}/netflow`, `/devices/{id}/vlans`, `/devices/{id}/services`, `/devices/{id}/system`, `/devices/{id}/system/unms`, `/devices/{deviceId}/mac-table*`, `/devices/{deviceId}/interfaces/{interfaceName}`, `/devices/{deviceId}/interfaces/data-link/available`, `/devices/{deviceId}/location`, and the per-device-model detail/config/station endpoints (`/devices/aircubes/*`, `/airfibers/*`, `/airmaxes/*`, `/blackboxes/*`, `/epowers/*`, `/eswitches/*`, `/olts/*`, `/onus/*`, `/solarbeams/*`, `/toughswitches/*`, `/uispss/*`, `/waves/*`, plus `/devices/aps/profiles`, `/devices/ssids`, `/devices/models`, `/devices/macs`, `/devices/ips`, `/devices/unknown`, `/devices/import/status`), with one exception: when writes are enabled, `uisp_set_wifi_password` GETs and PUTs only `/devices/aircubes/{id}/wireless` or `/devices/onus/{id}/wireless` to change the passphrase. airMAX/airOS/airFiber/Wave wireless keys are never written. The rest of the device surface stays identity/status/telemetry/interfaces.

**Hard-excluded (site sub-resources beyond the core six) - never implemented:** `GET /sites/{id}/images`, `/sites/{siteId}/images/{imageId}` (binary), `/sites/{siteId}/qos`, `/sites/{siteId}/slastats` (UISP's own summary describes this as "for ISP and SLA score debugging"), `/sites/{siteId}/traffic`, `/sites/{siteId}/traffic/interval`, `/sites/traffic` (superseded for this connector's purposes by the implemented `uisp_get_site_traffic_summary`).

**Hard-excluded (planning/simulation and field-installation tooling - not live network state) - never implemented:** `GET /simulation`, `/simulation/devices`, `/simulation/links`, `/installations/devices`, `/installations/{id}`, `/installations/{id}/{mac}/configuration`.

**Hard-excluded (misc) - never implemented:** `GET /devices/{id}/router/*` (see above), `/tasks/{batchId}` (per-task item detail beyond the implemented list/in-progress-count), `/airlink/proxy/*` (RF link-planning map/elevation data files, unrelated to live network state), `/nms/version/latest` (checks for a newer UISP release; administrative, not monitoring data).

They can be added as a follow-up if there's demand, after a deliberate scope decision - not by default.

## Development

```bash
npm install
npm run build
npm test
npm run lint   # tsc --noEmit
```

## Docker

```bash
docker build -t uisp-mcp .
docker run -p 8080:8080 -e UISP_API_KEY=... -e UISP_BASE_URL=https://uisp.example.com uisp-mcp
```
