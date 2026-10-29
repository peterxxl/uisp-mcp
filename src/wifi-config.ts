/**
 * Home Wi-Fi password changes for devices whose wireless config UISP itself
 * manages. Verified against the NMS API v2.1 operation shape documented by
 * the live Swagger (`PUT /devices/aircubes/{id}/wireless` with `wifi2Ghz.key`
 * / `wifi5Ghz.key`, and `PUT /devices/onus/{id}/wireless` with `key` /
 * `key5g`) plus the public airCube wireless examples. Not exercised against
 * a live console.
 *
 * airMAX / airOS / airFiber / Wave keys are the backbone link. Changing them
 * drops the client. Those device types are refused before any wireless call.
 */

export type WifiKind = 'aircube' | 'onu';
export type WifiBand = '2ghz' | '5ghz' | 'both';
export type DeviceClass = WifiKind | 'backbone' | 'unsupported';

export interface DeviceView {
  id: string;
  name: string;
  type: string;
  model: string;
  role: string;
  category: string;
  siteId?: string;
  siteName?: string;
}

const BACKBONE_TYPES = new Set(['airMax', 'airFiber', 'wave']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deviceView(device: Record<string, unknown>): DeviceView {
  const ident = isRecord(device.identification) ? device.identification : {};
  const site = isRecord(ident.site) ? ident.site : isRecord(device.site) ? device.site : {};
  const id = String(ident.id ?? device.id ?? '');
  const siteId = site.id != null ? String(site.id) : ident.siteId != null ? String(ident.siteId) : undefined;
  return {
    id,
    name: String(ident.hostname ?? ident.name ?? ident.displayName ?? device.name ?? id),
    type: String(ident.type ?? device.type ?? ''),
    model: String(ident.modelName ?? ident.model ?? ''),
    role: String(ident.role ?? device.role ?? ''),
    category: String(ident.category ?? device.category ?? ''),
    siteId,
    siteName: site.name != null ? String(site.name) : site.identification && isRecord(site.identification) && site.identification.name != null
      ? String(site.identification.name)
      : undefined,
  };
}

function modelText(view: DeviceView): string {
  return `${view.type} ${view.model} ${view.category} ${view.role}`.toLowerCase();
}

/** airMAX/airOS and the other licensed backhaul radios, even if `type` was mis-labeled. */
export function isBackboneDevice(view: DeviceView): boolean {
  if (BACKBONE_TYPES.has(view.type)) return true;
  const text = modelText(view);
  return (
    text.includes('airmax') ||
    text.includes('airos') ||
    text.includes('airfiber') ||
    text.includes('litebeam') ||
    text.includes('powerbeam') ||
    text.includes('nanostation') ||
    text.includes('nanobeam') ||
    text.includes('liteap') ||
    text.includes('isostation') ||
    text.includes('prism') ||
    text.includes('rocket')
  );
}

/**
 * `yes` / `no` when the model name is conclusive (UF-WIFI / UF-Instant vs
 * UF-Nano / UF-LOCO). `unknown` means the caller must confirm with
 * GET /devices/onus/{id}/wireless.
 */
export function onuWifiHint(view: DeviceView): 'yes' | 'no' | 'unknown' {
  const text = modelText(view);
  if (/wifi|uf-instant|ufiber wifi/.test(text)) return 'yes';
  if (/nano|loco|uf-ae|gpon/.test(text) && !text.includes('wifi')) return 'no';
  return 'unknown';
}

export function classifyDevice(view: DeviceView): DeviceClass {
  if (isBackboneDevice(view)) return 'backbone';
  if (view.type === 'airCube') return 'aircube';
  if (view.type === 'onu') {
    if (onuWifiHint(view) === 'no') return 'unsupported';
    return 'onu';
  }
  return 'unsupported';
}

export function backboneRefusalMessage(view: DeviceView): string {
  const label = view.name || view.id || 'device';
  const kind = view.type || view.model || 'unknown type';
  return `Refusing to change the wireless key on ${label} (${kind}). airMAX, airOS, airFiber, and Wave keys are backbone links; changing them would disconnect the client. Home Wi-Fi changes are only supported for airCube and Wi-Fi ONU devices whose wireless config UISP manages.`;
}

export function unsupportedDeviceMessage(view: DeviceView): string {
  const label = view.name || view.id || 'device';
  if (view.type === 'onu') {
    return `ONU ${label} (${view.model || 'unknown model'}) is not a Wi-Fi ONU. Refusing to change a key that is not the customer's home Wi-Fi.`;
  }
  return `Device ${label} (${view.type || view.model || 'unknown type'}) does not have UISP-managed home Wi-Fi. Only airCube and Wi-Fi ONU devices are supported.`;
}

export function wirelessPath(kind: WifiKind, id: string): string {
  const segment = encodeURIComponent(id);
  return kind === 'aircube' ? `/devices/aircubes/${segment}/wireless` : `/devices/onus/${segment}/wireless`;
}

export function onuConfigLooksLikeWifi(config: Record<string, unknown>): boolean {
  return ['ssid', 'key', 'ssid5g', 'key5g', 'encryption', 'channel', 'channel5g'].some((key) => key in config);
}

export interface WifiChange {
  field: string;
  ssid: string | null;
}

export class WifiConfigError extends Error {}

function bandObject(config: Record<string, unknown>, key: 'wifi2Ghz' | 'wifi5Ghz'): Record<string, unknown> | null {
  const value = config[key];
  return isRecord(value) ? value : null;
}

function ssidOf(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Clone `config` and set only the password fields for the requested bands.
 * Every other property is preserved so the follow-up PUT is a full-object
 * replace, which is what the NMS wireless endpoints expect.
 */
export function applyWifiPassword(
  config: Record<string, unknown>,
  kind: WifiKind,
  password: string,
  band: WifiBand
): { next: Record<string, unknown>; changes: WifiChange[] } {
  const next = structuredClone(config);
  const changes: WifiChange[] = [];

  if (kind === 'aircube') {
    if (band !== '5ghz') {
      const wifi2 = bandObject(next, 'wifi2Ghz');
      if (!wifi2) {
        if (band === '2ghz') throw new WifiConfigError('This airCube has no wifi2Ghz configuration to update.');
      } else {
        wifi2.key = password;
        changes.push({ field: 'wifi2Ghz.key', ssid: ssidOf(wifi2, 'ssid') });
      }
    }
    if (band !== '2ghz') {
      const wifi5 = bandObject(next, 'wifi5Ghz');
      if (!wifi5) {
        if (band === '5ghz') throw new WifiConfigError('This airCube has no wifi5Ghz configuration to update.');
      } else {
        wifi5.key = password;
        changes.push({ field: 'wifi5Ghz.key', ssid: ssidOf(wifi5, 'ssid') });
      }
    }
  } else {
    if (band !== '5ghz') {
      next.key = password;
      changes.push({ field: 'key', ssid: ssidOf(next, 'ssid') });
    }
    if (band !== '2ghz') {
      const has5 = 'key5g' in next || 'ssid5g' in next || 'channel5g' in next;
      if (band === '5ghz' && !has5) {
        throw new WifiConfigError('This ONU has no 5 GHz Wi-Fi configuration (key5g / ssid5g) to update.');
      }
      if (band === '5ghz' || has5) {
        next.key5g = password;
        changes.push({ field: 'key5g', ssid: ssidOf(next, 'ssid5g') });
      }
    }
  }

  if (changes.length === 0) {
    throw new WifiConfigError('No home Wi-Fi band on this device can be updated.');
  }
  return { next, changes };
}

/** Drop key material before anything is logged or returned. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'key' || key === 'key5g' || key.toLowerCase().includes('password')) {
      copy[key] = child ? '***' : child;
    } else {
      copy[key] = redactSecrets(child);
    }
  }
  return copy;
}
