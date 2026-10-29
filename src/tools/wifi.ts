import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getDevice, listDevices, uispRequest } from '../client.js';
import { fetchAllCrmPages, getService, listServices } from '../crm-api.js';
import { summarizeService, type ServiceSummary } from '../crm-format.js';
import { UispApiError, type UispCredentials } from '../types.js';
import { logger } from '../utils/logger.js';
import {
  applyWifiPassword,
  backboneRefusalMessage,
  classifyDevice,
  deviceView,
  onuConfigLooksLikeWifi,
  onuWifiHint,
  unsupportedDeviceMessage,
  wirelessPath,
  WifiConfigError,
  type DeviceView,
  type WifiBand,
  type WifiKind,
} from '../wifi-config.js';
import { parseToolArgs } from './args.js';
import { errorResult, requireCredentials, requireCrmCredentials, textResult, writesEnabled } from './shared.js';
import type { CallToolResult } from './types.js';

export const WIFI_TOOLS: Tool[] = [
  {
    name: 'uisp_set_wifi_password',
    description:
      'Change the home Wi-Fi password on a customer device whose Wi-Fi UISP manages: airCube (PUT /devices/aircubes/{id}/wireless, wifi2Ghz.key and wifi5Ghz.key) or a Wi-Fi ONU (PUT /devices/onus/{id}/wireless, key and key5g). Resolves CRM client → service → NMS site → device when clientId or serviceId is given. Refuses airMAX, airOS, airFiber, and Wave devices because those keys are backbone links. Password must be 8-63 characters. Defaults to a dry-run preview; the password is applied only when confirm is true. Requires UISP_ENABLE_WRITES=true. The password is never logged or returned.',
    inputSchema: {
      type: 'object',
      properties: {
        password: { type: 'string', description: 'New WPA passphrase, 8-63 characters. Not echoed in the result.' },
        confirm: {
          type: 'boolean',
          description: 'Set true to apply the change. Omit or false for a dry-run preview that does not PUT.',
        },
        band: {
          type: 'string',
          enum: ['2ghz', '5ghz', 'both'],
          description: 'Which radios to update. Defaults to both radios that exist on the device.',
        },
        clientId: { type: 'number', description: 'CRM client id. Services are resolved to NMS sites.' },
        serviceId: { type: 'number', description: 'CRM service id. Uses the service unmsClientSiteId.' },
        siteId: { type: 'string', description: 'NMS site id. Devices at this site are considered.' },
        deviceId: { type: 'string', description: 'NMS device id. Required when more than one home Wi-Fi device matches.' },
      },
      required: ['password'],
    },
  },
];

const TOOL_NAMES = new Set(WIFI_TOOLS.map((tool) => tool.name));
export function isWifiTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SiteLink {
  siteId: string;
  serviceId?: number;
  clientId?: number;
}

function devicesFrom(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (isRecord(body) && Array.isArray(body.items)) return body.items.filter(isRecord);
  throw new UispApiError('UISP /devices returned an unexpected collection shape');
}

async function servicesForClient(creds: UispCredentials, clientId: number): Promise<ServiceSummary[]> {
  const collected = await fetchAllCrmPages(
    (limit, offset) => listServices(creds, { clientId, limit, offset }),
    '/clients/services'
  );
  return collected.rows.map((row) => summarizeService(row));
}

async function resolveLinks(creds: UispCredentials, args: Record<string, unknown>): Promise<SiteLink[] | CallToolResult> {
  const clientId = args.clientId as number | undefined;
  const serviceId = args.serviceId as number | undefined;
  const siteId = args.siteId as string | undefined;
  const deviceId = args.deviceId as string | undefined;

  if (serviceId != null) {
    const missing = requireCrmCredentials(creds);
    if (missing) return missing;
    const service = summarizeService(await getService(creds, serviceId));
    if (!service.unmsClientSiteId) {
      throw new WifiConfigError(`CRM service ${serviceId} has no unmsClientSiteId, so it is not linked to an NMS site.`);
    }
    if (siteId && siteId !== service.unmsClientSiteId) {
      throw new WifiConfigError(`Site ${siteId} is not the NMS site linked to CRM service ${serviceId} (${service.unmsClientSiteId}).`);
    }
    return [{ siteId: service.unmsClientSiteId, serviceId: service.id ?? serviceId, clientId: service.clientId ?? clientId }];
  }

  if (clientId != null) {
    const missing = requireCrmCredentials(creds);
    if (missing) return missing;
    const services = (await servicesForClient(creds, clientId)).filter((service) => service.unmsClientSiteId);
    const matching = siteId ? services.filter((service) => service.unmsClientSiteId === siteId) : services;
    if (siteId && services.length > 0 && matching.length === 0) {
      throw new WifiConfigError(`Site ${siteId} is not linked to CRM client ${clientId}.`);
    }
    if (!siteId && matching.length === 0) {
      throw new WifiConfigError(`CRM client ${clientId} has no service with an NMS site (unmsClientSiteId).`);
    }
    if (matching.length === 0 && siteId) {
      return [{ siteId, clientId }];
    }
    return matching.map((service) => ({
      siteId: service.unmsClientSiteId as string,
      serviceId: service.id ?? undefined,
      clientId: service.clientId ?? clientId,
    }));
  }

  if (siteId) return [{ siteId, clientId, serviceId }];
  return [];
}

