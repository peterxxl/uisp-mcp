import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSiteTool } from '../tools/sites.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handleSiteTool', () => {
  const fetchMock = vi.fn();
  const creds = { apiKey: 'token-1', baseUrl: 'https://uisp.example.com' };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uisp_list_sites sends the x-auth-token header and forwards filters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 's1', identification: { name: 'Tower A' } }]));

    const result = await runWithCredentials(creds, () => handleSiteTool('uisp_list_sites', { type: 'site', ucrm: true }));

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/nms/api/v2.1/sites');
    expect(new URL(url).searchParams.get('type')).toBe('site');
    expect(new URL(url).searchParams.get('ucrm')).toBe('true');
    expect((init.headers as Record<string, string>)['x-auth-token']).toBe('token-1');
    expect(JSON.parse(textOf(result))[0].identification.name).toBe('Tower A');
  });

  it('uisp_list_sites forwards an array-valued id filter as repeated query params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await runWithCredentials(creds, () => handleSiteTool('uisp_list_sites', { id: ['a', 'b'] }));

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.getAll('id')).toEqual(['a', 'b']);
  });

  it('uisp_get_site scopes the request to the site ID in the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 's5', identification: { name: 'Tower B' } }));

    const result = await runWithCredentials(creds, () => handleSiteTool('uisp_get_site', { id: 's5' }));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/sites/s5');
    expect(result.isError).toBeUndefined();
  });

  it('uisp_search_sites requires count and page and forwards the query text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await runWithCredentials(creds, () => handleSiteTool('uisp_search_sites', { query: 'Main St', count: 20, page: 1 }));

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/nms/api/v2.1/sites/search');
    expect(url.searchParams.get('query')).toBe('Main St');
    expect(url.searchParams.get('count')).toBe('20');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('uisp_list_site_clients scopes to the parent site ID', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await runWithCredentials(creds, () => handleSiteTool('uisp_list_site_clients', { id: 's5' }));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/sites/s5/clients');
  });

  it('uisp_get_site_statistics requires an interval', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await runWithCredentials(creds, () => handleSiteTool('uisp_get_site_statistics', { siteId: 's5', interval: 'day' }));

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/nms/api/v2.1/sites/s5/statistics');
    expect(url.searchParams.get('interval')).toBe('day');
  });

  it('uisp_get_site_traffic_summary hits the traffic/summary path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await runWithCredentials(creds, () => handleSiteTool('uisp_get_site_traffic_summary', { siteId: 's5', interval: 'month' }));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/sites/s5/traffic/summary');
  });

  it('surfaces a 401 as a readable auth error rather than throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));

    const result = await runWithCredentials(creds, () => handleSiteTool('uisp_list_sites', {}));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/UISP NMS \/sites failed: HTTP 401/);
  });

  it('returns a credential error without calling fetch when no token/baseUrl is configured', async () => {
    const result = await handleSiteTool('uisp_list_sites', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/UISP_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
