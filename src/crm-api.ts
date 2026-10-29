import { uispRequest, type UispRequest } from './client.js';
import { asCollection } from './crm-format.js';
import type { UispCredentials, UispResponse } from './types.js';

export interface CrmPageParams {
  limit: number;
  offset: number;
}

export interface SearchClientsParams extends CrmPageParams {
  query?: string;
  email?: string;
  phone?: string;
  customId?: string;
}

export interface ListInvoicesParams extends CrmPageParams {
  clientId?: number;
  statuses?: number[];
  overdue?: boolean;
  createdDateFrom?: string;
  createdDateTo?: string;
  number?: string;
  order?: 'clientFirstName' | 'clientLastName' | 'createdDate' | 'number';
  direction?: 'ASC' | 'DESC';
}

export interface ListPaymentsParams extends CrmPageParams {
  clientId?: number;
  createdDateFrom?: string;
  createdDateTo?: string;
}

export interface ListServicesParams extends CrmPageParams {
  clientId?: number;
  statuses?: number[];
}

function crmGet(creds: UispCredentials, path: string, query?: Record<string, unknown>): Promise<UispResponse> {
  const request: UispRequest = { api: 'crm', method: 'GET', path, query };
  return uispRequest(creds, request);
}

/** GET /clients — filter by name (`query`), email, phone, or custom id (`userIdent`). */
export function searchClients(creds: UispCredentials, params: SearchClientsParams): Promise<UispResponse> {
  return crmGet(creds, '/clients', {
    query: params.query,
    email: params.email,
    phone: params.phone,
    userIdent: params.customId,
    limit: params.limit,
    offset: params.offset,
  });
}

/** GET /clients/{id} — includes accountBalance, accountCredit, and accountOutstanding. */
export function getClient(creds: UispCredentials, id: number): Promise<UispResponse> {
  return crmGet(creds, `/clients/${encodeURIComponent(String(id))}`);
}

/** GET /clients/services — services for one client, including the linked NMS site id. */
export function listServices(creds: UispCredentials, params: ListServicesParams): Promise<UispResponse> {
  return crmGet(creds, '/clients/services', {
    clientId: params.clientId,
    'statuses[]': params.statuses,
    limit: params.limit,
    offset: params.offset,
  });
}

/** GET /clients/services/{id} */
export function getService(creds: UispCredentials, id: number): Promise<UispResponse> {
  return crmGet(creds, `/clients/services/${encodeURIComponent(String(id))}`);
}

/**
 * GET /invoices. `statuses[]` is the blueprint's array parameter.
 * `overdue=1` is the documented overdue filter. Status values are the
 * InvoiceStatus enum (0 draft … 5 processed proforma), not a boolean.
 */
export function listInvoices(creds: UispCredentials, params: ListInvoicesParams): Promise<UispResponse> {
  return crmGet(creds, '/invoices', {
    clientId: params.clientId,
    'statuses[]': params.statuses,
    overdue: params.overdue ? 1 : undefined,
    createdDateFrom: params.createdDateFrom,
    createdDateTo: params.createdDateTo,
    number: params.number,
    limit: params.limit,
    offset: params.offset,
    order: params.order ?? 'createdDate',
    direction: params.direction ?? 'DESC',
  });
}

/** GET /invoices/{id} */
export function getInvoice(creds: UispCredentials, id: number): Promise<UispResponse> {
  return crmGet(creds, `/invoices/${encodeURIComponent(String(id))}`);
}

/** GET /payments */
export function listPayments(creds: UispCredentials, params: ListPaymentsParams): Promise<UispResponse> {
  return crmGet(creds, '/payments', {
    clientId: params.clientId,
    createdDateFrom: params.createdDateFrom,
    createdDateTo: params.createdDateTo,
    limit: params.limit,
    offset: params.offset,
    order: 'createdDate',
    direction: 'DESC',
  });
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;

/**
 * Walk a CRM collection with limit/offset until a short page or `maxPages`.
 * `truncated` is true when the cap was hit on a full page, so the caller
 * must not treat the result as exhaustive.
 */
export async function fetchAllCrmPages(
  fetchPage: (limit: number, offset: number) => Promise<unknown>,
  path: string,
  options?: { pageSize?: number; maxPages?: number }
): Promise<{ rows: unknown[]; truncated: boolean }> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: unknown[] = [];
  for (let page = 0; page < maxPages; page++) {
    const body = await fetchPage(pageSize, page * pageSize);
    const batch = asCollection(body, path);
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
