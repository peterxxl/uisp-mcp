import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDeviceTool } from '../tools/devices.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handleDeviceTool', () => {
  const fetchMock = vi.fn();
  const creds = { apiKey: 'token-1', baseUrl: 'https://uisp.example.com' };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uisp_list_devices sends the x-auth-token header and forwards array filters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ identification: { hostname: 'ap-1' } }]));

    const result = await runWithCredentials(creds, () =>
      handleDeviceTool('uisp_list_devices', { siteId: 's1', type: ['airMax', 'airFiber'], role: ['ap'] })
    );

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/nms/api/v2.1/devices');
    expect(new URL(url).searchParams.get('siteId')).toBe('s1');
    expect(new URL(url).searchParams.getAll('type')).toEqual(['airMax', 'airFiber']);
    expect(new URL(url).searchParams.getAll('role')).toEqual(['ap']);
    expect((init.headers as Record<string, string>)['x-auth-token']).toBe('token-1');
    expect(JSON.parse(textOf(result))[0].identification.hostname).toBe('ap-1');
  });

  it('uisp_get_device scopes the request to the device ID in the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ identification: { hostname: 'switch-1' } }));

    const result = await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device', { id: 'd5' }));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/devices/d5');
    expect(result.isError).toBeUndefined();
  });

  it('uisp_get_device_detail forwards withStations', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device_detail', { id: 'd5', withStations: true }));

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/nms/api/v2.1/devices/d5/detail');
    expect(url.searchParams.get('withStations')).toBe('true');
  });

  it('uisp_get_device_statistics requires an interval', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device_statistics', { id: 'd5', interval: 'hour' }));

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/nms/api/v2.1/devices/d5/statistics');
    expect(url.searchParams.get('interval')).toBe('hour');
  });

  it('uisp_list_device_interfaces scopes to the device ID', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await runWithCredentials(creds, () => handleDeviceTool('uisp_list_device_interfaces', { deviceId: 'd5' }));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/devices/d5/interfaces');
  });

  it('uisp_get_device_by_mac encodes the MAC address into the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device_by_mac', { mac: '78:8a:20:5f:2a:ff' }));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/devices/mac/78%3A8a%3A20%3A5f%3A2a%3Aff');
  });

  it('uisp_list_discovered_devices hits the discovered path with no params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await runWithCredentials(creds, () => handleDeviceTool('uisp_list_discovered_devices', {}));

    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/devices/discovered');
  });

  it('surfaces a 429 as a readable rate-limit error rather than throwing', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: 'rate limited' }, 429)));

    const result = await runWithCredentials(creds, () => handleDeviceTool('uisp_list_devices', {}));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rate-limited/i);
  });

  it('returns a credential error without calling fetch when no token/baseUrl is configured', async () => {
    const result = await handleDeviceTool('uisp_list_devices', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/UISP_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