export async function handleWifiTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (name !== 'uisp_set_wifi_password') return errorResult(`Unknown tool: ${name}`);
  if (!writesEnabled()) {
    return errorResult(
      'Write tools are disabled. Set UISP_ENABLE_WRITES=true to enable uisp_set_wifi_password. Nothing was changed.'
    );
  }

  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    return await setWifiPassword(creds!, args);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

async function setWifiPassword(creds: UispCredentials, args: Record<string, unknown>): Promise<CallToolResult> {
  const password = args.password as string;
  const confirm = args.confirm === true;
  const band = (args.band as WifiBand) ?? 'both';
  const deviceId = args.deviceId as string | undefined;

  const linksOrError = await resolveLinks(creds, args);
  if (linksOrError && !Array.isArray(linksOrError)) return linksOrError;
  const links = linksOrError;

  let rawDevices: Record<string, unknown>[] = [];
  if (deviceId) {
    const raw = await getDevice(creds, deviceId);
    if (!isRecord(raw)) throw new UispApiError('UISP /devices/{id} returned an unexpected response');
    const view = deviceView(raw);
    if (links.length > 0 && view.siteId && !links.some((link) => link.siteId === view.siteId)) {
      throw new WifiConfigError(`Device ${deviceId} is not on a site linked to this client or service.`);
    }
    rawDevices = [raw];
  } else {
    const seen = new Set<string>();
    for (const link of links) {
      if (seen.has(link.siteId)) continue;
      seen.add(link.siteId);
      rawDevices.push(...devicesFrom(await listDevices(creds, { siteId: link.siteId })));
    }
  }

  const eligible: Array<{ view: DeviceView; kind: WifiKind }> = [];
  const backbone: DeviceView[] = [];
  for (const raw of rawDevices) {
    const view = deviceView(raw);
    if (!view.id) continue;
    const kind = classifyDevice(view);
    if (kind === 'backbone') backbone.push(view);
    else if (kind === 'aircube' || kind === 'onu') eligible.push({ view, kind });
  }

  if (eligible.length === 0) {
    const refused = backbone[0] ?? (rawDevices[0] ? deviceView(rawDevices[0]) : undefined);
    if (refused && classifyDevice(refused) === 'backbone') {
      logger.warn('UISP write refused', {
        tool: 'uisp_set_wifi_password',
        outcome: 'refused',
        reason: 'backbone',
        deviceId: refused.id,
        deviceType: refused.type,
      });
      return errorResult(backboneRefusalMessage(refused));
    }
    if (refused) return errorResult(unsupportedDeviceMessage(refused));
    return errorResult('No airCube or Wi-Fi ONU was found for this client, service, or site.');
  }

  if (eligible.length > 1) {
    const candidates = eligible.map((item) => ({
      deviceId: item.view.id,
      name: item.view.name,
      type: item.view.type,
      model: item.view.model,
      siteId: item.view.siteId ?? null,
      siteName: item.view.siteName ?? null,
    }));
    if (confirm) {
      return errorResult(
        `Refusing to change a password while ${candidates.length} home Wi-Fi devices match. Pass deviceId. Nothing was changed.`
      );
    }
    return textResult({
      dryRun: true,
      applied: false,
      reason: 'multiple_devices',
      message: 'More than one home Wi-Fi device matches. Pass deviceId to choose one. Nothing was changed.',
      candidates,
    });
  }

  const target = eligible[0];
  const link = links.find((item) => item.siteId === target.view.siteId) ?? links[0];
  const path = wirelessPath(target.kind, target.view.id);
  let config: unknown;
  try {
    config = await uispRequest(creds, { api: 'nms', method: 'GET', path });
  } catch (err) {
    if (err instanceof UispApiError && err.status === 404) {
      return errorResult(
        `${unsupportedDeviceMessage(target.view)} UISP has no wireless configuration at ${path}.`
      );
    }
    throw err;
  }
  if (!isRecord(config)) {
    throw new WifiConfigError('UISP returned a wireless configuration that was not an object.');
  }
  if (target.kind === 'onu' && onuWifiHint(target.view) !== 'yes' && !onuConfigLooksLikeWifi(config)) {
    return errorResult(unsupportedDeviceMessage(target.view));
  }

  const { next, changes } = applyWifiPassword(config, target.kind, password, band);
  const preview = {
    dryRun: !confirm,
    applied: false,
    device: {
      id: target.view.id,
      name: target.view.name,
      type: target.view.type,
      model: target.view.model,
      siteId: target.view.siteId ?? null,
      siteName: target.view.siteName ?? null,
    },
    clientId: (args.clientId as number | undefined) ?? link?.clientId ?? null,
    serviceId: (args.serviceId as number | undefined) ?? link?.serviceId ?? null,
    endpoint: `PUT /nms/api/v2.1${path}`,
    changes,
    message: 'Preview only. Call again with confirm:true to apply. The password is not echoed.',
  };

  if (!confirm) return textResult(preview);

  await uispRequest(creds, { api: 'nms', method: 'PUT', path, body: next });
  logger.info('UISP write audit', {
    tool: 'uisp_set_wifi_password',
    outcome: 'applied',
    deviceId: target.view.id,
    deviceType: target.view.type,
    siteId: target.view.siteId ?? null,
    clientId: preview.clientId,
    serviceId: preview.serviceId,
    fields: changes.map((change) => change.field),
    endpoint: preview.endpoint,
  });
  return textResult({
    ...preview,
    dryRun: false,
    applied: true,
    message: 'Home Wi-Fi password updated. The password is not included in this result.',
  });
}
