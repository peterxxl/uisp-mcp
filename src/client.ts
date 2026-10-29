import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './utils/logger.js';
import { UispApiError, UispAuthError, UispRateLimitError, UispValidationError } from './types.js';
import type {
  GetDeviceDetailParams,
  GetDeviceStatisticsParams,
  GetNetworkStatisticsParams,
  GetSiteParams,
  GetSummaryParams,
  ListDataLinksParams,
  ListDevicesParams,
  ListLogsParams,
  ListOutagesParams,
  ListSitesParams,
  ListTasksParams,
  SearchSitesParams,
  SiteIntervalParams,
  UispCredentials,
  UispResponse,
} from './types.js';

export type UispApiName = 'nms' | 'crm';
export type UispMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';

export interface UispRequest {
  api: UispApiName;
  method?: UispMethod;
  /** Path under the API prefix, beginning with `/`. Path parameters must already be encoded. */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
}

const NMS_PREFIX = '/nms/api/v2.1';
const CRM_PREFIX = '/crm/api/v1.0';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Initial attempt plus two retries. Only idempotent GETs are retried. */
const GET_MAX_ATTEMPTS = 3;

// Request-scoped credential store. In gateway mode the HTTP layer runs each
// request inside runWithCredentials({apiKey, baseUrl}); getCredentials()
// reads from it. Falls back to process.env for stdio/single-tenant mode.
const credStore = new AsyncLocalStorage<UispCredentials>();

export function runWithCredentials<T>(creds: UispCredentials, fn: () => T): T {
  return credStore.run(creds, fn);
}

export function getCredentials(): UispCredentials | null {
  const scoped = credStore.getStore();
  if (scoped?.baseUrl && (scoped.apiKey || scoped.crmAppKey)) {
    return {
      apiKey: scoped.apiKey ?? '',
      baseUrl: scoped.baseUrl,
      crmAppKey: scoped.crmAppKey,
      crmBaseUrl: scoped.crmBaseUrl || scoped.baseUrl,
    };
  }
  const apiKey = process.env.UISP_API_KEY;
  const baseUrl = process.env.UISP_BASE_URL;
  const crmAppKey = process.env.UISP_CRM_APP_KEY;
  const crmBaseUrl = process.env.UISP_CRM_BASE_URL || baseUrl;
  const resolvedBase = baseUrl || crmBaseUrl;
  if (!resolvedBase || (!apiKey && !crmAppKey)) {
    logger.warn('Missing credentials', {
      hasApiKey: !!apiKey,
      hasBaseUrl: !!baseUrl,
      hasCrmKey: !!crmAppKey,
    });
    return null;
  }
  return {
    apiKey: apiKey || '',
    baseUrl: resolvedBase,
    crmAppKey,
    crmBaseUrl: crmBaseUrl || resolvedBase,
  };
}

function buildQuery(params: Record<string, unknown> = {}): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, String(v));
      continue;
    }
    qs.append(key, String(value));
  }
  return qs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSafeBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new UispValidationError('UISP base URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UispValidationError('UISP base URL must use http or https');
  }
  if (url.username || url.password) {
    throw new UispValidationError('UISP base URL must not include embedded credentials');
  }
  if (!url.hostname) {
    throw new UispValidationError('UISP base URL is missing a host');
  }
  return url;
}

/** Origin plus any non-API path prefix. Strips a trailing `/nms/api/v2.1` or `/crm/api/v1.0` so callers can pass either the console origin or a full API base. */
function normalizeOrigin(baseUrl: string): string {
  const url = assertSafeBaseUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/, '').replace(/\/nms\/api\/v2\.1$/, '').replace(/\/crm\/api\/v1\.0$/, '');
  return `${url.origin}${path}`;
}

function assertRelativePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new UispValidationError('API path must be a single relative path');
  }
  const segments = path.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new UispValidationError('API path contains invalid percent-encoding');
    }
    if (
      decoded === '' ||
      decoded === '.' ||
      decoded === '..' ||
      decoded === 'undefined' ||
      decoded === 'null' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    ) {
      throw new UispValidationError('API path contains an unsafe segment');
    }
  }
  return path;
}

