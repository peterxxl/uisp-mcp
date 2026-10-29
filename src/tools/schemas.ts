import { z } from 'zod';

/**
 * Runtime argument checks for every tool. A missing id must fail here,
 * before the client interpolates it into a path (`/devices/undefined`).
 */

export const pathSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      value !== 'undefined' &&
      value !== 'null' &&
      !value.includes('/') &&
      !value.includes('\\') &&
      !value.includes('..') &&
      !/[\u0000-\u001F\s]/.test(value),
    { message: 'must be a single path segment' }
  );

export const crmIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[1-9]\d*$/).transform((value) => Number(value)),
]);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const pageCount = z.number().int().min(1).max(1000);
const pageNumber = z.number().int().min(1).max(100_000);

const crmLimit = z.number().int().min(1).max(500).default(100);
const crmOffset = z.number().int().min(0).max(1_000_000).default(0);

const deviceTypes = [
  'onu',
  'olt',
  'uispp',
  'uispr',
  'uisps',
  'uispLte',
  'erouter',
  'eswitch',
  'epower',
  'airCube',
  'airMax',
  'airFiber',
  'toughSwitch',
  'solarBeam',
  'wave',
  'blackBox',
] as const;

const deviceRoles = ['router', 'switch', 'gpon', 'ap', 'station', 'other', 'ups', 'server', 'wireless', 'convertor', 'gateway'] as const;

const logTags = [
  'login',
  'device',
  'email-dispatch',
  'nms-backup',
  'nms-update',
  'nms-error',
  'device-state',
  'device-backup',
  'device-upgrade',
  'device-interface',
  'site',
] as const;

const empty = z.object({}).strip();

const wifiPasswordSchema = z
  .string()
  .min(8, 'password must be 8-63 characters')
  .max(63, 'password must be 8-63 characters')
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), { message: 'password must not contain control characters' });

