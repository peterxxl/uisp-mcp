import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  getCredentials,
  getSite,
  getSiteStatistics,
  getSiteTrafficSummary,
  listSiteClients,
  listSites,
  searchSites,
} from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, PAGE_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

const SITE_INTERVAL_PROPERTY = {
  type: 'string' as const,
  enum: ['hour', 'day', 'month'],
  description: 'Time bucket for the traffic figures.',
};

export const SITE_TOOLS: Tool[] = [
  {
    name: 'uisp_list_sites',
    description:
      "List sites (network locations - sites, endpoints, and clients - each optionally tied to a UCRM client/service record). Each site's `id` chains into uisp_get_site, uisp_list_site_clients, uisp_list_devices (siteId filter), and uisp_get_site_statistics.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'array', items: { type: 'string' }, description: 'Filter to specific site IDs.' },
        ip: { type: 'string', description: 'Filter to the site whose endpoint has this IP address.' },
        deviceId: { type: 'string', description: 'Filter to the site containing this device ID.' },
        type: { type: 'string', enum: ['site', 'endpoint', 'client'], description: 'Filter by site type.' },
        ucrm: { type: 'boolean', description: 'Only return sites linked to a UCRM client/service record.' },
        ucrmDetails: { type: 'boolean', description: 'Include the linked UCRM client/service detail.' },
      },
    },
  },
  {
    name: 'uisp_get_site',
    description: "Get a single site's detail, including its status and (if linked) UCRM client/service reference.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Site ID (from uisp_list_sites).' },
        ucrmDetails: { type: 'boolean', description: 'Include the linked UCRM client/service detail.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'uisp_search_sites',
    description: 'Search sites, endpoints, and clients by name, address, MAC address, or IP address.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text.' },
        type: { type: 'string', enum: ['site', 'endpoint', 'client'], description: 'Restrict results to this site type.' },
        ucrm: { type: 'boolean', description: 'Only return results linked to a UCRM client/service record.' },
        latitude: { type: 'number', description: 'Latitude to bias/scope the search geographically.' },
        longitude: { type: 'number', description: 'Longitude to bias/scope the search geographically.' },
        ...PAGE_PARAMS_PROPERTIES,
      },
      required: ['count', 'page'],
    },
  },
  {
    name: 'uisp_list_site_clients',
    description: 'List all client sites belonging to a given (parent) site.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Parent site ID (from uisp_list_sites).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'uisp_get_site_statistics',
    description: 'Get upload/download traffic between a site and its parent site, bucketed by interval.',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'Site ID (from uisp_list_sites).' },
        interval: SITE_INTERVAL_PROPERTY,
      },
      required: ['siteId', 'interval'],
    },
  },
  {
    name: 'uisp_get_site_traffic_summary',
    description: "Get a site's total upload/download for the given interval up to now.",
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'Site ID (from uisp_list_sites).' },
        interval: SITE_INTERVAL_PROPERTY,
      },
      required: ['siteId', 'interval'],
    },
  },
];

const TOOL_NAMES = new Set(SITE_TOOLS.map((t) => t.name));
export function isSiteTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleSiteTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_sites') {
      return textResult(
        await listSites(creds!, {
          id: args.id as string[] | undefined,
          ip: args.ip as string | undefined,
          deviceId: args.deviceId as string | undefined,
          type: args.type as 'site' | 'endpoint' | 'client' | undefined,
          ucrm: args.ucrm as boolean | undefined,
          ucrmDetails: args.ucrmDetails as boolean | undefined,
        })
      );
    }

    if (name === 'uisp_get_site') {
      return textResult(await getSite(creds!, { id: args.id as string, ucrmDetails: args.ucrmDetails as boolean | undefined }));
    }

    if (name === 'uisp_search_sites') {
      return textResult(
        await searchSites(creds!, {
          query: args.query as string | undefined,
          type: args.type as 'site' | 'endpoint' | 'client' | undefined,
          ucrm: args.ucrm as boolean | undefined,
          latitude: args.latitude as number | undefined,
          longitude: args.longitude as number | undefined,
          count: args.count as number,
          page: args.page as number,
        })
      );
    }

    if (name === 'uisp_list_site_clients') {
      return textResult(await listSiteClients(creds!, args.id as string));
    }

    if (name === 'uisp_get_site_statistics') {
      return textResult(
        await getSiteStatistics(creds!, { siteId: args.siteId as string, interval: args.interval as 'hour' | 'day' | 'month' })
      );
    }

    if (name === 'uisp_get_site_traffic_summary') {
      return textResult(
        await getSiteTrafficSummary(creds!, { siteId: args.siteId as string, interval: args.interval as 'hour' | 'day' | 'month' })
      );
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
