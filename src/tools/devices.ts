import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  getCredentials,
  getDevice,
  getDeviceByMac,
  getDeviceDetail,
  getDeviceStatistics,
  listDeviceInterfaces,
  listDevices,
  listDiscoveredDevices,
} from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

const DEVICE_TYPES = [
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
];

const DEVICE_ROLES = ['router', 'switch', 'gpon', 'ap', 'station', 'other', 'ups', 'server', 'wireless', 'convertor', 'gateway'];

export const DEVICE_TOOLS: Tool[] = [
  {
    name: 'uisp_list_devices',
    description:
      "List devices (hostname/IP/MAC, status, parent site), optionally filtered by site/type/role/authorization. Each device's `id` chains into uisp_get_device, uisp_get_device_detail, uisp_get_device_statistics, and uisp_list_device_interfaces.",
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'Filter to devices at this site (from uisp_list_sites).' },
        withInterfaces: { type: 'boolean', description: 'Include each device\'s interfaces in the response.' },
        authorized: { type: 'boolean', description: 'Filter to authorized (true) or pending-authorization (false) devices.' },
        type: { type: 'array', items: { type: 'string', enum: DEVICE_TYPES }, description: 'Filter by device type.' },
        role: { type: 'array', items: { type: 'string', enum: DEVICE_ROLES }, description: 'Filter by device role.' },
      },
    },
  },
  {
    name: 'uisp_get_device',
    description: "Get a single device's status overview by ID.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Device ID (from uisp_list_devices).' } },
      required: ['id'],
    },
  },
  {
    name: 'uisp_get_device_detail',
    description: "Get a single device's detail, optionally including its interfaces and/or connected stations.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Device ID (from uisp_list_devices).' },
        withStations: { type: 'boolean', description: "Include the device's connected wireless stations." },
      },
      required: ['id'],
    },
  },
  {
    name: 'uisp_get_device_statistics',
    description: 'Get device telemetry (CPU/RAM/signal/temperature/throughput) bucketed by interval.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Device ID (from uisp_list_devices).' },
        interval: {
          type: 'string',
          enum: ['hour', 'day', 'month', 'quarter', 'year'],
          description: 'Time bucket for the statistics.',
        },
      },
      required: ['id', 'interval'],
    },
  },
  {
    name: 'uisp_list_device_interfaces',
    description: "List a device's network interfaces, including their configured IP addresses and status.",
    inputSchema: {
      type: 'object',
      properties: { deviceId: { type: 'string', description: 'Device ID (from uisp_list_devices).' } },
      required: ['deviceId'],
    },
  },
  {
    name: 'uisp_get_device_by_mac',
    description: 'Look up a device by its MAC address.',
    inputSchema: {
      type: 'object',
      properties: { mac: { type: 'string', description: 'Device MAC address, e.g. 78:8a:20:5f:2a:ff.' } },
      required: ['mac'],
    },
  },
  {
    name: 'uisp_list_discovered_devices',
    description: 'List devices UISP has discovered on the network but which have not yet been added.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(DEVICE_TOOLS.map((t) => t.name));
export function isDeviceTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleDeviceTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_devices') {
      return textResult(
        await listDevices(creds!, {
          siteId: args.siteId as string | undefined,
          withInterfaces: args.withInterfaces as boolean | undefined,
          authorized: args.authorized as boolean | undefined,
          type: args.type as string[] | undefined,
          role: args.role as string[] | undefined,
        })
      );
    }

    if (name === 'uisp_get_device') {
      return textResult(await getDevice(creds!, args.id as string));
    }

    if (name === 'uisp_get_device_detail') {
      return textResult(await getDeviceDetail(creds!, { id: args.id as string, withStations: args.withStations as boolean | undefined }));
    }

    if (name === 'uisp_get_device_statistics') {
      return textResult(
        await getDeviceStatistics(creds!, {
          id: args.id as string,
          interval: args.interval as 'hour' | 'day' | 'month' | 'quarter' | 'year',
        })
      );
    }

    if (name === 'uisp_list_device_interfaces') {
      return textResult(await listDeviceInterfaces(creds!, args.deviceId as string));
    }

    if (name === 'uisp_get_device_by_mac') {
      return textResult(await getDeviceByMac(creds!, args.mac as string));
    }

    if (name === 'uisp_list_discovered_devices') {
      return textResult(await listDiscoveredDevices(creds!));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