function resolveTarget(creds: UispCredentials, api: UispApiName): { origin: string; prefix: string; headers: Record<string, string> } {
  if (api === 'nms') {
    if (!creds.apiKey || !creds.baseUrl) {
      throw new UispAuthError('UISP NMS failed: missing credentials. Set UISP_API_KEY and UISP_BASE_URL.');
    }
    return {
      origin: normalizeOrigin(creds.baseUrl),
      prefix: NMS_PREFIX,
      headers: { 'x-auth-token': creds.apiKey, Accept: 'application/json' },
    };
  }
  const crmBase = creds.crmBaseUrl || creds.baseUrl;
  if (!creds.crmAppKey || !crmBase) {
    throw new UispAuthError('UISP CRM failed: missing credentials. Set UISP_CRM_APP_KEY and UISP_BASE_URL (or UISP_CRM_BASE_URL).');
  }
  return {
    origin: normalizeOrigin(crmBase),
    prefix: CRM_PREFIX,
    headers: { 'X-Auth-App-Key': creds.crmAppKey, Accept: 'application/json' },
  };
}

function retryDelayMs(attempt: number, response?: Response): number {
  // Tests assert retry counts; they should not wait on the production backoff.
  if (process.env.VITEST === 'true') return 0;
  const header = response?.headers.get('retry-after');
  if (header && /^\d{1,3}$/.test(header.trim())) {
    return Math.min(Number(header.trim()) * 1000, 2_000);
  }
  return Math.min(200 * 2 ** attempt, 2_000);
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function apiLabel(api: UispApiName): 'NMS' | 'CRM' {
  return api === 'crm' ? 'CRM' : 'NMS';
}

/** One shape for both APIs: `UISP NMS /path failed: HTTP 401`. The body is never included. */
export function uispFailure(api: UispApiName, path: string, detail: string): string {
  return `UISP ${apiLabel(api)} ${path} failed: ${detail}`;
}

function networkError(err: unknown, api: UispApiName, path: string): Error {
  if (isTimeout(err)) return new UispApiError(uispFailure(api, path, 'timeout'));
  return new UispApiError(uispFailure(api, path, 'network'));
}

async function readJsonBody(res: Response, api: UispApiName, path: string): Promise<UispResponse> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as UispResponse;
  } catch {
    throw new UispApiError(uispFailure(api, path, `non-JSON body (HTTP ${res.status})`), res.status);
  }
}

function throwForStatus(res: Response, api: UispApiName, path: string): void {
  // 401/403 and 429 stay distinct classes. The wording matches every other
  // failure: `UISP NMS|CRM <path> failed: HTTP <status>`.
  if (res.status === 401 || res.status === 403) {
    throw new UispAuthError(uispFailure(api, path, `HTTP ${res.status}`));
  }
  if (res.status === 429) {
    throw new UispRateLimitError(uispFailure(api, path, 'HTTP 429'));
  }
  if (!res.ok) {
    throw new UispApiError(uispFailure(api, path, `HTTP ${res.status}`), res.status);
  }
}

/**
 * Issue one UISP NMS or CRM request.
 *
 * GET is retried on HTTP 429/5xx and on timeout (idempotent). POST/PUT/PATCH
 * are never retried. Logs include the API name, path, and status only — never
 * the token, app key, query string, request body, or response body.
 */
export async function uispRequest(creds: UispCredentials, request: UispRequest): Promise<UispResponse> {
  const method = request.method ?? 'GET';
  const target = resolveTarget(creds, request.api);
  const path = assertRelativePath(request.path);
  const qs = request.query ? buildQuery(request.query).toString() : '';
  const url = `${target.origin}${target.prefix}${path}${qs ? `?${qs}` : ''}`;
  const headers = { ...target.headers };
  let body: string | undefined;
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(request.body);
  }
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = method === 'GET' ? GET_MAX_ATTEMPTS : 1;

  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastNetworkError = err;
      if (method === 'GET' && attempt < maxAttempts - 1 && isTimeout(err)) {
        logger.warn('UISP GET retry after timeout', { api: request.api, path, attempt: attempt + 1 });
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw networkError(err, request.api, path);
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (method === 'GET' && retryable && attempt < maxAttempts - 1) {
      logger.warn('UISP GET retry', { api: request.api, path, status: res.status, attempt: attempt + 1 });
      await res.body?.cancel().catch(() => undefined);
      await sleep(retryDelayMs(attempt, res));
      continue;
    }

    throwForStatus(res, request.api, path);
    return readJsonBody(res, request.api, path);
  }

  throw networkError(lastNetworkError, request.api, path);
}

