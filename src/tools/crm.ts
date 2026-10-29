import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getSite } from '../client.js';
import {
  fetchAllCrmPages,
  getClient,
  getInvoice,
  getService,
  listInvoices,
  listPayments,
  listServices,
  searchClients,
} from '../crm-api.js';
import {
  INVOICE_STATUS_LABELS,
  pageResult,
  sortInvoices,
  summarizeClient,
  summarizeDebtors,
  summarizeInvoice,
  summarizeInvoiceDetail,
  summarizePayment,
  summarizeService,
  type DebtorSort,
  type InvoiceSummary,
  type ServiceSummary,
} from '../crm-format.js';
import { asCollection } from '../crm-format.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCrmCredentials, requireCredentials, textResult } from './shared.js';
import type { UispCredentials } from '../types.js';

const CRM_PAGE = {
  limit: { type: 'number', description: 'Page size (1-500). Defaults to 100.' },
  offset: { type: 'number', description: 'Zero-based index of the first result. Defaults to 0.' },
} as const;

const STATUS_NOTE =
  'Invoice status codes from the UISP CRM API: 0 Draft, 1 Unpaid, 2 Partially paid, 3 Paid, 4 Void, 5 Processed proforma. Paid, void, draft, and processed-proforma invoices are never treated as overdue.';

