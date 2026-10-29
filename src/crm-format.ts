/**
 * Invoice status codes from the UISP CRM API blueprint (`InvoiceStatus` on
 * https://unmscrm.docs.apiary.io), verified against that document — not
 * against a live console:
 *
 *   0 Draft
 *   1 Unpaid
 *   2 Partially paid
 *   3 Paid
 *   4 Void
 *   5 Processed proforma
 *
 * The community server wolverin0/uisp-mcp-server maps these wrong
 * (overdue=3, paid=4, void=5) and then treats status 3 as overdue, which
 * counts paid invoices as debt. Do not copy that. Paid (3), void (4),
 * draft (0), and processed proforma (5) are never overdue.
 */
export const INVOICE_STATUS_LABELS: Readonly<Record<number, string>> = {
  0: 'Draft',
  1: 'Unpaid',
  2: 'Partially paid',
  3: 'Paid',
  4: 'Void',
  5: 'Processed proforma',
};

/** Service status codes from the same CRM blueprint (`ServiceStatus`). */
export const SERVICE_STATUS_LABELS: Readonly<Record<number, string>> = {
  0: 'Prepared',
  1: 'Active',
  2: 'Ended',
  3: 'Suspended',
  4: 'Prepared blocked',
  5: 'Obsolete',
  6: 'Deferred',
  7: 'Quoted',
  8: 'Inactive',
};

const OPEN_INVOICE_STATUSES = new Set([1, 2]);

export function invoiceStatusLabel(status: unknown): string {
  if (typeof status !== 'number' || !Number.isInteger(status)) return 'Unknown';
  return INVOICE_STATUS_LABELS[status] ?? `Unknown (${status})`;
}

export function serviceStatusLabel(status: unknown): string {
  if (typeof status !== 'number' || !Number.isInteger(status)) return 'Unknown';
  return SERVICE_STATUS_LABELS[status] ?? `Unknown (${status})`;
}

/** CRM timestamps look like `2016-09-26T00:00:00+0000` (no colon in the offset). */
export function parseUcrmDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function utcDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

/**
 * Whole UTC calendar days past the due date. Zero when the due date is
 * today or in the future, or when the value does not parse. Status is not
 * consulted here — callers decide whether a status can be overdue.
 */
export function daysPastDue(dueDate: unknown, now: Date = new Date()): number {
  const due = parseUcrmDate(dueDate);
  if (!due) return 0;
  const days = utcDayNumber(now) - utcDayNumber(due);
  return days > 0 ? days : 0;
}

export function invoiceIsOverdue(status: unknown, dueDate: unknown, amountToPay: unknown, now: Date = new Date()): boolean {
  if (typeof status !== 'number' || !OPEN_INVOICE_STATUSES.has(status)) return false;
  if (typeof amountToPay === 'number' && Number.isFinite(amountToPay) && amountToPay <= 0) return false;
  return daysPastDue(dueDate, now) > 0;
}

export function daysOverdue(status: unknown, dueDate: unknown, amountToPay: unknown, now: Date = new Date()): number {
  if (!invoiceIsOverdue(status, dueDate, amountToPay, now)) return 0;
  return daysPastDue(dueDate, now);
}

