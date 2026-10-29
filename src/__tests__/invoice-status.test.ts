import { describe, expect, it } from 'vitest';
import {
  INVOICE_STATUS_LABELS,
  daysOverdue,
  daysPastDue,
  invoiceIsOverdue,
  invoiceStatusLabel,
  summarizeDebtors,
  summarizeInvoice,
} from '../crm-format.js';

const NOW = new Date('2026-10-28T15:00:00Z');

describe('CRM invoice status codes', () => {
  it('matches the UISP CRM InvoiceStatus enum, not the shifted community-server mapping', () => {
    expect(INVOICE_STATUS_LABELS).toEqual({
      0: 'Draft',
      1: 'Unpaid',
      2: 'Partially paid',
      3: 'Paid',
      4: 'Void',
      5: 'Processed proforma',
    });
    expect(invoiceStatusLabel(3)).toBe('Paid');
    expect(invoiceStatusLabel(3)).not.toBe('Overdue');
    expect(invoiceStatusLabel(4)).toBe('Void');
    expect(invoiceStatusLabel(5)).toBe('Processed proforma');
  });

  it('counts calendar days in an explicit timezone, and treats the due instant as the overdue boundary', () => {
    expect(daysPastDue('2026-10-26T00:00:00+0000', NOW, 'UTC')).toBe(2);
    expect(daysPastDue('2026-10-28T00:00:00+0000', NOW, 'UTC')).toBe(0);
    expect(daysPastDue('2026-10-29T00:00:00+0000', NOW, 'UTC')).toBe(0);
    // 13:06 at UTC-5 has passed by 18:30Z, but it is still 1 Nov in that offset.
    const due = '2026-11-01T13:06:12-0500';
    const justAfter = new Date('2026-11-01T18:30:00Z');
    expect(invoiceIsOverdue(1, due, 10, justAfter)).toBe(true);
    expect(daysPastDue(due, justAfter, 'dueDate')).toBe(0);
    expect(daysPastDue(due, new Date('2026-11-02T18:30:00Z'), 'dueDate')).toBe(1);
    // Pacific/Easter is UTC-6. 18:06Z is 12:06 local on 1 Nov; 15:00Z next day is 09:00 on 2 Nov.
    expect(daysPastDue(due, new Date('2026-11-02T15:00:00Z'), 'Pacific/Easter')).toBe(1);
  });

  it('never treats paid, void, draft, or processed-proforma invoices as overdue', () => {
    const past = '2020-01-01T00:00:00+0000';
    for (const status of [0, 3, 4, 5]) {
      expect(invoiceIsOverdue(status, past, 25, NOW), `status ${status}`).toBe(false);
      expect(daysOverdue(status, past, 25, NOW)).toBe(0);
    }
    expect(invoiceIsOverdue(1, past, 25, NOW)).toBe(true);
    expect(invoiceIsOverdue(2, past, 10, NOW)).toBe(true);
    expect(daysOverdue(1, '2026-10-26T00:00:00+0000', 10, NOW, 'UTC')).toBe(2);
  });

  it('does not count an open invoice that is not yet due, or one with nothing left to pay', () => {
    expect(invoiceIsOverdue(1, '2026-10-28T16:00:00+0000', 10, NOW)).toBe(false);
    expect(invoiceIsOverdue(1, '2026-10-28T00:00:00+0000', 10, NOW)).toBe(true);
    expect(daysOverdue(1, '2026-10-28T00:00:00+0000', 10, NOW, 'UTC')).toBe(0);
    expect(invoiceIsOverdue(1, '2099-01-01T00:00:00+0000', 10, NOW)).toBe(false);
    expect(invoiceIsOverdue(2, '2020-01-01T00:00:00+0000', 0, NOW)).toBe(false);
  });

  it('summarizes a paid invoice with a past due date as not overdue', () => {
    const summary = summarizeInvoice(
      {
        id: 4,
        number: 'PAID-1',
        clientId: 7,
        clientFirstName: 'Ana',
        clientLastName: 'Haoa',
        total: 100,
        amountToPay: 0,
        currencyCode: 'CLP',
        dueDate: '2020-01-01T00:00:00+0000',
        status: 3,
      },
      NOW
    );
    expect(summary.statusLabel).toBe('Paid');
    expect(summary.overdue).toBe(false);
    expect(summary.daysOverdue).toBe(0);
    expect(summary.clientName).toBe('Ana Haoa');
  });

  it('sorts debtors by amount or days and does not include paid invoices', () => {
    const invoices = [
      summarizeInvoice(
        { id: 1, clientId: 1, clientFirstName: 'Ana', total: 10, amountToPay: 10, currencyCode: 'CLP', dueDate: '2026-09-28T00:00:00+0000', status: 1, number: 'A' },
        NOW,
        'UTC'
      ),
      summarizeInvoice(
        { id: 2, clientId: 2, clientFirstName: 'Bea', total: 50, amountToPay: 50, currencyCode: 'CLP', dueDate: '2026-10-26T00:00:00+0000', status: 2, number: 'B' },
        NOW,
        'UTC'
      ),
      summarizeInvoice(
        { id: 3, clientId: 3, clientFirstName: 'Paid', total: 999, amountToPay: 999, currencyCode: 'CLP', dueDate: '2020-01-01T00:00:00+0000', status: 3, number: 'P' },
        NOW,
        'UTC'
      ),
    ];
    const byAmount = summarizeDebtors(invoices, 'amount');
    expect(byAmount.debtors.map((row) => row.clientName)).toEqual(['Bea', 'Ana']);
    expect(byAmount.invoiceCount).toBe(2);
    expect(byAmount.totalOutstanding).toBe(60);
    const byDays = summarizeDebtors(invoices, 'days');
    expect(byDays.debtors.map((row) => row.clientName)).toEqual(['Ana', 'Bea']);
    expect(byDays.debtors[0].maxDaysOverdue).toBe(30);
  });
});
