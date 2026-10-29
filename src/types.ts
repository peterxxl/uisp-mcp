/**
 * UISP authenticates with a static account token, generated in the UISP
 * console (Settings -> Users -> API tokens; tokens can be issued in
 * read-only or read/write mode) and sent as the `x-auth-token` header.
 * Unlike most connectors in this fleet, UISP has no shared multi-tenant
 * endpoint - every deployment, including Ubiquiti's own hosted-cloud tier,
 * runs at its own instance FQDN - so a base URL is a required part of the
 * credential, not an optional self-hosted override. See README's
 * Authentication section.
 */
export interface UispCredentials {
  /** NMS account token sent as `x-auth-token`. Empty when the caller only has a CRM app key. */
  apiKey: string;
  /** Instance origin, e.g. `https://uisp.example.com`. */
  baseUrl: string;
  /** CRM app key sent as `X-Auth-App-Key`. Separate from the NMS token. */
  crmAppKey?: string;
  /** CRM origin. Defaults to `baseUrl` when unset. */
  crmBaseUrl?: string;
}

/** Thrown when UISP rejects the API token (HTTP 401/403) - distinct from rate limiting so callers get an honest error. */
export class UispAuthError extends Error {}

/** Thrown when UISP rate-limits the request (HTTP 429) - distinct from an auth failure. */
export class UispRateLimitError extends Error {}

/** Thrown for any other non-2xx / unexpected vendor response. */
export class UispApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Thrown when a tool argument or path segment is missing or unsafe. Never reaches the network. */
export class UispValidationError extends Error {}

/** Shared `count`/`page` pagination params, present on every UISP list endpoint that paginates. */
export interface PageParams {
  count: number;
  page: number;
}

export interface ListSitesParams {
  id?: string[];
  ip?: string;
  deviceId?: string;
  type?: 'site' | 'endpoint' | 'client';
  ucrm?: boolean;
  ucrmDetails?: boolean;
}

export interface GetSiteParams {
  id: string;
  ucrmDetails?: boolean;
}

export interface SearchSitesParams extends PageParams {
  query?: string;
  type?: 'site' | 'endpoint' | 'client';
  ucrm?: boolean;
  latitude?: number;
  longitude?: number;
}

export interface SiteIntervalParams {
  siteId: string;
  interval: 'hour' | 'day' | 'month';
}

export interface ListDevicesParams {
  siteId?: string;
  withInterfaces?: boolean;
  authorized?: boolean;
  type?: string[];
  role?: string[];
}

export interface GetDeviceDetailParams {
  id: string;
  withStations?: boolean;
}

export interface GetDeviceStatisticsParams {
  id: string;
  interval: 'hour' | 'day' | 'month' | 'quarter' | 'year';
}

export interface ListOutagesParams extends PageParams {
  deviceId?: string;
  period?: number;
  query?: string;
  type?: 'outage' | 'unreachable';
  inProgress?: boolean;
}

export interface ListLogsParams extends PageParams {
  siteId?: string;
  deviceId?: string[];
  level?: 'info' | 'warning' | 'error';
  tag?: string;
  period?: number;
  query?: string;
}

export interface ListDataLinksParams {
  siteLinksOnly?: boolean;
}

export interface ListTasksParams extends PageParams {
  status?: 'success' | 'failed' | 'in-progress' | 'canceled' | 'queued';
  period?: number;
}

export interface GetNetworkStatisticsParams {
  interval: 'hour' | 'day' | 'month' | 'quarter' | 'year';
  siri?: boolean;
}

export interface GetSummaryParams {
  logsLevel: Array<'info' | 'warning' | 'error'>;
  outagesTimestamp?: number;
  logsTimestamp?: number;
  firmwaresTimestamp?: number;
}

/**
 * UISP API v2.1 response bodies are passed through as received - this
 * connector doesn't re-model UISP's full field set, only what a caller
 * needs to page and chain calls. See each tool's own JSDoc.
 */
export type UispResponse = unknown;