export interface InvoiceSummary {
  id: number | null;
  number: string | null;
  clientId: number | null;
  clientName: string;
  total: number | null;
  amountToPay: number | null;
  currencyCode: string | null;
  createdDate: string | null;
  dueDate: string | null;
  status: number | null;
  statusLabel: string;
  overdue: boolean;
  daysOverdue: number;
  proforma: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function clientDisplayName(record: Record<string, unknown>): string {
  const company = asString(record.clientCompanyName) ?? asString(record.companyName);
  const person = [asString(record.clientFirstName) ?? asString(record.firstName), asString(record.clientLastName) ?? asString(record.lastName)]
    .filter((part): part is string => !!part)
    .join(' ')
    .trim();
  if (company && person) return `${company} (${person})`;
  if (company) return company;
  if (person) return person;
  const id = asInt(record.clientId) ?? asInt(record.id);
  return id != null ? `Client ${id}` : 'Unknown client';
}

export function summarizeInvoice(raw: unknown, now: Date = new Date()): InvoiceSummary {
  if (!isRecord(raw)) {
    throw new Error('UISP CRM invoice response was not an object');
  }
  const status = asInt(raw.status);
  const dueDate = asString(raw.dueDate);
  const amountToPay = asNumber(raw.amountToPay);
  const overdue = invoiceIsOverdue(status, dueDate, amountToPay, now);
  return {
    id: asInt(raw.id),
    number: asString(raw.number),
    clientId: asInt(raw.clientId),
    clientName: clientDisplayName(raw),
    total: asNumber(raw.total),
    amountToPay,
    currencyCode: asString(raw.currencyCode),
    createdDate: asString(raw.createdDate),
    dueDate,
    status,
    statusLabel: invoiceStatusLabel(status),
    overdue,
    daysOverdue: overdue ? daysPastDue(dueDate, now) : 0,
    proforma: typeof raw.proforma === 'boolean' ? raw.proforma : null,
  };
}

export interface InvoiceDetail extends InvoiceSummary {
  notes: string | null;
  amountPaid: number | null;
  items: Array<{ id: number | null; label: string | null; type: string | null; quantity: number | null; price: number | null; total: number | null }>;
}

export function summarizeInvoiceDetail(raw: unknown, now: Date = new Date()): InvoiceDetail {
  const summary = summarizeInvoice(raw, now);
  const record = raw as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items.filter(isRecord) : [];
  return {
    ...summary,
    notes: asString(record.notes),
    amountPaid: asNumber(record.amountPaid),
    items: items.map((item) => ({
      id: asInt(item.id),
      label: asString(item.label),
      type: asString(item.type),
      quantity: asNumber(item.quantity),
      price: asNumber(item.price),
      total: asNumber(item.total),
    })),
  };
}

export interface ClientSummary {
  id: number | null;
  customId: string | null;
  clientType: number | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string;
  username: string | null;
  emails: string[];
  phones: string[];
  accountBalance: number | null;
  accountCredit: number | null;
  accountOutstanding: number | null;
  currencyCode: string | null;
  hasOverdueInvoice: boolean | null;
  hasSuspendedService: boolean | null;
  isArchived: boolean | null;
  isLead: boolean | null;
  organizationName: string | null;
}

function contactStrings(record: Record<string, unknown>, field: 'email' | 'phone'): string[] {
  if (!Array.isArray(record.contacts)) return [];
  const values: string[] = [];
  for (const contact of record.contacts) {
    if (!isRecord(contact)) continue;
    const value = asString(contact[field]);
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

export function summarizeClient(raw: unknown): ClientSummary {
  if (!isRecord(raw)) throw new Error('UISP CRM client response was not an object');
  return {
    id: asInt(raw.id),
    customId: asString(raw.userIdent),
    clientType: asInt(raw.clientType),
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    companyName: asString(raw.companyName),
    displayName: clientDisplayName(raw),
    username: asString(raw.username),
    emails: contactStrings(raw, 'email'),
    phones: contactStrings(raw, 'phone'),
    accountBalance: asNumber(raw.accountBalance),
    accountCredit: asNumber(raw.accountCredit),
    accountOutstanding: asNumber(raw.accountOutstanding),
    currencyCode: asString(raw.currencyCode),
    hasOverdueInvoice: typeof raw.hasOverdueInvoice === 'boolean' ? raw.hasOverdueInvoice : null,
    hasSuspendedService: typeof raw.hasSuspendedService === 'boolean' ? raw.hasSuspendedService : null,
    isArchived: typeof raw.isArchived === 'boolean' ? raw.isArchived : null,
    isLead: typeof raw.isLead === 'boolean' ? raw.isLead : null,
    organizationName: asString(raw.organizationName),
  };
}

export interface ServiceSummary {
  id: number | null;
  clientId: number | null;
  name: string | null;
  status: number | null;
  statusLabel: string;
  servicePlanId: number | null;
  servicePlanName: string | null;
  servicePlanPrice: number | null;
  servicePlanPeriod: number | null;
  price: number | null;
  downloadSpeed: number | null;
  uploadSpeed: number | null;
  currencyCode: string | null;
  unmsClientSiteId: string | null;
  unmsClientSiteStatus: string | null;
  hasOutage: boolean | null;
}

export function summarizeService(raw: unknown): ServiceSummary {
  if (!isRecord(raw)) throw new Error('UISP CRM service response was not an object');
  const status = asInt(raw.status);
  return {
    id: asInt(raw.id),
    clientId: asInt(raw.clientId),
    name: asString(raw.name),
    status,
    statusLabel: serviceStatusLabel(status),
    servicePlanId: asInt(raw.servicePlanId),
    servicePlanName: asString(raw.servicePlanName),
    servicePlanPrice: asNumber(raw.servicePlanPrice),
    servicePlanPeriod: asInt(raw.servicePlanPeriod),
    price: asNumber(raw.price),
    downloadSpeed: asNumber(raw.downloadSpeed),
    uploadSpeed: asNumber(raw.uploadSpeed),
    currencyCode: asString(raw.currencyCode),
    unmsClientSiteId: asString(raw.unmsClientSiteId),
    unmsClientSiteStatus: asString(raw.unmsClientSiteStatus),
    hasOutage: typeof raw.hasOutage === 'boolean' ? raw.hasOutage : null,
  };
}

export interface PaymentSummary {
  id: number | null;
  clientId: number | null;
  amount: number | null;
  currencyCode: string | null;
  createdDate: string | null;
  note: string | null;
  creditAmount: number | null;
  methodId: string | null;
  providerName: string | null;
  appliedToInvoices: Array<{ invoiceId: number | null; amount: number | null }>;
}

export function summarizePayment(raw: unknown): PaymentSummary {
  if (!isRecord(raw)) throw new Error('UISP CRM payment response was not an object');
  const covers = Array.isArray(raw.paymentCovers) ? raw.paymentCovers.filter(isRecord) : [];
  return {
    id: asInt(raw.id),
    clientId: asInt(raw.clientId),
    amount: asNumber(raw.amount),
    currencyCode: asString(raw.currencyCode),
    createdDate: asString(raw.createdDate),
    note: asString(raw.note),
    creditAmount: asNumber(raw.creditAmount),
    methodId: asString(raw.methodId),
    providerName: asString(raw.providerName),
    appliedToInvoices: covers.map((cover) => ({
      invoiceId: asInt(cover.invoiceId),
      amount: asNumber(cover.amount),
    })),
  };
}

export interface PageResult<T> {
  items: T[];
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
}

export function pageResult<T>(items: T[], limit: number, offset: number): PageResult<T> {
  return {
    items,
    limit,
    offset,
    returned: items.length,
    hasMore: items.length === limit,
  };
}

/** CRM collections are JSON arrays. Some proxies wrap them; accept `items` as a fallback. */
export function asCollection(body: unknown, path: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.items)) return body.items;
  throw new Error(`UISP CRM ${path} returned an unexpected collection shape`);
}

export interface DebtorSummary {
  clientId: number | null;
  clientName: string;
  currencyCode: string | null;
  invoiceCount: number;
  totalOutstanding: number;
  maxDaysOverdue: number;
  oldestDueDate: string | null;
  invoiceNumbers: string[];
}

export type DebtorSort = 'amount' | 'days';

export function summarizeDebtors(invoices: InvoiceSummary[], sort: DebtorSort): {
  debtors: DebtorSummary[];
  invoiceCount: number;
  totalOutstanding: number | null;
  currencyCode: string | null;
  mixedCurrencies: boolean;
} {
  const groups = new Map<string, DebtorSummary>();
  for (const invoice of invoices) {
    if (!invoice.overdue) continue;
    const currency = invoice.currencyCode ?? '';
    const key = `${invoice.clientId ?? 'unknown'}:${currency}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        clientId: invoice.clientId,
        clientName: invoice.clientName,
        currencyCode: invoice.currencyCode,
        invoiceCount: 0,
        totalOutstanding: 0,
        maxDaysOverdue: 0,
        oldestDueDate: null,
        invoiceNumbers: [],
      };
      groups.set(key, row);
    }
    row.invoiceCount += 1;
    row.totalOutstanding += invoice.amountToPay ?? 0;
    if (invoice.daysOverdue > row.maxDaysOverdue) row.maxDaysOverdue = invoice.daysOverdue;
    if (invoice.dueDate && (!row.oldestDueDate || invoice.dueDate < row.oldestDueDate)) row.oldestDueDate = invoice.dueDate;
    if (invoice.number && row.invoiceNumbers.length < 20) row.invoiceNumbers.push(invoice.number);
  }

  const debtors = [...groups.values()];
  debtors.sort((a, b) => {
    if (sort === 'days') {
      return b.maxDaysOverdue - a.maxDaysOverdue || b.totalOutstanding - a.totalOutstanding;
    }
    return b.totalOutstanding - a.totalOutstanding || b.maxDaysOverdue - a.maxDaysOverdue;
  });

  const currencies = new Set(debtors.map((row) => row.currencyCode ?? ''));
  const mixedCurrencies = currencies.size > 1;
  const totalOutstanding = mixedCurrencies ? null : debtors.reduce((sum, row) => sum + row.totalOutstanding, 0);
  const currencyCode = mixedCurrencies || debtors.length === 0 ? (debtors[0]?.currencyCode ?? null) : debtors[0].currencyCode;
  return {
    debtors,
    invoiceCount: invoices.filter((invoice) => invoice.overdue).length,
    totalOutstanding,
    currencyCode: mixedCurrencies ? null : currencyCode,
    mixedCurrencies,
  };
}

export function sortInvoices(invoices: InvoiceSummary[], sort: DebtorSort): InvoiceSummary[] {
  const copy = [...invoices];
  copy.sort((a, b) => {
    if (sort === 'days') {
      return b.daysOverdue - a.daysOverdue || (b.amountToPay ?? 0) - (a.amountToPay ?? 0);
    }
    return (b.amountToPay ?? 0) - (a.amountToPay ?? 0) || b.daysOverdue - a.daysOverdue;
  });
  return copy;
}