export const TOOL_SCHEMAS: Record<string, z.ZodType> = {
  uisp_list_sites: z.object({
    id: z.array(pathSegmentSchema).max(100).optional(),
    ip: z.string().trim().min(1).max(64).optional(),
    deviceId: pathSegmentSchema.optional(),
    type: z.enum(['site', 'endpoint', 'client']).optional(),
    ucrm: z.boolean().optional(),
    ucrmDetails: z.boolean().optional(),
  }),
  uisp_get_site: z.object({
    id: pathSegmentSchema,
    ucrmDetails: z.boolean().optional(),
  }),
  uisp_search_sites: z.object({
    query: z.string().trim().min(1).max(200).optional(),
    type: z.enum(['site', 'endpoint', 'client']).optional(),
    ucrm: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    count: pageCount,
    page: pageNumber,
  }),
  uisp_list_site_clients: z.object({ id: pathSegmentSchema }),
  uisp_get_site_statistics: z.object({
    siteId: pathSegmentSchema,
    interval: z.enum(['hour', 'day', 'month']),
  }),
  uisp_get_site_traffic_summary: z.object({
    siteId: pathSegmentSchema,
    interval: z.enum(['hour', 'day', 'month']),
  }),
  uisp_list_devices: z.object({
    siteId: pathSegmentSchema.optional(),
    withInterfaces: z.boolean().optional(),
    authorized: z.boolean().optional(),
    type: z.array(z.enum(deviceTypes)).max(20).optional(),
    role: z.array(z.enum(deviceRoles)).max(20).optional(),
  }),
  uisp_get_device: z.object({ id: pathSegmentSchema }),
  uisp_get_device_detail: z.object({
    id: pathSegmentSchema,
    withStations: z.boolean().optional(),
  }),
  uisp_get_device_statistics: z.object({
    id: pathSegmentSchema,
    interval: z.enum(['hour', 'day', 'month', 'quarter', 'year']),
  }),
  uisp_list_device_interfaces: z.object({ deviceId: pathSegmentSchema }),
  uisp_get_device_by_mac: z.object({
    mac: z
      .string()
      .trim()
      .regex(/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, 'must be a MAC address like 78:8a:20:5f:2a:ff'),
  }),
  uisp_list_discovered_devices: empty,
  uisp_list_outages: z.object({
    deviceId: pathSegmentSchema.optional(),
    period: z.number().int().min(0).max(3650).optional(),
    query: z.string().trim().min(1).max(200).optional(),
    type: z.enum(['outage', 'unreachable']).optional(),
    inProgress: z.boolean().optional(),
    count: pageCount,
    page: pageNumber,
  }),
  uisp_list_logs: z.object({
    siteId: pathSegmentSchema.optional(),
    deviceId: z.array(pathSegmentSchema).max(100).optional(),
    level: z.enum(['info', 'warning', 'error']).optional(),
    tag: z.enum(logTags).optional(),
    period: z.number().int().min(0).max(3650).optional(),
    query: z.string().trim().min(1).max(200).optional(),
    count: pageCount,
    page: pageNumber,
  }),
  uisp_list_data_links: z.object({ siteLinksOnly: z.boolean().optional() }),
  uisp_get_data_link: z.object({ id: pathSegmentSchema }),
  uisp_list_site_data_links: z.object({ siteId: pathSegmentSchema }),
  uisp_list_gateways: empty,
  uisp_get_gateway: z.object({ id: pathSegmentSchema }),
  uisp_list_tasks: z.object({
    status: z.enum(['success', 'failed', 'in-progress', 'canceled', 'queued']).optional(),
    period: z.number().int().min(0).max(3650).optional(),
    count: pageCount,
    page: pageNumber,
  }),
  uisp_get_tasks_in_progress: empty,
  uisp_list_firmwares: empty,
  uisp_get_speed_tests: empty,
  uisp_get_version: empty,
  uisp_get_network_statistics: z.object({
    interval: z.enum(['hour', 'day', 'month', 'quarter', 'year']),
    siri: z.boolean().optional(),
  }),
  uisp_get_summary: z.object({
    logsLevel: z.array(z.enum(['info', 'warning', 'error'])).min(1).max(3),
    outagesTimestamp: z.number().int().nonnegative().optional(),
    logsTimestamp: z.number().int().nonnegative().optional(),
    firmwaresTimestamp: z.number().int().nonnegative().optional(),
  }),
  uisp_search_clients: z
    .object({
      query: z.string().trim().min(2).max(200).optional(),
      email: z.string().trim().min(3).max(200).optional(),
      phone: z.string().trim().min(3).max(40).optional(),
      customId: z.string().trim().min(1).max(64).optional(),
      limit: crmLimit,
      offset: crmOffset,
    })
    .refine((value) => !!(value.query || value.email || value.phone || value.customId), {
      message: 'Provide at least one of query, email, phone, or customId',
    }),
  uisp_get_client: z.object({ id: crmIdSchema }),
  uisp_list_client_services: z.object({
    clientId: crmIdSchema,
    statuses: z.array(z.number().int().min(0).max(8)).max(9).optional(),
    limit: crmLimit,
    offset: crmOffset,
  }),
  uisp_list_invoices: z.object({
    clientId: crmIdSchema.optional(),
    statuses: z.array(z.number().int().min(0).max(5)).max(6).optional(),
    overdue: z.boolean().optional(),
    createdDateFrom: isoDateSchema.optional(),
    createdDateTo: isoDateSchema.optional(),
    number: z.string().trim().min(1).max(64).optional(),
    order: z.enum(['clientFirstName', 'clientLastName', 'createdDate', 'number']).optional(),
    direction: z.enum(['ASC', 'DESC']).optional(),
    limit: crmLimit,
    offset: crmOffset,
  }),
  uisp_get_invoice: z.object({ id: crmIdSchema }),
  uisp_list_overdue_invoices: z.object({
    clientId: crmIdSchema.optional(),
    createdDateFrom: isoDateSchema.optional(),
    createdDateTo: isoDateSchema.optional(),
    sort: z.enum(['amount', 'days']).default('days'),
  }),
  uisp_list_debtors: z.object({
    clientId: crmIdSchema.optional(),
    createdDateFrom: isoDateSchema.optional(),
    createdDateTo: isoDateSchema.optional(),
    sort: z.enum(['amount', 'days']).default('amount'),
  }),
  uisp_list_payments: z.object({
    clientId: crmIdSchema.optional(),
    createdDateFrom: isoDateSchema.optional(),
    createdDateTo: isoDateSchema.optional(),
    limit: crmLimit,
    offset: crmOffset,
  }),
  uisp_map_client_site: z
    .object({
      clientId: crmIdSchema.optional(),
      serviceId: crmIdSchema.optional(),
      siteId: pathSegmentSchema.optional(),
    })
    .refine((value) => value.clientId != null || value.serviceId != null || value.siteId != null, {
      message: 'Provide clientId, serviceId, or siteId',
    }),
  uisp_set_wifi_password: z
    .object({
      password: wifiPasswordSchema,
      confirm: z.boolean().default(false),
      band: z.enum(['2ghz', '5ghz', 'both']).default('both'),
      clientId: crmIdSchema.optional(),
      serviceId: crmIdSchema.optional(),
      siteId: pathSegmentSchema.optional(),
      deviceId: pathSegmentSchema.optional(),
    })
    .refine((value) => value.clientId != null || value.serviceId != null || value.siteId != null || value.deviceId != null, {
      message: 'Provide clientId, serviceId, siteId, or deviceId so the home Wi-Fi device can be resolved',
    }),
};
