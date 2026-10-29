import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getDataLink, listDataLinks, listSiteDataLinks } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const DATA_LINK_TOOLS: Tool[] = [
  {
    name: 'uisp_list_data_links',
    description: "List data links - the wireless/wired links UISP has mapped between devices and sites, with signal/frequency/distance detail.",
    inputSchema: {
      type: 'object',
      properties: {
        siteLinksOnly: { type: 'boolean', description: 'Only return data links between sites (excludes device-to-device links).' },
      },
    },
  },
  {
    name: 'uisp_get_data_link',
    description: "Get a single data link's detail by ID.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Data link ID (from uisp_list_data_links).' } },
      required: ['id'],
    },
  },
  {
    name: 'uisp_list_site_data_links',
    description: 'List data links attached to a given site.',
    inputSchema: {
      type: 'object',
      properties: { siteId: { type: 'string', description: 'Site ID (from uisp_list_sites).' } },
      required: ['siteId'],
    },
  },
];

const TOOL_NAMES = new Set(DATA_LINK_TOOLS.map((t) => t.name));
export function isDataLinkTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleDataLinkTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    args = parseToolArgs(name, args);
    if (name === 'uisp_list_data_links') {
      return textResult(await listDataLinks(creds!, { siteLinksOnly: args.siteLinksOnly as boolean | undefined }));
    }

    if (name === 'uisp_get_data_link') {
      return textResult(await getDataLink(creds!, args.id as string));
    }

    if (name === 'uisp_list_site_data_links') {
      return textResult(await listSiteDataLinks(creds!, args.siteId as string));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