export const CRM_TOOLS: Tool[] = [
  {
    name: 'uisp_search_clients',
    description:
      'Search UISP CRM clients by name (query, at least 2 characters), email, phone, or custom id (userIdent). Returns account balance, credit, and outstanding amount when the API includes them. At least one search field is required.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name search. CRM requires at least 2 characters.' },
        email: { type: 'string', description: 'Filter by contact email.' },
        phone: { type: 'string', description: 'Filter by contact phone.' },
        customId: { type: 'string', description: 'Client custom id (CRM userIdent), not the numeric client id.' },
        ...CRM_PAGE,
      },
    },
  },
  {
    name: 'uisp_get_client',
    description:
      'Get one CRM client, including accountBalance (positive means credit, negative means the client owes), accountCredit, and accountOutstanding.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Numeric CRM client id.' } },
      required: ['id'],
    },
  },
  {
    name: 'uisp_list_client_services',
    description:
      'List CRM services for a client: service plan, status, price, and the linked NMS site id (unmsClientSiteId) when the service is connected to a Network location.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Numeric CRM client id.' },
        statuses: {
          type: 'array',
          items: { type: 'number' },
          description: 'Service status filter. 0 Prepared, 1 Active, 2 Ended, 3 Suspended, 4 Prepared blocked, 5 Obsolete, 6 Deferred, 7 Quoted, 8 Inactive.',
        },
        ...CRM_PAGE,
      },
      required: ['clientId'],
    },
  },
  {
    name: 'uisp_list_invoices',
    description: `List CRM invoices for the whole network or one client. Filters: statuses (array of status codes), overdue, and createdDateFrom/createdDateTo (YYYY-MM-DD). ${STATUS_NOTE} Each row includes number, client, total, amountToPay, dueDate, a human-readable status, and daysOverdue.`,
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Limit to this CRM client.' },
        statuses: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 5 },
          description: 'Invoice status codes: 0 Draft, 1 Unpaid, 2 Partially paid, 3 Paid, 4 Void, 5 Processed proforma.',
        },
        overdue: { type: 'boolean', description: 'When true, ask CRM for overdue invoices (unpaid or partially paid and past due).' },
        createdDateFrom: { type: 'string', description: 'Inclusive created-date lower bound, YYYY-MM-DD.' },
        createdDateTo: { type: 'string', description: 'Inclusive created-date upper bound, YYYY-MM-DD.' },
        number: { type: 'string', description: 'Invoice number.' },
        order: { type: 'string', enum: ['clientFirstName', 'clientLastName', 'createdDate', 'number'] },
        direction: { type: 'string', enum: ['ASC', 'DESC'] },
        ...CRM_PAGE,
      },
    },
  },
  {
    name: 'uisp_get_invoice',
    description: `Get one CRM invoice by id. ${STATUS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Numeric CRM invoice id.' } },
      required: ['id'],
    },
  },
  {
    name: 'uisp_list_overdue_invoices',
    description:
      'List overdue CRM invoices (status Unpaid or Partially paid, due date before today, amount still to pay). Walks CRM pages. Paid invoices are excluded even if a due date is in the past. Sort by days overdue or amount still to pay.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Limit to this CRM client.' },
        createdDateFrom: { type: 'string', description: 'Inclusive created-date lower bound, YYYY-MM-DD.' },
        createdDateTo: { type: 'string', description: 'Inclusive created-date upper bound, YYYY-MM-DD.' },
        sort: { type: 'string', enum: ['amount', 'days'], description: 'Sort. Defaults to days (most overdue first).' },
      },
    },
  },
  {
    name: 'uisp_list_debtors',
    description:
      'Summarize clients with overdue invoices: invoice count, total still to pay, and the oldest/max days overdue. Sorted by amount still to pay or by days overdue. Paid invoices are not included.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Limit to this CRM client.' },
        createdDateFrom: { type: 'string', description: 'Inclusive created-date lower bound, YYYY-MM-DD.' },
        createdDateTo: { type: 'string', description: 'Inclusive created-date upper bound, YYYY-MM-DD.' },
        sort: { type: 'string', enum: ['amount', 'days'], description: 'Sort. Defaults to amount (largest balance first).' },
      },
    },
  },
  {
    name: 'uisp_list_payments',
    description: 'List CRM payments, optionally for one client and/or a created-date range (YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Limit to this CRM client.' },
        createdDateFrom: { type: 'string', description: 'Inclusive created-date lower bound, YYYY-MM-DD.' },
        createdDateTo: { type: 'string', description: 'Inclusive created-date upper bound, YYYY-MM-DD.' },
        ...CRM_PAGE,
      },
    },
  },
  {
    name: 'uisp_map_client_site',
    description:
      'Map a CRM client or service to its NMS site, or an NMS site back to the CRM client and service. CRM services expose unmsClientSiteId; NMS sites expose ucrm.client and ucrm.service when ucrmDetails is requested. Provide at least one of clientId, serviceId, or siteId.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Numeric CRM client id.' },
        serviceId: { type: 'number', description: 'Numeric CRM service id.' },
        siteId: { type: 'string', description: 'NMS site id.' },
      },
    },
  },
];

const TOOL_NAMES = new Set(CRM_TOOLS.map((tool) => tool.name));
export function isCrmTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function collectOverdue(creds: UispCredentials, args: Record<string, unknown>): Promise<{ invoices: InvoiceSummary[]; truncated: boolean }> {
  const clientId = args.clientId as number | undefined;
  const createdDateFrom = args.createdDateFrom as string | undefined;
  const createdDateTo = args.createdDateTo as string | undefined;
  const { rows, truncated } = await fetchAllCrmPages(
    (limit, offset) =>
      listInvoices(creds, {
        clientId,
        statuses: [1, 2],
        overdue: true,
        createdDateFrom,
        createdDateTo,
        limit,
        offset,
      }),
    '/invoices'
  );
  const now = new Date();
  const invoices = rows
    .map((row) => summarizeInvoice(row, now))
    .filter((invoice) => invoice.overdue);
  return { invoices, truncated };
}

function siteUcrm(raw: unknown): {
  id: string | null;
  name: string | null;
  type: string | null;
  crmClientId: string | null;
  crmClientName: string | null;
  crmServiceId: string | null;
  crmServiceName: string | null;
} {
  if (!isRecord(raw)) {
    return { id: null, name: null, type: null, crmClientId: null, crmClientName: null, crmServiceId: null, crmServiceName: null };
  }
  const identification = isRecord(raw.identification) ? raw.identification : {};
  const ucrm = isRecord(raw.ucrm) ? raw.ucrm : isRecord(identification.ucrm) ? identification.ucrm : {};
  const client = isRecord(ucrm.client) ? ucrm.client : {};
  const service = isRecord(ucrm.service) ? ucrm.service : {};
  const id = raw.id ?? identification.id;
  return {
    id: id != null ? String(id) : null,
    name: typeof identification.name === 'string' ? identification.name : null,
    type: typeof identification.type === 'string' ? identification.type : null,
    crmClientId: client.id != null ? String(client.id) : null,
    crmClientName: typeof client.name === 'string' ? client.name : null,
    crmServiceId: service.id != null ? String(service.id) : null,
    crmServiceName: typeof service.name === 'string' ? service.name : null,
  };
}

export async function handleCrmTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();

  try {
    args = parseToolArgs(name, args);
    if (name !== 'uisp_map_client_site') {
      const missing = requireCrmCredentials(creds);
      if (missing) return missing;
    }

    if (name === 'uisp_search_clients') {
      const limit = args.limit as number;
      const offset = args.offset as number;
      const body = await searchClients(creds!, {
        query: args.query as string | undefined,
        email: args.email as string | undefined,
        phone: args.phone as string | undefined,
        customId: args.customId as string | undefined,
        limit,
        offset,
      });
      const items = asCollection(body, '/clients').map((row) => summarizeClient(row));
      return textResult(pageResult(items, limit, offset));
    }

    if (name === 'uisp_get_client') {
      return textResult(summarizeClient(await getClient(creds!, args.id as number)));
    }

    if (name === 'uisp_list_client_services') {
      const limit = args.limit as number;
      const offset = args.offset as number;
      const body = await listServices(creds!, {
        clientId: args.clientId as number,
        statuses: args.statuses as number[] | undefined,
        limit,
        offset,
      });
      const items = asCollection(body, '/clients/services').map((row) => summarizeService(row));
      return textResult(pageResult(items, limit, offset));
    }

    if (name === 'uisp_list_invoices') {
      const limit = args.limit as number;
      const offset = args.offset as number;
      const body = await listInvoices(creds!, {
        clientId: args.clientId as number | undefined,
        statuses: args.statuses as number[] | undefined,
        overdue: args.overdue as boolean | undefined,
        createdDateFrom: args.createdDateFrom as string | undefined,
        createdDateTo: args.createdDateTo as string | undefined,
        number: args.number as string | undefined,
        order: args.order as 'clientFirstName' | 'clientLastName' | 'createdDate' | 'number' | undefined,
        direction: args.direction as 'ASC' | 'DESC' | undefined,
        limit,
        offset,
      });
      const rows = asCollection(body, '/invoices');
      const summarized = rows.map((row) => summarizeInvoice(row));
      // When the caller asked for overdue invoices, drop anything that is not
      // actually overdue. A paid invoice (status 3) must not survive this filter.
      const items = args.overdue ? summarized.filter((invoice) => invoice.overdue) : summarized;
      return textResult({
        ...pageResult(items, limit, offset),
        returned: items.length,
        hasMore: rows.length === limit,
        statusCodes: INVOICE_STATUS_LABELS,
      });
    }

    if (name === 'uisp_get_invoice') {
      return textResult(summarizeInvoiceDetail(await getInvoice(creds!, args.id as number)));
    }

    if (name === 'uisp_list_overdue_invoices') {
      const sort = (args.sort as DebtorSort) ?? 'days';
      const { invoices, truncated } = await collectOverdue(creds!, args);
      return textResult({
        sort,
        truncated,
        statusCodes: INVOICE_STATUS_LABELS,
        returned: invoices.length,
        invoices: sortInvoices(invoices, sort),
      });
    }

    if (name === 'uisp_list_debtors') {
      const sort = (args.sort as DebtorSort) ?? 'amount';
      const { invoices, truncated } = await collectOverdue(creds!, args);
      return textResult({
        sort,
        truncated,
        statusCodes: INVOICE_STATUS_LABELS,
        ...summarizeDebtors(invoices, sort),
      });
    }

    if (name === 'uisp_list_payments') {
      const limit = args.limit as number;
      const offset = args.offset as number;
      const body = await listPayments(creds!, {
        clientId: args.clientId as number | undefined,
        createdDateFrom: args.createdDateFrom as string | undefined,
        createdDateTo: args.createdDateTo as string | undefined,
        limit,
        offset,
      });
      const items = asCollection(body, '/payments').map((row) => summarizePayment(row));
      return textResult(pageResult(items, limit, offset));
    }

    if (name === 'uisp_map_client_site') {
      return textResult(await mapClientSite(creds, args));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

async function mapClientSite(creds: UispCredentials | null, args: Record<string, unknown>) {
  const clientId = args.clientId as number | undefined;
  const serviceId = args.serviceId as number | undefined;
  const siteId = args.siteId as string | undefined;
  const wantsCrm = clientId != null || serviceId != null;
  const nmsReady = !!(creds?.apiKey && creds.baseUrl);
  const crmReady = !!(creds?.crmAppKey && (creds.crmBaseUrl || creds.baseUrl));

  if (!creds || (!nmsReady && !crmReady)) {
    throw new Error('No UISP credentials configured. Set UISP_API_KEY and/or UISP_CRM_APP_KEY plus UISP_BASE_URL.');
  }
  if (wantsCrm && !crmReady) {
    const missing = requireCrmCredentials(creds);
    throw new Error(missing ? stripErrorPrefix(missing) : 'CRM credentials are required.');
  }
  if (!wantsCrm && siteId && !nmsReady) {
    const missing = requireCredentials(creds);
    throw new Error(missing ? stripErrorPrefix(missing) : 'NMS credentials are required.');
  }

  let services: ServiceSummary[] = [];
  let servicesTruncated = false;
  if (crmReady && serviceId != null) {
    services = [summarizeService(await getService(creds, serviceId))];
  } else if (crmReady && clientId != null) {
    const collected = await fetchAllCrmPages(
      (limit, offset) => listServices(creds, { clientId, limit, offset }),
      '/clients/services'
    );
    services = collected.rows.map((row) => summarizeService(row));
    servicesTruncated = collected.truncated;
  }

  const siteIds: string[] = [];
  if (siteId) siteIds.push(siteId);
  for (const service of services) {
    if (service.unmsClientSiteId && !siteIds.includes(service.unmsClientSiteId)) siteIds.push(service.unmsClientSiteId);
  }

  const sites = [];
  let sitesTruncated = false;
  if (nmsReady) {
    const capped = siteIds.slice(0, 10);
    sitesTruncated = siteIds.length > capped.length;
    for (const id of capped) {
      sites.push(siteUcrm(await getSite(creds, { id, ucrmDetails: true })));
    }
  }

  let resolvedClientId = clientId ?? services.find((service) => service.clientId != null)?.clientId ?? null;
  if (resolvedClientId == null) {
    const fromSite = sites.find((site) => site.crmClientId && /^[1-9]\d*$/.test(site.crmClientId))?.crmClientId;
    if (fromSite) resolvedClientId = Number(fromSite);
  }
  const client = crmReady && resolvedClientId != null ? summarizeClient(await getClient(creds, resolvedClientId)) : null;

  if (crmReady && resolvedClientId != null && serviceId == null && services.length === 0) {
    const fromSiteService = sites.find((site) => site.crmServiceId && /^[1-9]\d*$/.test(site.crmServiceId))?.crmServiceId;
    if (fromSiteService) {
      services = [summarizeService(await getService(creds, Number(fromSiteService)))];
    }
  }

  return {
    client,
    services,
    servicesTruncated,
    sites,
    sitesTruncated,
    nmsConfigured: nmsReady,
    crmConfigured: crmReady,
    note: !nmsReady
      ? 'NMS credentials are not configured, so linked site ids were not expanded. Set UISP_API_KEY to read the NMS site.'
      : !crmReady
        ? 'CRM credentials are not configured. Site ucrm.client and ucrm.service ids are included when NMS returned them.'
        : undefined,
    links: services
      .filter((service) => service.unmsClientSiteId)
      .map((service) => ({
        clientId: service.clientId,
        serviceId: service.id,
        serviceName: service.name,
        servicePlanName: service.servicePlanName,
        unmsClientSiteId: service.unmsClientSiteId,
        unmsClientSiteStatus: service.unmsClientSiteStatus,
      })),
  };
}

function stripErrorPrefix(result: CallToolResult): string {
  const block = result.content[0];
  const text = block && block.type === 'text' ? block.text : 'Missing credentials';
  return text.replace(/^Error:\s*/, '');
}
