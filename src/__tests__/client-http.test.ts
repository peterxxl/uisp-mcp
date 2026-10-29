import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uispRequest } from '../client.js';
import { UispApiError, UispRateLimitError } from '../types.js';
import { jsonResponse } from './test-helpers.js';

const creds = {
  apiKey: 'nms-token-secret',
  baseUrl: 'https://uisp.example.com',
  crmAppKey: 'crm-app-key-secret',
};

describe('uispRequest', () => {
  const fetchMock = vi.fn();
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('retries an idempotent GET on 500 and then returns the success body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 500)).mockResolvedValueOnce(jsonResponse({ version: '2.4.0' }));

    const body = await uispRequest(creds, { api: 'nms', path: '/nms/version' });

    expect(body).toEqual({ version: '2.4.0' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method === 'GET')).toBe(true);
  });

  it('does not retry PUT', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unavailable' }, 500));
    await expect(
      uispRequest(creds, { api: 'nms', method: 'PUT', path: '/devices/aircubes/cube-1/wireless', body: { wifi2Ghz: { key: 'should-not-retry' } } })
    ).rejects.toBeInstanceOf(UispApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a final 429 as a rate-limit error after retries', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: 'slow down' }, 429)));
    await expect(uispRequest(creds, { api: 'crm', path: '/invoices', query: { email: 'person@example.com' } })).rejects.toBeInstanceOf(
      UispRateLimitError
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses unsafe path segments before calling the network', async () => {
    await expect(uispRequest(creds, { api: 'nms', path: '/devices/undefined' })).rejects.toThrow(/unsafe segment/);
    await expect(uispRequest(creds, { api: 'nms', path: '/devices/%2E%2E' })).rejects.toThrow(/unsafe segment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a base URL with embedded credentials', async () => {
    await expect(
      uispRequest({ ...creds, baseUrl: 'https://user:pass@uisp.example.com' }, { api: 'nms', path: '/nms/version' })
    ).rejects.toThrow(/embedded credentials/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not log secrets, the query string, or the response body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 502)).mockResolvedValueOnce(jsonResponse([{ email: 'person@example.com', secretNote: 'full-customer-record' }]));

    await uispRequest(creds, {
      api: 'crm',
      path: '/clients',
      query: { email: 'person@example.com' },
    });

    const logs = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logs).toContain('/clients');
    expect(logs).not.toContain('crm-app-key-secret');
    expect(logs).not.toContain('nms-token-secret');
    expect(logs).not.toContain('person@example.com');
    expect(logs).not.toContain('full-customer-record');
  });
});
