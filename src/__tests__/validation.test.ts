import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithCredentials } from '../client.js';
import { handleDeviceTool } from '../tools/devices.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('tool argument validation', () => {
  const fetchMock = vi.fn();
  const creds = { apiKey: 'token-1', baseUrl: 'https://uisp.example.com' };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not request /devices/undefined when id is missing', async () => {
    const result = await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device', {}));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid arguments/);
    expect(textOf(result)).toMatch(/id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects path segments that contain a slash or ..', async () => {
    const slash = await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device', { id: 'a/b' }));
    const dots = await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device', { id: '..' }));
    expect(slash.isError).toBe(true);
    expect(dots.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still encodes a MAC address into the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await runWithCredentials(creds, () => handleDeviceTool('uisp_get_device_by_mac', { mac: '78:8a:20:5f:2a:ff' }));
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/devices/mac/78%3A8a%3A20%3A5f%3A2a%3Aff');
  });
});
