import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithCredentials } from '../client.js';
import { handleCrmTool } from '../tools/crm.js';
import { jsonResponse, textOf } from './test-helpers.js';

const creds = {
  apiKey: 'nms-token',
  baseUrl: 'https://uisp.example.com',
  crmAppKey: 'crm-app-key',
};

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    number: 'INV-1',
    clientId: 7,
    clientFirstName: 'Ana',
    clientLastName: 'Haoa',
    total: 100,
    amountToPay: 40,
    currencyCode: 'CLP',
    createdDate: '2026-09-01T00:00:00+0000',
    dueDate: '2020-01-15T00:00:00+0000',
    status: 1,
    proforma: false,
    ...overrides,
  };
}

describe('CRM tools', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches clients with the CRM app key and does not send the NMS token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 7,
          userIdent: 'RAPA-7',
          firstName: 'Ana',
          lastName: 'Haoa',
          accountBalance: -1500,
          accountCredit: 0,
          accountOutstanding: 1500,
          currencyCode: 'CLP',
          hasOverdueInvoice: true,
          contacts: [{ email: 'ana@example.com', phone: '+56911111111' }],
        },
      ])
    );

    const result = await runWithCredentials(creds, () =>
      handleCrmTool('uisp_search_clients', { query: 'Ana', email: 'ana@example.com', phone: '+56911111111', customId: 'RAPA-7', limit: 10, offset: 20 })
    );

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/crm/api/v1.0/clients');
    expect(parsed.searchParams.get('query')).toBe('Ana');
    expect(parsed.searchParams.get('email')).toBe('ana@example.com');
    expect(parsed.searchParams.get('phone')).toBe('+56911111111');
    expect(parsed.searchParams.get('userIdent')).toBe('RAPA-7');
    expect(parsed.searchParams.get('limit')).toBe('10');
    expect(parsed.searchParams.get('offset')).toBe('20');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Auth-App-Key']).toBe('crm-app-key');
    expect(headers['x-auth-token']).toBeUndefined();
    const body = JSON.parse(textOf(result));
    expect(body.items[0].accountBalance).toBe(-1500);
    expect(body.items[0].accountOutstanding).toBe(1500);
    expect(body.items[0].customId).toBe('RAPA-7');
    expect(body.hasMore).toBe(false);
  });

  it('requires a search field and does not call CRM without one', async () => {
    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_search_clients', {}));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/query, email, phone, or customId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns client balance fields from GET /clients/{id}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 7,
        firstName: 'Ana',
        lastName: 'Haoa',
        accountBalance: -347.94,
        accountCredit: 10,
        accountOutstanding: 347.94,
        currencyCode: 'USD',
        contacts: [],
      })
    );

    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_get_client', { id: 7 }));
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/crm/api/v1.0/clients/7');
    const body = JSON.parse(textOf(result));
    expect(body.accountBalance).toBe(-347.94);
    expect(body.accountCredit).toBe(10);
    expect(body.accountOutstanding).toBe(347.94);
  });

  it('lists services with the plan name, status, and linked NMS site', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 9,
          clientId: 7,
          name: 'Internet',
          status: 1,
          servicePlanId: 3,
          servicePlanName: '50/50',
          servicePlanPrice: 25000,
          unmsClientSiteId: 'site-uuid',
          unmsClientSiteStatus: 'active',
          currencyCode: 'CLP',
        },
      ])
    );

    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_list_client_services', { clientId: 7, limit: 5, offset: 0 }));
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/crm/api/v1.0/clients/services');
    expect(url.searchParams.get('clientId')).toBe('7');
    const body = JSON.parse(textOf(result));
    expect(body.items[0].servicePlanName).toBe('50/50');
    expect(body.items[0].statusLabel).toBe('Active');
    expect(body.items[0].unmsClientSiteId).toBe('site-uuid');
  });

  it('lists invoices with status filters, overdue, dates, and human-readable status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        invoice({ status: 1, amountToPay: 40, dueDate: '2020-01-15T00:00:00+0000' }),
        invoice({ id: 2, number: 'INV-PAID', status: 3, amountToPay: 0, dueDate: '2020-01-15T00:00:00+0000' }),
      ])
    );

    const result = await runWithCredentials(creds, () =>
      handleCrmTool('uisp_list_invoices', {
        clientId: 7,
        statuses: [1, 2],
        overdue: true,
        createdDateFrom: '2026-01-01',
        createdDateTo: '2026-12-31',
        limit: 2,
        offset: 0,
        order: 'createdDate',
        direction: 'DESC',
      })
    );

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/crm/api/v1.0/invoices');
    expect(url.searchParams.getAll('statuses[]')).toEqual(['1', '2']);
    expect(url.searchParams.get('overdue')).toBe('1');
    expect(url.searchParams.get('createdDateFrom')).toBe('2026-01-01');
    expect(url.searchParams.get('createdDateTo')).toBe('2026-12-31');
    expect(url.searchParams.get('order')).toBe('createdDate');
    expect(url.searchParams.get('direction')).toBe('DESC');
    const body = JSON.parse(textOf(result));
    expect(body.hasMore).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].statusLabel).toBe('Unpaid');
    expect(body.items[0].overdue).toBe(true);
    expect(body.items[0].daysOverdue).toBeGreaterThan(0);
    expect(body.items[0].number).toBe('INV-1');
    expect(body.statusCodes['3']).toBe('Paid');
  });

  it('gets one invoice', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...invoice({ status: 2, amountToPay: 15, total: 30 }),
        amountPaid: 15,
        notes: 'installment',
        items: [{ id: 1, label: 'Internet', type: 'service', quantity: 1, price: 30, total: 30 }],
      })
    );
    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_get_invoice', { id: '15' }));
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/crm/api/v1.0/invoices/15');
    const body = JSON.parse(textOf(result));
    expect(body.statusLabel).toBe('Partially paid');
    expect(body.amountToPay).toBe(15);
    expect(body.items[0].label).toBe('Internet');
  });

  it('walks overdue pages and drops paid invoices the server included', async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      invoice({
        id: index + 1,
        number: `N-${index}`,
        status: index === 0 ? 3 : 1,
        amountToPay: index === 0 ? 500 : 10,
        clientId: index === 0 ? 99 : 7,
        clientFirstName: index === 0 ? 'Paid' : 'Ana',
      })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(page)).mockResolvedValueOnce(jsonResponse([invoice({ id: 500, number: 'LAST', status: 1, amountToPay: 8 })]));

    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_list_overdue_invoices', { sort: 'amount' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = new URL(fetchMock.mock.calls[1][0] as string);
    expect(second.searchParams.get('offset')).toBe('100');
    expect(second.searchParams.get('overdue')).toBe('1');
    expect(second.searchParams.getAll('statuses[]')).toEqual(['1', '2']);
    const body = JSON.parse(textOf(result));
    expect(body.truncated).toBe(false);
    expect(body.invoices.some((row: { status: number }) => row.status === 3)).toBe(false);
    expect(body.invoices.some((row: { number: string }) => row.number === 'LAST')).toBe(true);
    expect(body.invoices[0].daysOverdue).toBeGreaterThan(0);
  });

  it('summarizes debtors sorted by amount', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        invoice({ id: 1, clientId: 1, clientFirstName: 'Ana', amountToPay: 10, dueDate: '2020-01-01T00:00:00+0000', status: 1, number: 'A' }),
        invoice({ id: 2, clientId: 2, clientFirstName: 'Bea', amountToPay: 80, dueDate: '2024-01-01T00:00:00+0000', status: 2, number: 'B' }),
        invoice({ id: 3, clientId: 3, clientFirstName: 'Paid', amountToPay: 1000, dueDate: '2020-01-01T00:00:00+0000', status: 3, number: 'P' }),
      ])
    );
    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_list_debtors', { sort: 'amount' }));
    const body = JSON.parse(textOf(result));
    expect(body.debtors.map((row: { clientName: string }) => row.clientName)).toEqual(['Bea Haoa', 'Ana Haoa']);
    expect(body.invoiceCount).toBe(2);
    expect(body.debtors[0].totalOutstanding).toBe(80);
    expect(body.debtors[0].maxDaysOverdue).toBeGreaterThan(0);
  });

  it('lists payments for a client and date range', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 4,
          clientId: 7,
          amount: 40,
          currencyCode: 'CLP',
          createdDate: '2026-10-02T00:00:00+0000',
          note: 'cash',
          creditAmount: 0,
          paymentCovers: [{ invoiceId: 1, amount: 40 }],
        },
      ])
    );
    const result = await runWithCredentials(creds, () =>
      handleCrmTool('uisp_list_payments', { clientId: 7, createdDateFrom: '2026-10-01', createdDateTo: '2026-10-31', limit: 25, offset: 0 })
    );
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/crm/api/v1.0/payments');
    expect(url.searchParams.get('clientId')).toBe('7');
    expect(url.searchParams.get('createdDateFrom')).toBe('2026-10-01');
    const body = JSON.parse(textOf(result));
    expect(body.items[0].amount).toBe(40);
    expect(body.items[0].appliedToInvoices[0].invoiceId).toBe(1);
  });

  it('maps a CRM service to its NMS site and the site back to the CRM client', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          id: 9,
          clientId: 7,
          name: 'Internet',
          status: 1,
          servicePlanName: '50/50',
          unmsClientSiteId: 'site-uuid',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'site-uuid',
          identification: { id: 'site-uuid', name: 'Ana home', type: 'client' },
          ucrm: { client: { id: '7', name: 'Ana Haoa' }, service: { id: '9', name: 'Internet' } },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 7,
          firstName: 'Ana',
          lastName: 'Haoa',
          accountOutstanding: 10,
          currencyCode: 'CLP',
          contacts: [],
        })
      );

    const result = await runWithCredentials(creds, () => handleCrmTool('uisp_map_client_site', { serviceId: 9 }));
    const paths = fetchMock.mock.calls.map((call) => new URL(call[0] as string).pathname);
    expect(paths).toEqual(['/crm/api/v1.0/clients/services/9', '/nms/api/v2.1/sites/site-uuid', '/crm/api/v1.0/clients/7']);
    const siteUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(siteUrl.searchParams.get('ucrmDetails')).toBe('true');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ 'x-auth-token': 'nms-token' });
    const body = JSON.parse(textOf(result));
    expect(body.links[0].unmsClientSiteId).toBe('site-uuid');
    expect(body.sites[0].crmClientId).toBe('7');
    expect(body.sites[0].crmServiceId).toBe('9');
    expect(body.client.displayName).toBe('Ana Haoa');
  });

  it('maps an NMS site to CRM ids without a CRM key', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'site-uuid',
        identification: { name: 'Ana home', type: 'client' },
        ucrm: { client: { id: '7', name: 'Ana Haoa' }, service: { id: '9', name: 'Internet' } },
      })
    );
    const result = await runWithCredentials({ apiKey: 'nms-token', baseUrl: 'https://uisp.example.com' }, () =>
      handleCrmTool('uisp_map_client_site', { siteId: 'site-uuid' })
    );
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(textOf(result));
    expect(body.crmConfigured).toBe(false);
    expect(body.sites[0].crmClientId).toBe('7');
    expect(body.note).toMatch(/CRM credentials/);
  });

  it('returns a CRM credential error without calling fetch', async () => {
    const result = await handleCrmTool('uisp_list_invoices', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/UISP_CRM_APP_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
