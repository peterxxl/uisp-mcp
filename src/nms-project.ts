/**
 * NMS list and statistics payloads are not pageable on the wire (`/devices`,
 * `/data-links`, and `/nms/statistics` return the whole collection). These
 * helpers slice and project them before they reach the model. `detail: "full"`
 * still honors limit/offset but keeps each item's raw fields.
 */

export type DetailLevel = 'compact' | 'full';

export interface ProjectPage {
  detail: DetailLevel;
  limit: number;
  offset: number;
  total: number;
  returned: number;
  hasMore: boolean;
  note: string;
}

const LIST_NOTE =
  'UISP returned the full collection; this page is sliced here. Ask for a higher offset, or detail "full", for more. NMS does not accept limit/offset on this endpoint.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asCollection(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.items)) return body.items;
  if (isRecord(body)) {
    const arrayEntry = Object.values(body).find((value) => Array.isArray(value));
    if (Array.isArray(arrayEntry)) return arrayEntry;
  }
  return body == null ? [] : [body];
}

function slice<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}

function omitEmpty(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function identOf(raw: Record<string, unknown>): Record<string, unknown> {
  return isRecord(raw.identification) ? raw.identification : raw;
}

function siteOf(ident: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(ident.site)) {
    return isRecord(ident.site.identification) ? ident.site.identification : ident.site;
  }
  return {};
}

export function compactDevice(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return { value: raw };
  const ident = identOf(raw);
  const overview = isRecord(raw.overview) ? raw.overview : {};
  const site = siteOf(ident);
  return omitEmpty({
    id: ident.id ?? raw.id,
    name: ident.name ?? ident.displayName ?? ident.hostname,
    hostname: ident.hostname,
    mac: ident.mac,
    ip: ident.ip ?? raw.ipAddress,
    model: ident.model,
    modelName: ident.modelName,
    type: ident.type,
    role: ident.role,
    firmwareVersion: ident.firmwareVersion,
    authorized: ident.authorized,
    status: overview.status ?? ident.status,
    lastSeen: overview.lastSeen,
    cpu: overview.cpu,
    ram: overview.ram,
    signal: overview.signal,
    siteId: site.id ?? ident.siteId,
    siteName: site.name,
  });
}

function endpointOf(node: unknown): Record<string, unknown> {
  if (!isRecord(node)) return {};
  const device = isRecord(node.device) ? identOf(node.device) : identOf(node);
  const site = isRecord(node.site) ? (isRecord(node.site.identification) ? node.site.identification : node.site) : siteOf(device);
  return omitEmpty({
    deviceId: device.id,
    deviceName: device.name ?? device.hostname,
    deviceType: device.type,
    siteId: site.id,
    siteName: site.name,
  });
}

export function compactDataLink(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return { value: raw };
  const from = raw.from ?? raw.fromDevice ?? raw.a;
  const to = raw.to ?? raw.toDevice ?? raw.b;
  return omitEmpty({
    id: raw.id,
    type: raw.type,
    state: raw.state ?? raw.status,
    ssid: raw.ssid,
    frequency: raw.frequency,
    channelWidth: raw.channelWidth,
    distance: raw.distance,
    signal: raw.signal ?? raw.dlSignal,
    uplinkSignal: raw.ulSignal,
    downlinkScore: raw.dlScore,
    uplinkScore: raw.ulScore,
    from: Object.keys(endpointOf(from)).length ? endpointOf(from) : undefined,
    to: Object.keys(endpointOf(to)).length ? endpointOf(to) : undefined,
  });
}

export function projectList(
  body: unknown,
  compact: (item: unknown) => Record<string, unknown>,
  options: { limit: number; offset: number; detail: DetailLevel }
): ProjectPage & { items: unknown[] } {
  const all = asCollection(body);
  const page = slice(all, options.limit, options.offset);
  const items = options.detail === 'full' ? page : page.map((item) => compact(item));
  return {
    detail: options.detail,
    limit: options.limit,
    offset: options.offset,
    total: all.length,
    returned: items.length,
    hasMore: options.offset + items.length < all.length,
    note: LIST_NOTE,
    items,
  };
}

function pointTime(point: unknown, index: number): number {
  if (!isRecord(point)) return index;
  for (const key of ['time', 'timestamp', 'x', 'date', 'interval']) {
    const value = point[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return index;
}

function compactPoint(point: unknown): unknown {
  if (!isRecord(point)) return point;
  return omitEmpty(
    Object.fromEntries(Object.entries(point).filter(([, value]) => value == null || typeof value !== 'object'))
  );
}

function newestFirst(values: unknown[]): unknown[] {
  const tagged = values.map((value, index) => ({ value, index, time: pointTime(value, index) }));
  const timed = tagged.filter((item) => item.time !== item.index);
  if (timed.length === tagged.length && timed.length > 1) {
    return [...tagged].sort((a, b) => b.time - a.time || b.index - a.index).map((item) => item.value);
  }
  return [...values].reverse();
}

const STATS_NOTE =
  'Time series are newest first. interval is the UISP bucket; limit (or period) is how many recent buckets are returned. The statistics endpoint itself is not paged.';

export function projectStatistics(
  body: unknown,
  options: { limit: number; offset: number; detail: DetailLevel; interval?: string }
): Record<string, unknown> {
  if (Array.isArray(body)) {
    const ordered = newestFirst(body);
    const page = slice(ordered, options.limit, options.offset);
    const points = options.detail === 'full' ? page : page.map((point) => compactPoint(point));
    return {
      detail: options.detail,
      interval: options.interval,
      limit: options.limit,
      offset: options.offset,
      total: body.length,
      returned: points.length,
      hasMore: options.offset + points.length < body.length,
      order: 'newest',
      note: STATS_NOTE,
      points,
    };
  }

  if (!isRecord(body)) {
    return { detail: options.detail, value: body, note: STATS_NOTE };
  }

  const summary: Record<string, unknown> = {};
  const series: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      const ordered = newestFirst(value);
      const page = slice(ordered, options.limit, options.offset);
      const points = options.detail === 'full' ? page : page.map((point) => compactPoint(point));
      series[key] = {
        total: value.length,
        returned: points.length,
        hasMore: options.offset + points.length < value.length,
        points,
      };
      continue;
    }
    if (isRecord(value)) {
      summary[key] = options.detail === 'full' ? value : compactPoint(value);
      continue;
    }
    summary[key] = value;
  }

  return {
    detail: options.detail,
    interval: options.interval,
    limit: options.limit,
    offset: options.offset,
    order: 'newest',
    note: STATS_NOTE,
    summary,
    series,
  };
}