async function doGet(
  creds: UispCredentials,
  path: string,
  query?: Record<string, unknown>
): Promise<UispResponse> {
  return uispRequest(creds, { api: 'nms', method: 'GET', path, query });
}

// ---------------------------------------------------------------------
// System
// ---------------------------------------------------------------------

/** GET /nms/version - UISP version, deployment type and build. Cheapest authenticated read; useful as a credential sanity check. */
export async function getVersion(creds: UispCredentials): Promise<UispResponse> {
  return doGet(creds, '/nms/version');
}

/** GET /nms/statistics - network-wide statistics (client/site counts, network health, signal/link scores, outages). */
export async function getNetworkStatistics(creds: UispCredentials, params: GetNetworkStatisticsParams): Promise<UispResponse> {
  return doGet(creds, '/nms/statistics', { ...params });
}

/** GET /nms/summary - badge-count-like values across the instance (unread logs/outages/firmwares, active client/site counts). */
export async function getSummary(creds: UispCredentials, params: GetSummaryParams): Promise<UispResponse> {
  return doGet(creds, '/nms/summary', { ...params });
}

// ---------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------

/** GET /sites - list sites (network locations, each optionally tied to a UCRM client/service record). */
export async function listSites(creds: UispCredentials, params: ListSitesParams = {}): Promise<UispResponse> {
  return doGet(creds, '/sites', { ...params });
}

/** GET /sites/{id} - a single site's detail, including its identification and (if linked) UCRM client/service reference. */
export async function getSite(creds: UispCredentials, { id, ucrmDetails }: GetSiteParams): Promise<UispResponse> {
  return doGet(creds, `/sites/${encodeURIComponent(id)}`, { ucrmDetails });
}

/** GET /sites/search - search sites/endpoints/clients by name, address, MAC address or IP address. */
export async function searchSites(creds: UispCredentials, params: SearchSitesParams): Promise<UispResponse> {
  return doGet(creds, '/sites/search', { ...params });
}

/** GET /sites/{id}/clients - list of all client sites belonging to a given (parent) site. */
export async function listSiteClients(creds: UispCredentials, id: string): Promise<UispResponse> {
  return doGet(creds, `/sites/${encodeURIComponent(id)}/clients`);
}

/** GET /sites/{siteId}/statistics - upload/download traffic between a site and its parent site, bucketed by interval. */
export async function getSiteStatistics(creds: UispCredentials, { siteId, interval }: SiteIntervalParams): Promise<UispResponse> {
  return doGet(creds, `/sites/${encodeURIComponent(siteId)}/statistics`, { interval });
}

/** GET /sites/{siteId}/traffic/summary - a site's total upload/download for the given interval up to now. */
export async function getSiteTrafficSummary(creds: UispCredentials, { siteId, interval }: SiteIntervalParams): Promise<UispResponse> {
  return doGet(creds, `/sites/${encodeURIComponent(siteId)}/traffic/summary`, { interval });
}

// ---------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------

/** GET /devices - list devices (hostname/IP/MAC, status, parent site), optionally filtered by site/type/role/authorization. */
export async function listDevices(creds: UispCredentials, params: ListDevicesParams = {}): Promise<UispResponse> {
  return doGet(creds, '/devices', { ...params });
}

/** GET /devices/{id} - a single device's status overview. */
export async function getDevice(creds: UispCredentials, id: string): Promise<UispResponse> {
  return doGet(creds, `/devices/${encodeURIComponent(id)}`);
}

/** GET /devices/{id}/detail - a single device's detail, optionally including its interfaces and/or connected stations. */
export async function getDeviceDetail(creds: UispCredentials, { id, withStations }: GetDeviceDetailParams): Promise<UispResponse> {
  return doGet(creds, `/devices/${encodeURIComponent(id)}/detail`, { withStations });
}

