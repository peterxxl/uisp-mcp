import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getDataLink, listDataLinks, listSiteDataLinks } from '../client.js';
import { parseToolArgs } from './args.js';
import type { CallToolResult } from './types.js';
import { compactDataLink, projectList } from '../nms-project.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const DATA_LINK_TOOLS: Tool[] = [
  {
    name: 'uisp_list_data_links',
    description:
      'List data links - the wireless/wired links UISP has mapped between devices and sites. Defaults to a compact page (limit 50) with endpoints, frequency, and signal. NMS returns every link; this tool slices the result. Set detail to "full" for the raw link objects on that page.',
    inputSchema: {
      type: 'object',
      properties: {
        siteLinksOnly: { type: 'boolean', description: 'Only return data links between sites (excludes device-to-device links).' },
        limit: { type: 'number', description: 'Page size, 1-200. Defaults to 50.' },
        offset: { type: 'number', description: 'Zero-based index into the NMS list. Defaults to 0.' },
        detail: { type: 'string', enum: ['compact', 'full'], description: 'compact (default) or full raw link on this page.' },
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
    description: 'List data links attached to a given site. Same compact paging as uisp_list_data_links.',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'Site ID (from uisp_list_sites).' },
        limit: { type: 'number', description: 'Page size, 1-200. Defaults to 50.' },
        offset: { type: 'number', description: 'Zero-based index into the NMS list. Defaults to 0.' },
        detail: { type: 'string', enum: ['compact', 'full'], description: 'compact (default) or full raw link on this page.' },
      },
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
      const body = await listDataLinks(creds!, { siteLinksOnly: args.siteLinksOnly as boolean | undefined });
      return textResult(
        projectList(body, compactDataLink, {
          limit: args.limit as number,
          offset: args.offset as number,
          detail: args.detail === 'full' ? 'full' : 'compact',
        })
      );
    }

    if (name === 'uisp_get_data_link') {
      return textResult(await getDataLink(creds!, args.id as string));
    }

    if (name === 'uisp_list_site_data_links') {
      const body = await listSiteDataLinks(creds!, args.siteId as string);
      return textResult(
        projectList(body, compactDataLink, {
          limit: args.limit as number,
          offset: args.offset as number,
          detail: args.detail === 'full' ? 'full' : 'compact',
        })
      );
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
