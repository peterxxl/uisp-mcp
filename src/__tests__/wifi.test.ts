import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithCredentials } from '../client.js';
import { dispatchToolCall } from '../tools/index.js';
import { handleWifiTool } from '../tools/wifi.js';
import { applyWifiPassword, classifyDevice, deviceView } from '../wifi-config.js';
import { jsonResponse, textOf } from './test-helpers.js';

const creds = {
  apiKey: 'nms-token',
  baseUrl: 'https://uisp.example.com',
  crmAppKey: 'crm-app-key',
};

const PASSWORD = 'UniqueWifiPass99';

function airCube(id = 'cube-1') {
  return {
    identification: {
      id,
      hostname: 'home-cube',
      type: 'airCube',
      modelName: 'airCube AC',
      role: 'router',
      site: { id: 'site-1', name: 'Ana' },
    },
  };
}

function wirelessConfig() {
  return {
    wifi2Ghz: { ssid: 'Haoa', key: 'old-secret-key', enabled: true, channel: 1, country: 'CL' },
    wifi5Ghz: { ssid: 'Haoa-5', key: 'old-secret-key-5', enabled: true, channel: 36 },
  };
}

describe('home Wi-Fi password tool', () => {
  const fetchMock = vi.fn();
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.UISP_ENABLE_WRITES = 'true';
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.UISP_ENABLE_WRITES;
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('classifies airMAX and airOS-style radios as backbone and airCube / Wi-Fi ONU as home Wi-Fi', () => {
    expect(classifyDevice(deviceView({ identification: { type: 'airMax', modelName: 'LiteBeam 5AC' } }))).toBe('backbone');
    expect(classifyDevice(deviceView({ identification: { type: 'airFiber' } }))).toBe('backbone');
    expect(classifyDevice(deviceView({ identification: { type: 'blackBox', model: 'LiteBeam 5AC' } }))).toBe('backbone');
    expect(classifyDevice(deviceView({ identification: { type: 'airCube' } }))).toBe('aircube');
    expect(classifyDevice(deviceView({ identification: { type: 'onu', modelName: 'UF-WIFI' } }))).toBe('onu');
    expect(classifyDevice(deviceView({ identification: { type: 'onu', modelName: 'UF-Nano' } }))).toBe('unsupported');
  });

  it('copies the full wireless object and changes only the requested keys', () => {
    const current = wirelessConfig();
    const { next, changes } = applyWifiPassword(current, 'aircube', PASSWORD, '2ghz');
    expect(changes.map((change) => change.field)).toEqual(['wifi2Ghz.key']);
    expect(next.wifi2Ghz).toMatchObject({ ssid: 'Haoa', key: PASSWORD, channel: 1, country: 'CL' });
    expect((next.wifi5Ghz as { key: string }).key).toBe('old-secret-key-5');
    expect((current.wifi2Ghz as { key: string }).key).toBe('old-secret-key');
  });

  it('dry-runs an airCube without PUTting and does not echo the password', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(airCube())).mockResolvedValueOnce(jsonResponse(wirelessConfig()));

    const result = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'cube-1', password: PASSWORD })
    );

    expect(result.isError).toBeUndefined();
    const methods = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method);
    expect(methods).toEqual(['GET', 'GET']);
    const body = JSON.parse(textOf(result));
    expect(body.dryRun).toBe(true);
    expect(body.applied).toBe(false);
    expect(body.changes.map((change: { field: string }) => change.field)).toEqual(['wifi2Ghz.key', 'wifi5Ghz.key']);
    expect(textOf(result)).not.toContain(PASSWORD);
    expect(textOf(result)).not.toContain('old-secret-key');
    expect(errorSpy.mock.calls.join(' ')).not.toContain(PASSWORD);
  });

  it('PUTs the full airCube object only when confirm is true, and audits without the password', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(airCube()))
      .mockResolvedValueOnce(jsonResponse(wirelessConfig()))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'cube-1', password: PASSWORD, confirm: true, band: 'both' })
    );

    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit).method === 'PUT');
    expect(put).toBeTruthy();
    expect(new URL(put![0] as string).pathname).toBe('/nms/api/v2.1/devices/aircubes/cube-1/wireless');
    expect((put![1] as RequestInit).headers).toMatchObject({ 'x-auth-token': 'nms-token' });
    const sent = JSON.parse((put![1] as RequestInit).body as string);
    expect(sent.wifi2Ghz).toEqual({ ssid: 'Haoa', key: PASSWORD, enabled: true, channel: 1, country: 'CL' });
    expect(sent.wifi5Ghz).toEqual({ ssid: 'Haoa-5', key: PASSWORD, enabled: true, channel: 36 });
    const body = JSON.parse(textOf(result));
    expect(body.applied).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(textOf(result)).not.toContain(PASSWORD);
    const logs = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logs).toContain('cube-1');
    expect(logs).toContain('wifi2Ghz.key');
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain('old-secret-key');
    expect(logs).not.toContain('nms-token');
  });

  it('updates ONU key and key5g and refuses a non-Wi-Fi ONU and an airMAX radio', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          identification: { id: 'onu-1', hostname: 'uf-wifi', type: 'onu', modelName: 'UF-WIFI', site: { id: 'site-1' } },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ssid: 'Casa', key: 'old-secret-key', ssid5g: 'Casa-5', key5g: 'old-secret-key-5', encryption: 'wpa2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const onu = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'onu-1', password: PASSWORD, confirm: true })
    );
    expect(onu.isError).toBeUndefined();
    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit).method === 'PUT');
    expect(new URL(put![0] as string).pathname).toBe('/nms/api/v2.1/devices/onus/onu-1/wireless');
    const sent = JSON.parse((put![1] as RequestInit).body as string);
    expect(sent.key).toBe(PASSWORD);
    expect(sent.key5g).toBe(PASSWORD);
    expect(sent.ssid).toBe('Casa');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ identification: { id: 'nano-1', hostname: 'nano', type: 'onu', modelName: 'UF-Nano', site: { id: 'site-1' } } })
    );
    const nano = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'nano-1', password: PASSWORD, confirm: true })
    );
    expect(nano.isError).toBe(true);
    expect(textOf(nano)).toMatch(/not a Wi-Fi ONU/);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(['GET']);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        identification: { id: 'lbe-1', hostname: 'lbe-client', type: 'airMax', modelName: 'LiteBeam 5AC Gen2', role: 'station', site: { id: 'site-1' } },
      })
    );
    const airmax = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'lbe-1', password: PASSWORD, confirm: true })
    );
    expect(airmax.isError).toBe(true);
    expect(textOf(airmax)).toMatch(/airMAX/);
    expect(textOf(airmax)).toMatch(/backbone/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/nms/api/v2.1/devices/lbe-1');
    expect(textOf(airmax)).not.toContain(PASSWORD);
  });

  it('resolves client to service to site to the airCube and previews without writing', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 9, clientId: 7, name: 'Internet', status: 1, servicePlanName: '50/50', unmsClientSiteId: 'site-1' },
        ])
      )
      .mockResolvedValueOnce(jsonResponse([airCube()]))
      .mockResolvedValueOnce(jsonResponse(wirelessConfig()));

    const result = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { clientId: 7, password: PASSWORD })
    );
    const paths = fetchMock.mock.calls.map((call) => new URL(call[0] as string).pathname);
    expect(paths).toEqual(['/crm/api/v1.0/clients/services', '/nms/api/v2.1/devices', '/nms/api/v2.1/devices/aircubes/cube-1/wireless']);
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method === 'GET')).toBe(true);
    const body = JSON.parse(textOf(result));
    expect(body.applied).toBe(false);
    expect(body.device.id).toBe('cube-1');
    expect(body.clientId).toBe(7);
    expect(body.serviceId).toBe(9);
  });

  it('does not write when several home Wi-Fi devices match', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([airCube('cube-1'), airCube('cube-2')]));
    const result = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { siteId: 'site-1', password: PASSWORD, confirm: true })
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/deviceId/);
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method !== 'PUT')).toBe(true);
  });

  it('rejects a short password and stays disabled unless UISP_ENABLE_WRITES=true', async () => {
    const invalid = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'cube-1', password: 'short', confirm: true })
    );
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toMatch(/8-63/);
    expect(fetchMock).not.toHaveBeenCalled();

    delete process.env.UISP_ENABLE_WRITES;
    const disabled = await runWithCredentials(creds, () =>
      handleWifiTool('uisp_set_wifi_password', { deviceId: 'cube-1', password: PASSWORD, confirm: true })
    );
    expect(disabled.isError).toBe(true);
    expect(textOf(disabled)).toMatch(/UISP_ENABLE_WRITES/);
    expect(fetchMock).not.toHaveBeenCalled();

    const dispatched = await runWithCredentials(creds, () =>
      dispatchToolCall('uisp_set_wifi_password', { deviceId: 'cube-1', password: PASSWORD, confirm: true })
    );
    expect(dispatched.isError).toBe(true);
    expect(textOf(dispatched)).toMatch(/disabled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