/** GET /devices/{id}/statistics - device telemetry (CPU/RAM/signal/temperature/throughput) bucketed by interval. */
export async function getDeviceStatistics(creds: UispCredentials, { id, interval }: GetDeviceStatisticsParams): Promise<UispResponse> {
  return doGet(creds, `/devices/${encodeURIComponent(id)}/statistics`, { interval });
}

/** GET /devices/{deviceId}/interfaces - a device's network interfaces, including their configured IP addresses. */
export async function listDeviceInterfaces(creds: UispCredentials, deviceId: string): Promise<UispResponse> {
  return doGet(creds, `/devices/${encodeURIComponent(deviceId)}/interfaces`);
}

/** GET /devices/mac/{mac} - look up a device by its MAC address. */
export async function getDeviceByMac(creds: UispCredentials, mac: string): Promise<UispResponse> {
  return doGet(creds, `/devices/mac/${encodeURIComponent(mac)}`);
}

/** GET /devices/discovered - devices UISP has discovered on the network but not yet added. */
export async function listDiscoveredDevices(creds: UispCredentials): Promise<UispResponse> {
  return doGet(creds, '/devices/discovered');
}

// ---------------------------------------------------------------------
// Outages
// ---------------------------------------------------------------------

/** GET /outages - list network outages (UISP's alerting surface), optionally filtered by device/type/in-progress state. */
export async function listOutages(creds: UispCredentials, params: ListOutagesParams): Promise<UispResponse> {
  return doGet(creds, '/outages', { ...params });
}

// ---------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------

/** GET /logs - the UISP event/audit log, optionally filtered by site/device/level/tag. */
export async function listLogs(creds: UispCredentials, params: ListLogsParams): Promise<UispResponse> {
  return doGet(creds, '/logs', { ...params });
}

// ---------------------------------------------------------------------
// Data Links
// ---------------------------------------------------------------------

/** GET /data-links - list data links (the wireless/wired links UISP has mapped between devices and sites). */
export async function listDataLinks(creds: UispCredentials, params: ListDataLinksParams = {}): Promise<UispResponse> {
  return doGet(creds, '/data-links', { ...params });
}

/** GET /data-links/{id} - a single data link's detail. */
export async function getDataLink(creds: UispCredentials, id: string): Promise<UispResponse> {
  return doGet(creds, `/data-links/${encodeURIComponent(id)}`);
}

/** GET /data-links/sites/{siteId} - data links attached to a given site. */
export async function listSiteDataLinks(creds: UispCredentials, siteId: string): Promise<UispResponse> {
  return doGet(creds, `/data-links/sites/${encodeURIComponent(siteId)}`);
}

// ---------------------------------------------------------------------
// Gateways
// ---------------------------------------------------------------------

/** GET /gateways - list gateways (routers configured as network gateways) and their NetFlow/QoS/suspend configuration. */
export async function listGateways(creds: UispCredentials): Promise<UispResponse> {
  return doGet(creds, '/gateways');
}

/** GET /gateways/{id} - a single gateway's detail. */
export async function getGateway(creds: UispCredentials, id: string): Promise<UispResponse> {
  return doGet(creds, `/gateways/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------

/** GET /tasks - list background tasks (e.g. firmware upgrades, backups) and their status. */
export async function listTasks(creds: UispCredentials, params: ListTasksParams): Promise<UispResponse> {
  return doGet(creds, '/tasks', { ...params });
}

/** GET /tasks/in-progress - the number of tasks currently in progress. */
export async function getTasksInProgress(creds: UispCredentials): Promise<UispResponse> {
  return doGet(creds, '/tasks/in-progress');
}

// ---------------------------------------------------------------------
// Firmware
// ---------------------------------------------------------------------

/** GET /firmwares - firmware versions available to UISP for its supported device models. */
export async function listFirmwares(creds: UispCredentials): Promise<UispResponse> {
  return doGet(creds, '/firmwares');
}

// ---------------------------------------------------------------------
// Speed Test
// ---------------------------------------------------------------------

/** GET /speed-tests - detail on running/recent speed tests. */
export async function getSpeedTests(creds: UispCredentials): Promise<UispResponse> {
  return doGet(creds, '/speed-tests');
}
